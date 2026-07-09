// gmail-thread: called by the authenticated client to fetch one full Gmail
// thread on demand for the Review Queue conversation panel. The message body is
// never stored in our DB, so we fetch it live: verify the rep's JWT, load their
// connection, get a valid (refreshed) access token, then GET the thread with
// format=full and extract plaintext per message. Read-only; nothing is persisted.
import { serviceClient, userFromRequest } from "../_shared/supabase.ts";
import { getValidAccessToken, type Connection } from "../_shared/connections.ts";
import { plaintextFromPayload } from "../_shared/extract.ts";

interface GmailHeader {
  name: string;
  value: string;
}

// First value of a header by case-insensitive name (mirrors _shared/suggest.ts).
function header(headers: GmailHeader[], name: string): string | undefined {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ThreadMessage {
  payload?: { headers?: GmailHeader[] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const user = await userFromRequest(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  let threadId: string | undefined;
  try {
    threadId = (await req.json())?.thread_id;
  } catch {
    threadId = undefined;
  }
  if (!threadId) return json({ error: "thread_id is required" }, 400);

  const db = serviceClient();

  // Load this rep's connection (only the columns getValidAccessToken needs).
  const { data: conn } = await db
    .from("gmail_connections")
    .select(
      "user_id, google_email, refresh_token_enc, access_token_enc, access_token_exp, history_id, calendar_sync_token, status",
    )
    .eq("user_id", user.id)
    .maybeSingle();
  if (!conn) return json({ error: "Gmail not connected" }, 400);

  const token = await getValidAccessToken(db, conn as Connection);
  if (!token) return json({ error: "needs_reauth" });

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  // 403 here typically means the connection predates the gmail.readonly scope
  // upgrade (metadata-only grant) — surface as needs_reauth so the UI prompts a
  // reconnect instead of a hard error.
  if (res.status === 401 || res.status === 403) return json({ error: "needs_reauth" });
  if (!res.ok) return json({ error: `Gmail API error (${res.status})` }, 502);

  const thread = await res.json();
  const messages = ((thread.messages ?? []) as ThreadMessage[]).map((m) => {
    const headers = m.payload?.headers ?? [];
    return {
      from: header(headers, "From") ?? "",
      to: header(headers, "To") ?? "",
      date: header(headers, "Date") ?? "",
      subject: header(headers, "Subject") ?? "",
      body: plaintextFromPayload(m.payload),
    };
  });

  return json({ messages });
});
