// Edge-runtime twin of lib/auth.ts's verifyUserSession, for middleware.ts
// (edge middleware has no node:crypto; WebCrypto only, hence async). Token
// format must stay in sync with lib/auth.ts: `v2.<userId>.<expiresAtMs>.<hmacHex>`,
// HMAC-SHA256 keyed by SESSION_SECRET over `wm-user.<userId>.<exp>`.

const enc = new TextEncoder();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Constant-time compare of two hex strings (length of the expected MAC is
// public — always 64 chars — so early-exit on length leaks nothing).
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Returns the token's user id, or null if the token is invalid/expired.
export async function verifyUserSessionEdge(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v2") return null;
  const [, userId, exp, sig] = parts;
  if (!UUID_RE.test(userId) || !/^\d{1,15}$/.test(exp)) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(
    await crypto.subtle.sign("HMAC", key, enc.encode(`wm-user.${userId}.${exp}`)),
  );
  if (!safeEqualHex(sig, expected) || Number(exp) <= nowMs) return null;
  return userId;
}
