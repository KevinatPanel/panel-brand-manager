// Verifies the signed OAuth state and enforces its expiry. Returns the claims
// (just the user id we trust) or null if tampered/expired.
import { verifyState } from "../_shared/crypto.ts";

interface StateClaims {
  uid: string;
  exp: number;
}

export async function decryptStateGuard(
  state: string,
): Promise<{ uid: string } | null> {
  const claims = await verifyState<StateClaims>(state);
  if (!claims?.uid || !claims.exp) return null;
  if (Date.now() > claims.exp) return null; // expired (>10 min old)
  return { uid: claims.uid };
}
