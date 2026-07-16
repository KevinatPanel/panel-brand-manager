// everflow-sync: two entry paths, distinguished by auth.
//   - Manual (the rep's JWT, via functions.invoke from the "Sync" button):
//     { leadId, month?, force? } — syncs one client's one month (default: the
//     current month).
//   - Scheduled batch (service role only, via pg_cron — see
//     docs/everflow-integration-setup.md): {} — loops every client with an
//     everflow_advertiser_id set, syncing the current + previous month (the
//     previous month catches late conversion corrections after month-close).
//
// Response contract (so the client stays simple): handled outcomes return
// HTTP 200 with { ok, matched, ... }; only auth/bad-input/unexpected use
// non-2xx.
//   - matched:    { ok:true, matched:true, revenue, payout, synced_at }
//   - no match:   { ok:true, matched:false, reason }
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
    return await syncOne(db, payload.leadId, monthRange(payload.month).start);
  } catch (e) {
    if (e instanceof EverflowError) {
      const error = e.code === "rate_limited" ? "rate_limited" : e.code;
      return json({ ok: false, error, message: e.message });
    }
    return json({ ok: false, error: "sync_failed", message: String((e as Error)?.message ?? e) }, 500);
  }
});

async function syncOne(db: SupabaseClient, leadId: number, month: string): Promise<Response> {
  const { data: lead, error } = await db
    .from("leads")
    .select("id, everflow_advertiser_id")
    .eq("id", leadId)
    .single();
  if (error || !lead) return json({ ok: false, error: "not_found", message: "Lead not found." }, 404);

  if (!lead.everflow_advertiser_id) {
    return json({ ok: true, matched: false, reason: "Add an Everflow Advertiser ID first." });
  }

  const { start, end } = monthRange(month);
  const result = await fetchAdvertiserRevenue(lead.everflow_advertiser_id, start, end);
  if (!result) {
    return json({ ok: true, matched: false, reason: "No Everflow data for this advertiser in this month." });
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
  if (upErr) return json({ ok: false, error: "sync_failed", message: upErr.message }, 500);

  return json({ ok: true, matched: true, revenue: result.revenue, payout: result.payout, synced_at: now });
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
        const res = await syncOne(db, lead.id, month);
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
