// google-oauth-callback: Google redirects the browser here with ?code&state.
// We verify the signed state (→ user id), exchange the code for tokens, encrypt
// the refresh token, upsert the connection, and redirect back into the app.
// The browser/SPA never sees the code or tokens — the exchange is server-side.
import { serviceClient } from "../_shared/supabase.ts";
import { decryptStateGuard } from "./guard.ts";
import { exchangeCode, emailFromIdToken, scopeList } from "../_shared/google.ts";
import { encrypt } from "../_shared/crypto.ts";

function appRedirect(ok: boolean, reason?: string): Response {
  const base = Deno.env.get("APP_REDIRECT_URL") ?? "/";
  const sep = base.includes("?") ? "&" : "?";
  const url = ok
    ? `${base}${sep}connected=1`
    : `${base}${sep}connected=0&error=${encodeURIComponent(reason ?? "failed")}`;
  return new Response(null, { status: 302, headers: { Location: url } });
}

Deno.serve(async (req) => {
  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const oauthError = params.get("error");

  if (oauthError) return appRedirect(false, oauthError);
  if (!code || !state) return appRedirect(false, "missing_code");

  const claims = await decryptStateGuard(state);
  if (!claims) return appRedirect(false, "bad_state");

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) {
      // Without prompt=consent Google omits the refresh token on re-grant.
      return appRedirect(false, "no_refresh_token");
    }

    const googleEmail = tokens.id_token ? emailFromIdToken(tokens.id_token) : null;
    const refreshEnc = await encrypt(tokens.refresh_token);
    const accessEnc = await encrypt(tokens.access_token);
    const accessExp = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const db = serviceClient();
    const { error } = await db.from("gmail_connections").upsert(
      {
        user_id: claims.uid,
        google_email: googleEmail ?? "unknown",
        scopes: scopeList(),
        refresh_token_enc: refreshEnc,
        access_token_enc: accessEnc,
        access_token_exp: accessExp,
        status: "active",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) return appRedirect(false, "db_error");

    return appRedirect(true);
  } catch (_e) {
    return appRedirect(false, "exchange_failed");
  }
});
