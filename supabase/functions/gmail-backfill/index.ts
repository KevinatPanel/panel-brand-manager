// gmail-backfill: one-time historical scan of a rep's SENT mailbox to seed
// people + companies into the review queue. Driven by the service-role bearer
// (kicked off by gmail-scan-start, then self-chained batch-by-batch until done).
//
// A single invocation processes one bounded batch per active scan job: list the
// next page of sent messages, fetch each in full, and file person/company
// suggestions (dedup + extraction live in _shared/suggest.ts). The page cursor +
// counts live on gmail_scan_jobs so the scan survives the Edge Function time
// limit — if more pages remain we re-invoke ourselves to continue.
import { serviceClient } from "../_shared/supabase.ts";
import { Connection, getValidAccessToken, markSynced, requireServiceRole } from "../_shared/connections.ts";
import { GmailMessage, loadIgnoredDomains, suggestFromSentMessage } from "../_shared/suggest.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const BATCH = 25; // messages per job per invocation (each = list + get + extract)

function makeGapi(token: string) {
  return (path: string) =>
    fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

// Re-invoke ourselves to keep draining the queue (fire-and-forget).
function chainNextBatch(): void {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  const p = fetch(`${url}/functions/v1/gmail-backfill`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => {});
  // Let it run past the response when the platform supports it.
  const wu = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (wu?.waitUntil) wu.waitUntil(p);
}

async function processJob(
  db: ReturnType<typeof serviceClient>,
  job: { user_id: string; page_token: string | null; processed_count: number; suggested_count: number },
): Promise<{ user: string; processed: number; suggested: number; more: boolean }> {
  // Connection must still be active to scan.
  const { data: conn } = await db
    .from("gmail_connections")
    .select(
      "user_id, google_email, refresh_token_enc, access_token_enc, access_token_exp, history_id, calendar_sync_token, auto_advance_s1_s2, status",
    )
    .eq("user_id", job.user_id)
    .eq("status", "active")
    .maybeSingle();

  if (!conn) {
    await db.from("gmail_scan_jobs").update({
      status: "error",
      error: "Gmail not connected / needs reauth",
      updated_at: new Date().toISOString(),
    }).eq("user_id", job.user_id);
    return { user: job.user_id, processed: 0, suggested: 0, more: false };
  }

  const token = await getValidAccessToken(db, conn as Connection);
  if (!token) {
    await db.from("gmail_scan_jobs").update({
      status: "error",
      error: "Could not obtain Google access token",
      updated_at: new Date().toISOString(),
    }).eq("user_id", job.user_id);
    return { user: conn.google_email, processed: 0, suggested: 0, more: false };
  }

  const gapi = makeGapi(token);
  const ignoredDomains = await loadIgnoredDomains(db, conn.user_id);

  // List the next page of sent messages.
  const q = new URLSearchParams({ q: "in:sent", maxResults: String(BATCH) });
  if (job.page_token) q.set("pageToken", job.page_token);
  const listRes = await gapi(`/messages?${q.toString()}`);
  if (!listRes.ok) {
    await db.from("gmail_scan_jobs").update({
      status: "error",
      error: `messages.list failed: ${listRes.status}`,
      updated_at: new Date().toISOString(),
    }).eq("user_id", conn.user_id);
    return { user: conn.google_email, processed: 0, suggested: 0, more: false };
  }
  const list = await listRes.json();
  const ids: string[] = (list.messages ?? []).map((m: { id: string }) => m.id);
  const nextPageToken: string | null = list.nextPageToken ?? null;

  let suggested = 0;
  for (const id of ids) {
    const res = await gapi(`/messages/${id}?format=full`);
    if (!res.ok) continue; // deleted / inaccessible
    const msg = (await res.json()) as GmailMessage;
    if (!(msg.labelIds ?? []).includes("SENT")) continue; // defensive
    try {
      if (await suggestFromSentMessage(db, conn as Connection, msg, gapi, ignoredDomains)) {
        suggested++;
      }
    } catch {
      // one bad message must not abort the batch
    }
  }

  const processed = job.processed_count + ids.length;
  const more = !!nextPageToken && ids.length > 0;
  await db.from("gmail_scan_jobs").update({
    status: more ? "running" : "done",
    page_token: nextPageToken,
    processed_count: processed,
    suggested_count: job.suggested_count + suggested,
    error: null,
    updated_at: new Date().toISOString(),
  }).eq("user_id", conn.user_id);
  await markSynced(db, conn.user_id);

  return { user: conn.google_email, processed: ids.length, suggested, more };
}

Deno.serve(async (req) => {
  if (!requireServiceRole(req)) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = serviceClient();
  // One batch for every job still needing work. Mark queued jobs as running.
  const { data: jobs, error } = await db
    .from("gmail_scan_jobs")
    .select("user_id, page_token, processed_count, suggested_count, status")
    .in("status", ["queued", "running"]);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results = [];
  let anyMore = false;
  for (const job of jobs ?? []) {
    if (job.status === "queued") {
      await db.from("gmail_scan_jobs").update({
        status: "running",
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("user_id", job.user_id);
    }
    try {
      const r = await processJob(db, job);
      results.push(r);
      if (r.more) anyMore = true;
    } catch (e) {
      results.push({ user: job.user_id, error: String(e) });
      await db.from("gmail_scan_jobs").update({
        status: "error",
        error: String(e),
        updated_at: new Date().toISOString(),
      }).eq("user_id", job.user_id);
    }
  }

  if (anyMore) chainNextBatch();

  return new Response(JSON.stringify({ jobs: results.length, anyMore, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
