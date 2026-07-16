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
//   - Scheduled batch (service role only, via pg_cron — see
//     docs/everflow-integration-setup.md): {} — loops every client with an
//     everflow_advertiser_id set, syncing the current + previous month (the
//     previous month catches late conversion corrections after month-close).
//     Deliberately NOT widened to full history — that stays a manual,
//     on-demand action so the daily cron doesn't hammer Everflow for every
//     client every day.
//
// Response contract (so the client stays simple): handled outcomes return
// HTTP 200 with { ok, ... }; only auth/bad-input/unexpected use non-2xx.
//   - single month, matched:    { ok:true, matched:true, revenue, payout, synced_at }
//   - single month, no match:   { ok:true, matched:false, reason }
//   - history walk-back:        { ok:true, historySync:true, synced: N, checked: N,
//                                  stopped: 'no_data'|'cap'|'rate_limited' }
//   - batch:      { ok:true, synced: N, skipped: N }
//   - everflow err: { ok:false, error:'rate_limited'|'unauthorized'|'everflow_error', message }
import { serviceClient, userFromRequest } from "../_shared/supabase.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { EverflowError, fetchAdvertiserRevenue } from "../_shared/everflow.ts";

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

// The scheduled batch sync must only run from the service role (pg_cron, or
// a self-invoke) — reject anon/authenticated callers so a logged-in rep can't
// trigger a global run against every client.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let payload: { leadId?: number; month?: string; force?: boolean };
  try {
    payload = await req.json().catch(() => ({}));
  } catch {
    return json({ ok: false, error: "bad_request", message: "Invalid JSON body." }, 400);
  }

  const db = serviceClient();

  // Scheduled batch: service role only, no leadId — loop every client.
  if (payload.leadId == null) {
    if (!requireServiceRole(req)) return json({ ok: false, error: "unauthorized" }, 401);
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

async function lookupAdvertiser(
  db: SupabaseClient,
  leadId: number,
): Promise<{ ok: true; advertiserId: string } | { ok: false; response: Response }> {
  const { data: lead, error } = await db
    .from("leads")
    .select("id, everflow_advertiser_id")
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
  return { ok: true, advertiserId: lead.everflow_advertiser_id };
}

async function syncOneResponse(db: SupabaseClient, leadId: number, month: string): Promise<Response> {
  const lookup = await lookupAdvertiser(db, leadId);
  if (!lookup.ok) return lookup.response;

  const result = await syncMonth(db, leadId, lookup.advertiserId, month);
  if (!result.matched) return json({ ok: true, matched: false, reason: result.reason });
  return json({
    ok: true,
    matched: true,
    revenue: result.revenue,
    payout: result.payout,
    synced_at: result.synced_at,
  });
}

// Manual "Sync from Everflow" default path: walk backward from the current
// month, syncing every month found, until HISTORY_EMPTY_STREAK_STOP
// consecutive months come back empty (we've likely walked past when this
// advertiser started) or HISTORY_MAX_MONTHS is hit (hard safety cap). A
// rate-limit from Everflow stops the walk early rather than failing the
// whole request — whatever synced so far is already committed.
async function syncHistory(db: SupabaseClient, leadId: number): Promise<Response> {
  const lookup = await lookupAdvertiser(db, leadId);
  if (!lookup.ok) return lookup.response;

  let month = monthRange().start;
  let synced = 0;
  let checked = 0;
  let emptyStreak = 0;
  let stopped: "no_data" | "cap" | "rate_limited" = "cap";

  for (; checked < HISTORY_MAX_MONTHS; checked++) {
    let result: MonthSyncResult;
    try {
      result = await syncMonth(db, leadId, lookup.advertiserId, month);
    } catch (e) {
      if (e instanceof EverflowError && e.code === "rate_limited") {
        stopped = "rate_limited";
        break;
      }
      throw e;
    }

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
  }

  return json({ ok: true, historySync: true, synced, checked, stopped });
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
  for (const lead of leads ?? []) {
    for (const month of [currentMonth, prevMonth]) {
      try {
        const res = await syncOneResponse(db, lead.id, month);
        const body = await res.clone().json();
        if (body.matched) synced++;
        else skipped++;
      } catch {
        skipped++;
      }
    }
  }
  return json({ ok: true, synced, skipped });
}
