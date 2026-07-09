// Service-role Supabase client for Edge Functions. The service role bypasses
// RLS — this is the new trust boundary introduced by the integration, so only
// the functions (never the browser) ever hold this key.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

// Resolve the authenticated user from the caller's bearer token. Used by
// google-oauth-start (which IS called with the rep's JWT) to learn who is
// connecting before redirecting to Google.
export async function userFromRequest(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await serviceClient().auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}
