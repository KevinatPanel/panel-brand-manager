// Application-layer encryption for Google tokens. The DB only ever stores
// ciphertext; the key (TOKEN_ENC_KEY, base64 of 32 bytes) lives as a Supabase
// function secret. AES-GCM with a random 12-byte IV per message; output is
// base64(iv || ciphertext+tag).
//
// We also use the same key (HKDF-derived) to HMAC-sign the OAuth `state` param
// so the callback can trust the user id it carries without a DB round-trip.

function b64encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function b64decode(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function b64urlencode(bytes: Uint8Array): string {
  return b64encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urldecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return b64decode(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

function rawKey(): Uint8Array {
  const k = Deno.env.get("TOKEN_ENC_KEY");
  if (!k) throw new Error("TOKEN_ENC_KEY not set");
  const bytes = b64decode(k);
  if (bytes.length !== 32) throw new Error("TOKEN_ENC_KEY must be 32 bytes (base64)");
  return bytes;
}

async function aesKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", rawKey(), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encrypt(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey();
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64encode(out);
}

export async function decrypt(payload: string): Promise<string> {
  const bytes = b64decode(payload);
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const key = await aesKey();
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// ---- Signed OAuth state ----------------------------------------------------

async function hmacKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    rawKey(),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

// state = base64url(payloadJSON) + "." + base64url(hmac)
export async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = b64urlencode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(body)),
  );
  return `${body}.${b64urlencode(sig)}`;
}

export async function verifyState<T = Record<string, unknown>>(
  state: string,
): Promise<T | null> {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    b64urldecode(sig),
    new TextEncoder().encode(body),
  );
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64urldecode(body))) as T;
  } catch {
    return null;
  }
}
