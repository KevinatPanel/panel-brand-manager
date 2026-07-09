// google-oauth-start: called by the authenticated client. Verifies the rep's
// JWT, mints a signed `state` carrying their user id, and returns the Google
// consent URL. The client then redirects the browser to that URL.
import { userFromRequest } from "../_shared/supabase.ts";
import { signState } from "../_shared/crypto.ts";
import { buildConsentUrl } from "../_shared/google.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // supabase-js functions.invoke also sends apikey + x-client-info — all four
  // must be allowed or the browser blocks the POST after a 200 preflight.
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

  // State is HMAC-signed and short-lived; the callback trusts the uid in it.
  // exp uses the request time passed by the client (Edge runtime has Date).
  const state = await signState({ uid: user.id, exp: Date.now() + 10 * 60 * 1000 });
  const url = buildConsentUrl(state);

  return new Response(JSON.stringify({ url }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
