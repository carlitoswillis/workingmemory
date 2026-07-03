import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Single-owner session tokens (portfolio plan Phase 1b). There are no user
// tables: ONE secret (`OWNER_SECRET` env var) guards the owner's real board on
// the hosted instance. A valid session routes to the owner DB; everyone else
// stays on the ephemeral demo path. With DEMO_MODE off none of this is used.
//
// Token = `v1.<expiresAtMs>.<hmacHex>` where the HMAC is keyed by OWNER_SECRET
// over the expiry. Stateless — survives restarts/redeploys — and rotating the
// secret invalidates every outstanding session at once.
//
// This module is pure node:crypto (no Next imports) so `node lib/auth.test.ts`
// can exercise it directly. Middleware runs on the edge runtime and uses the
// WebCrypto twin in lib/auth-edge.ts — keep the token format in sync.

export const OWNER_COOKIE = "wm_owner";
export const OWNER_SESSION_MAX_AGE_S = 60 * 60 * 24 * 90; // 90 days

const PREFIX = "v1";

const sha256 = (s: string) => createHash("sha256").update(s).digest();

// Length-safe constant-time string compare: hash both sides first so
// timingSafeEqual always gets equal-length buffers.
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

function mac(secret: string, exp: string): string {
  return createHmac("sha256", secret).update(`wm-owner.${exp}`).digest("hex");
}

export function signOwnerSession(secret: string, expiresAtMs: number): string {
  const exp = String(expiresAtMs);
  return `${PREFIX}.${exp}.${mac(secret, exp)}`;
}

export function verifyOwnerSession(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): boolean {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;
  const [, exp, sig] = parts;
  if (!/^\d{1,15}$/.test(exp)) return false;
  return safeEqual(sig, mac(secret, exp)) && Number(exp) > nowMs;
}

// Password check for the login form — constant-time.
export function checkOwnerPassword(supplied: string, secret: string): boolean {
  return safeEqual(supplied, secret);
}
