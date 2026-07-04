import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Account sessions (multiple-accounts v1, 2026-07-04). Users live in a `users`
// table in the main hosted DB; sessions stay STATELESS — the token itself
// carries the user id + expiry under an HMAC keyed by the `SESSION_SECRET` env
// var. No session store: tokens survive restarts/redeploys, and rotating the
// secret invalidates every outstanding session at once. With DEMO_MODE off
// none of this is used (local mode has no auth concept).
//
// Token = `v2.<userId>.<expiresAtMs>.<hmacHex>`, HMAC-SHA256 keyed by
// SESSION_SECRET over `wm-user.<userId>.<exp>`. (v1 was the retired
// single-owner format; OWNER_SECRET now only guards /api/export|import.)
//
// This module is pure node:crypto (no Next imports) so `node lib/users.test.ts`
// can exercise it directly. Middleware runs on the edge runtime and uses the
// WebCrypto twin in lib/auth-edge.ts — keep the token format in sync.

export const SESSION_COOKIE = "wm_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 90; // 90 days

const PREFIX = "v2";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const sha256 = (s: string) => createHash("sha256").update(s).digest();

// Length-safe constant-time string compare: hash both sides first so
// timingSafeEqual always gets equal-length buffers.
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

function mac(secret: string, userId: string, exp: string): string {
  return createHmac("sha256", secret).update(`wm-user.${userId}.${exp}`).digest("hex");
}

export function signUserSession(secret: string, userId: string, expiresAtMs: number): string {
  const exp = String(expiresAtMs);
  return `${PREFIX}.${userId}.${exp}.${mac(secret, userId, exp)}`;
}

// Returns the token's user id, or null if the token is invalid/expired.
export function verifyUserSession(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): string | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  const [, userId, exp, sig] = parts;
  if (!UUID_RE.test(userId) || !/^\d{1,15}$/.test(exp)) return null;
  if (!safeEqual(sig, mac(secret, userId, exp)) || Number(exp) <= nowMs) return null;
  return userId;
}

// ---------------------------------------------------------------------------
// Password hashing — scrypt (node:crypto, no new deps). Stored as
// `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>` so parameters can be raised later
// without invalidating existing hashes.

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const N = Number(n);
  const expected = Buffer.from(hashB64, "base64");
  if (!Number.isInteger(N) || expected.length === 0) return false;
  try {
    const got = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
      N,
      r: Number(r),
      p: Number(p),
    });
    return timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}
