// everflow-sync: two entry paths, distinguished by auth.
//   - Manual (the rep's JWT, via functions.invoke from the "Sync" button):
//     { leadId, month?, force? }
//       - month omitted (the normal case — the "Sync from Everflow" button):
//         walks backward from the current month, syncing every month found,
//         until 3 consecutive months come back with no Everflow data (or a
//         60-month/5-year hard cap is hit). This is a full history backfill,
//         not just the current month.
//       - month given: syncs that single month only (used internally by the
//         scheduled batch below; not currently exposed in the UI).
//   - Scheduled batch (service role via pg_cron, OR any logged-in rep's JWT —
//     see docs/everflow-integration-setup.md — e.g. the Home page's "Sync
//     all" button): {} — loops every client with an everflow_advertiser_id
//     set, syncing the current + previous month (the previous month catches
//     late conversion corrections after month-close). Deliberately NOT
//     widened to full history — that stays a manual, on-demand action so
//     frequent runs don't hammer Everflow for every client every time.
//
// Quality event sync (secondary conversion event, e.g. "Payroll" for Current
// — distinct from the base/billable event, e.g. downloads) rides along
// automatically on every path above whenever a lead has
// leads.everflow_quality_event_name set, using the same advertiser lookup and
// month range. A quality-sync failure (misspelled event name, Everflow
// hiccup) is absorbed and reported alongside — it never fails the spend sync,
// which is the older, primary feature.
//
// Response contract (so the client stays simple): handled outcomes return
// HTTP 200 with { ok, ... }; only auth/bad-input/unexpected use non-2xx.
//   - single month, matched:    { ok:true, matched:true, revenue, payout, synced_at,
//                                  qualityMatched?, eventCount?, eventRevenue?, qualityReason? }
//   - single month, no match:   { ok:true, matched:false, reason,
//                                  qualityMatched?, eventCount?, eventRevenue?, qualityReason? }
//     (qualityMatched/eventCount/eventRevenue/qualityReason are only present
//     when the lead has a quality event name configured)
//   - history walk-back:        { ok:true, historySync:true, synced: N, checked: N,
//                                  stopped: 'no_data'|'cap'|'rate_limited', qualitySynced?: N }
//   - batch:      { ok:true, synced: N, skipped: N, qualitySynced: N, qualitySkipped: N }
//   - everflow err: { ok:false, error:'rate_limited'|'unauthorized'|'everflow_error', message }
import { serviceClient, userFromRequest } from "../_shared/supabase.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { EverflowError, fetchAdvertiserQualityEvent, fetchAdvertiserRevenue } from "../_shared/everflow.ts";

// Decode (without verifying — the gateway already verified the signature when
// verify_jwt=true) a JWT payload to read the role claim. Duplicated from
// _shared/connections.ts rather than imported, so this function doesn't pull
// in Gmail/Google-specific modules it has nothing to do with.
function jwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return json.role ?? null;
  } catch {
    return null;
  }
}

