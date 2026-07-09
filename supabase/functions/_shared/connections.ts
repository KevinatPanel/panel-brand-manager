// Connection helpers for the pollers: gating poll invocations to the service
// role, and producing a valid (refreshed) Google access token per connection.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { decrypt, encrypt } from "./crypto.ts";
import { refreshAccessToken } from "./google.ts";

// Decode (without verifying) a JWT payload. The gateway already verified the
// signature when verify_jwt=true, so here we only read the role claim.
function jwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    return json.role ?? null;
  } catch {
    return null;
  }
}

// Pollers / backfill must only run from the service role (cron, or one of our
// own functions self-invoking). Reject anon / authenticated callers so a
// logged-in rep can't trigger a global run. Accept either a legacy JWT whose
// role claim is service_role (how pg_cron calls in), or a direct match against
// the injected service-role key (new sb_secret_* keys aren't JWTs, so the role
// claim can't be decoded — string-equality covers that case and stays strict).
export function requireServiceRole(req: Request): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (jwtRole(token) === "service_role") return true;
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return !!svc && token === svc;
}

export interface Connection {
  user_id: string;
  google_email: string;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_token_exp: string | null;
  history_id: string | null;
  calendar_sync_token: string | null;
  auto_advance_s1_s2?: boolean;
  status: string;
}

// Return a usable access token for a connection, refreshing + persisting a new
// one if the cached token is missing or within 60s of expiry. On invalid_grant
// the refresh token is dead: flip the connection to needs_reauth and return null.
export async function getValidAccessToken(
  db: SupabaseClient,
  conn: Connection,
): Promise<string | null> {
  const exp = conn.access_token_exp ? new Date(conn.access_token_exp).getTime() : 0;
  if (conn.access_token_enc && exp > Date.now() + 60_000) {
    return await decrypt(conn.access_token_enc);
  }

  let refreshToken: string;
  try {
    refreshToken = await decrypt(conn.refresh_token_enc);
  } catch {
    return null;
  }

  try {
    const tok = await refreshAccessToken(refreshToken);
    const newExp = new Date(Date.now() + tok.expires_in * 1000).toISOString();
    await db
      .from("gmail_connections")
      .update({
        access_token_enc: await encrypt(tok.access_token),
        access_token_exp: newExp,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", conn.user_id);
    return tok.access_token;
  } catch (e) {
    if ((e as { invalidGrant?: boolean }).invalidGrant) {
      await db
        .from("gmail_connections")
        .update({ status: "needs_reauth", updated_at: new Date().toISOString() })
        .eq("user_id", conn.user_id);
    }
    return null;
  }
}

// Mark a successful sync pass.
export async function markSynced(db: SupabaseClient, userId: string): Promise<void> {
  await db
    .from("gmail_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("user_id", userId);
}
