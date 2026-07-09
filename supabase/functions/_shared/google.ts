// Google OAuth + token helpers shared by the OAuth and poller functions.

// gmail.readonly (supersedes gmail.metadata) so the inbox scan + go-forward
// extractor can read message bodies + signatures, not just headers. NOTE: this
// is a scope upgrade — existing connections keep their old (metadata-only) grant
// until the rep reconnects, so the body-reading scan will 403 for them until
// they re-consent via "Reconnect".
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email",
];

export function scopeList(): string[] {
  return SCOPES;
}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} not set`);
  return v;
}

// Build the consent URL. access_type=offline + prompt=consent guarantees a
// refresh token on every connect (so reconnect always re-issues one).
export function buildConsentUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    redirect_uri: env("GOOGLE_REDIRECT_URI"),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      redirect_uri: env("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

// Exchange a refresh token for a fresh access token. Throws on invalid_grant so
// the caller can flip the connection to needs_reauth.
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`token refresh failed: ${res.status} ${body}`);
    // surface invalid_grant specifically (revoked / expired refresh token)
    (err as { invalidGrant?: boolean }).invalidGrant = body.includes("invalid_grant");
    throw err;
  }
  return await res.json();
}

// Decode the email + sub from an id_token without verifying the signature
// (it comes straight from Google's token endpoint over TLS).
export function emailFromIdToken(idToken: string): string | null {
  try {
    const payload = idToken.split(".")[1];
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    return json.email ?? null;
  } catch {
    return null;
  }
}