// True only for the service role (pg_cron, or a self-invoke) — the batch
// path also accepts an authenticated rep JWT as a fallback (checked by the
// caller below), but never an anon/unauthenticated caller.
function requireServiceRole(req: Request): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (jwtRole(token) === "service_role") return true;
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return !!svc && token === svc;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// First-of-month date string (YYYY-MM-DD) for a given month, or the current
// month if omitted. Also returns the exclusive end date (first of next
// month) for the Everflow date-range call.
function monthRange(month?: string): { start: string; end: string } {
  const base = month ? new Date(`${month}T00:00:00Z`) : new Date();
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

function previousMonth(month: string): string {
  const d = new Date(`${month}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

// Walk-back bounds for the manual "Sync from Everflow" full-history path —
// see the header comment. 3 empty months in a row is treated as "we've
// walked past when this advertiser started tracking"; 60 months (5 years) is
// a hard safety cap regardless of what the streak looks like.
const HISTORY_EMPTY_STREAK_STOP = 3;
const HISTORY_MAX_MONTHS = 60;

// Pacing for the history walk-back: a short delay between every month
// proactively spreads out what would otherwise be up to 120 back-to-back
// Everflow calls (60 months × spend+quality), rather than only reacting
// after tripping Everflow's rate limit. HISTORY_RATE_LIMIT_BACKOFF_MS is a
// one-shot cooldown-and-retry for the spend call specifically if a 429
// still gets through — a spend rate-limit currently aborts the whole walk,
// far more costly than a single quality miss, so it's worth one retry
// before falling back to today's "stop cleanly, keep what synced" behavior.
const HISTORY_STEP_DELAY_MS = 200;
const HISTORY_RATE_LIMIT_BACKOFF_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let payload: { leadId?: number; month?: string; force?: boolean };
  try {
    payload = await req.json().catch(() => ({}));
  } catch {
    return json({ ok: false, error: "bad_request", message: "Invalid JSON body." }, 400);
  }

  const db = serviceClient();

  // Scheduled batch, no leadId — loop every client. Callable by the service
  // role (pg_cron) or any authenticated rep (the Home page's "Sync all" button).
  if (payload.leadId == null) {
    if (!requireServiceRole(req)) {
      const user = await userFromRequest(req);
      if (!user) return json({ ok: false, error: "unauthorized" }, 401);
    }
    return await syncAll(db);
  }

  // Manual: requires the rep's JWT.
  const user = await userFromRequest(req);
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);

  try {
    if (payload.month) {
      return await syncOneResponse(db, payload.leadId, monthRange(payload.month).start);
    }
    return await syncHistory(db, payload.leadId);
  } catch (e) {
    if (e instanceof EverflowError) {
      const error = e.code === "rate_limited" ? "rate_limited" : e.code;
      return json({ ok: false, error, message: e.message });
    }
    return json({ ok: false, error: "sync_failed", message: String((e as Error)?.message ?? e) }, 500);
  }
});

type MonthSyncResult =
  | { matched: true; revenue: number | null; payout: number | null; synced_at: string }
  | { matched: false; reason: string };

// Fetches + upserts one advertiser's one month. No HTTP concerns — reused by
// both the single-month response path and the history walk-back loop.
async function syncMonth(
  db: SupabaseClient,
  leadId: number,
  advertiserId: string,
  month: string,
): Promise<MonthSyncResult> {
  const { start, end } = monthRange(month);
  const result = await fetchAdvertiserRevenue(advertiserId, start, end);
  if (!result) {
    return { matched: false, reason: "No Everflow data for this advertiser in this month." };
  }

  const now = new Date().toISOString();
  const { error: upErr } = await db.from("client_spend_actuals").upsert(
    {
      lead_id: leadId,
      month,
      revenue: result.revenue,
      payout: result.payout,
      everflow_raw: result.raw,
      synced_at: now,
    },
    { onConflict: "lead_id,month" },
  );
  if (upErr) throw new Error(upErr.message);

  return { matched: true, revenue: result.revenue, payout: result.payout, synced_at: now };
}

type QualitySyncResult =
  | {
      matched: true;
      eventCount: number | null;
      eventRevenue: number | null;
      billedEventCount: number | null;
      synced_at: string;
    }
  | { matched: false; reason: string };

// Fetches + upserts one advertiser's named quality event for one month.
// Mirrors syncMonth's shape; reused by the single-month, history, and batch
// paths via syncQualityIfConfigured below.
async function syncQualityMonth(
  db: SupabaseClient,
  leadId: number,
  advertiserId: string,
  eventName: string,
  month: string,
): Promise<QualitySyncResult> {
  const { start, end } = monthRange(month);
  const result = await fetchAdvertiserQualityEvent(advertiserId, eventName, start, end);
  if (!result) {
    return { matched: false, reason: `No "${eventName}" event data for this advertiser in this month.` };
  }

  const now = new Date().toISOString();
  const { error: upErr } = await db.from("client_quality_actuals").upsert(
    {
      lead_id: leadId,
      month,
      event_name: eventName,
      event_count: result.eventCount,
      event_revenue: result.eventRevenue,
      billed_event_count: result.billedEventCount,
      everflow_raw: result.raw,
      synced_at: now,
    },
    { onConflict: "lead_id,month,event_name" },
  );
  if (upErr) throw new Error(upErr.message);

  return {
    matched: true,
    eventCount: result.eventCount,
    eventRevenue: result.eventRevenue,
    billedEventCount: result.billedEventCount,
    synced_at: now,
  };
}

// Runs the quality sync only if this lead has a quality event name
// configured; absorbs errors (a misspelled event name or an Everflow hiccup
// on the quality call must never fail the spend sync, which is the older,
// primary feature) rather than throwing.
async function syncQualityIfConfigured(
  db: SupabaseClient,
  leadId: number,
  lookup: { advertiserId: string; qualityEventName: string | null },
  month: string,
): Promise<QualitySyncResult | null> {
  if (!lookup.qualityEventName) return null;
  try {
    return await syncQualityMonth(db, leadId, lookup.advertiserId, lookup.qualityEventName, month);
  } catch (e) {
    return { matched: false, reason: String((e as Error)?.message ?? e) };
  }
}

async function lookupAdvertiser(
  db: SupabaseClient,
  leadId: number,
): Promise<
  | { ok: true; advertiserId: string; qualityEventName: string | null }
  | { ok: false; response: Response }
> {
  const { data: lead, error } = await db
    .from("leads")
    .select("id, everflow_advertiser_id, everflow_quality_event_name")
    .eq("id", leadId)
    .single();
  if (error || !lead) {
    return { ok: false, response: json({ ok: false, error: "not_found", message: "Lead not found." }, 404) };
  }
  if (!lead.everflow_advertiser_id) {
    return {
      ok: false,
      response: json({ ok: true, matched: false, reason: "Add an Everflow Advertiser ID first." }),
    };
  }
  return {
    ok: true,
    advertiserId: lead.everflow_advertiser_id,
    qualityEventName: lead.everflow_quality_event_name ?? null,
  };
}

async function syncOneResponse(db: SupabaseClient, leadId: number, month: string): Promise<Response> {
  const lookup = await lookupAdvertiser(db, leadId);
  if (!lookup.ok) return lookup.response;

  const result = await syncMonth(db, leadId, lookup.advertiserId, month);
  const quality = await syncQualityIfConfigured(db, leadId, lookup, month);

  const body: Record<string, unknown> = result.matched
    ? { ok: true, matched: true, revenue: result.revenue, payout: result.payout, synced_at: result.synced_at }
    : { ok: true, matched: false, reason: result.reason };

  if (quality) {
    Object.assign(
      body,
      quality.matched
        ? { qualityMatched: true, eventCount: quality.eventCount, eventRevenue: quality.eventRevenue }
        : { qualityMatched: false, qualityReason: quality.reason },
    );
  }

  return json(body);
}

// Manual "Sync from Everflow" default path: walk backward from the current
// month, syncing every month found, until HISTORY_EMPTY_STREAK_STOP
// consecutive months come back empty (we've likely walked past when this
// advertiser started) or HISTORY_MAX_MONTHS is hit (hard safety cap). Paced
// with a short delay between months (HISTORY_STEP_DELAY_MS) so a long
// backfill doesn't fire dozens of Everflow calls back-to-back; a rate-limit
// that still gets through gets one cooldown-and-retry
// (HISTORY_RATE_LIMIT_BACKOFF_MS) before falling back to stopping the walk
// early rather than failing the whole request — whatever synced so far is
// already committed.
async function syncHistory(db: SupabaseClient, leadId: number): Promise<Response> {
  const lookup = await lookupAdvertiser(db, leadId);
  if (!lookup.ok) return lookup.response;

  let month = monthRange().start;
  let synced = 0;
  let qualitySynced = 0;
  let checked = 0;
  let emptyStreak = 0;
  let stopped: "no_data" | "cap" | "rate_limited" = "cap";

  for (; checked < HISTORY_MAX_MONTHS; checked++) {
    let result: MonthSyncResult;
    try {
      result = await syncMonth(db, leadId, lookup.advertiserId, month);
    } catch (e) {
      if (e instanceof EverflowError && e.code === "rate_limited") {
        // One cooldown-and-retry before giving up — pacing between months
        // should make this rare, but Everflow's own load can still trip it.
        await sleep(HISTORY_RATE_LIMIT_BACKOFF_MS);
        try {
          result = await syncMonth(db, leadId, lookup.advertiserId, month);
        } catch (e2) {
          if (e2 instanceof EverflowError && e2.code === "rate_limited") {
            stopped = "rate_limited";
            break;
          }
          throw e2;
        }
      } else {
        throw e;
      }
    }

    const quality = await syncQualityIfConfigured(db, leadId, lookup, month);
    if (quality?.matched) qualitySynced++;

    if (result.matched) {
      synced++;
      emptyStreak = 0;
    } else {
      emptyStreak++;
      if (emptyStreak >= HISTORY_EMPTY_STREAK_STOP) {
        stopped = "no_data";
        checked++;
        break;
      }
    }

    month = previousMonth(month);
    await sleep(HISTORY_STEP_DELAY_MS);
  }

  return json({
    ok: true,
    historySync: true,
    synced,
    checked,
    stopped,
    ...(lookup.qualityEventName ? { qualitySynced } : {}),
  });
}

async function syncAll(db: SupabaseClient): Promise<Response> {
  const { data: leads, error } = await db
    .from("leads")
    .select("id, everflow_advertiser_id")
    .not("everflow_advertiser_id", "is", null);
  if (error) return json({ ok: false, error: "sync_failed", message: error.message }, 500);

  const currentMonth = monthRange().start;
  const prevMonth = previousMonth(currentMonth);

  let synced = 0;
  let skipped = 0;
  let qualitySynced = 0;
  let qualitySkipped = 0;
  for (const lead of leads ?? []) {
    for (const month of [currentMonth, prevMonth]) {
      try {
        const res = await syncOneResponse(db, lead.id, month);
        const body = await res.clone().json();
        if (body.matched) synced++;
        else skipped++;
        if (typeof body.qualityMatched === "boolean") {
          if (body.qualityMatched) qualitySynced++;
          else qualitySkipped++;
        }
      } catch {
        skipped++;
      }
    }
  }
  return json({ ok: true, synced, skipped, qualitySynced, qualitySkipped });
}
