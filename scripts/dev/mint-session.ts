// Mint a v2 session token for a user id, using the app's OWN signer
// (lib/auth.ts#signUserSession) rather than reimplementing the HMAC here.
//
//   npx tsx scripts/dev/mint-session.ts <userId> <secret>
//
// Prints the raw token to stdout (nothing else) so a caller can capture it
// directly — see scripts/dev/capture-phone.mjs.

import { SESSION_MAX_AGE_S, signUserSession } from "../../lib/auth.ts";

const [userId, secret] = process.argv.slice(2);
if (!userId || !secret) {
  console.error("usage: mint-session.ts <userId> <secret>");
  process.exit(1);
}

const expiresAtMs = Date.now() + SESSION_MAX_AGE_S * 1000;
process.stdout.write(signUserSession(secret, userId, expiresAtMs));
