// gmail-scan-start: called by the authenticated client to (re)launch a one-time
// inbox scan. Verifies the rep's JWT, resets their gmail_scan_jobs row to
// 'queued', and kicks off gmail-backfill (service role) which then self-chains
// batch-by-batch. Returns immediately — the client polls gmail_scan_jobs for
// progress.
import { serviceClient, userFromRequest } from "../_shared/supabase.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const user = await userFromRequest(req);
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const db = serviceClient();

  // Require an active Gmail connection before scanning.
  const { data: conn } = await db
    .from("gmail_connections")
    .select("status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!conn || conn.status !== "active") {
    return new Response(JSON.stringify({ error: "Gmail not connected" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const now = new Date().toISOString();
  const up = await db.from("gmail_scan_jobs").upsert(
    {
      user_id: user.id,
      status: "queued",
      page_token: null,
      processed_count: 0,
      suggested_count: 0,
      error: null,
      started_at: now,
      updated_at: now,
    },
    { onConflict: "user_id" },
  );
  if (up.error) {
    return new Response(JSON.stringify({ error: up.error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Kick the first batch (fire-and-forget); gmail-backfill self-chains the rest.
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (url && key) {
    const p = fetch(`${url}/functions/v1/gmail-backfill`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {});
    const wu = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
    if (wu?.waitUntil) wu.waitUntil(p);
  }

  return new Response(JSON.stringify({ status: "queued" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
