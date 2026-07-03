// Edge-runtime twin of lib/auth.ts's verifyOwnerSession, for middleware.ts
// (edge middleware has no node:crypto; WebCrypto only, hence async). Token
// format must stay in sync with lib/auth.ts: `v1.<expiresAtMs>.<hmacHex>`,
// HMAC-SHA256 keyed by OWNER_SECRET over `wm-owner.<exp>`.

const enc = new TextEncoder();

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

export async function verifyOwnerSessionEdge(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const [, exp, sig] = parts;
  if (!/^\d{1,15}$/.test(exp)) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`wm-owner.${exp}`)));
  return safeEqualHex(sig, expected) && Number(exp) > nowMs;
}
