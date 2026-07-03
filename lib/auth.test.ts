// Run: node lib/auth.test.ts   (plain node script, same convention as the others)
import {
  signOwnerSession,
  verifyOwnerSession,
  checkOwnerPassword,
} from "./auth.ts";
import { verifyOwnerSessionEdge } from "./auth-edge.ts";

let failures = 0;
function ok(label: string, got: boolean, want: boolean) {
  if (got !== want) {
    failures++;
    console.error(`✗ ${label} — got ${got}, want ${want}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

const SECRET = "correct horse battery staple";
const NOW = Date.parse("2026-07-03T12:00:00.000Z");
const FUTURE = NOW + 1000 * 60 * 60; // valid for another hour
const PAST = NOW - 1000; // already expired

const token = signOwnerSession(SECRET, FUTURE);

ok("valid token verifies", verifyOwnerSession(token, SECRET, NOW), true);
ok("expired token rejected", verifyOwnerSession(signOwnerSession(SECRET, PAST), SECRET, NOW), false);
ok("wrong secret rejected", verifyOwnerSession(token, "other secret", NOW), false);
ok("empty token rejected", verifyOwnerSession("", SECRET, NOW), false);
ok("garbage token rejected", verifyOwnerSession("v1.garbage.nope", SECRET, NOW), false);
ok(
  "tampered expiry rejected",
  verifyOwnerSession(`v1.${FUTURE + 999999}.${token.split(".")[2]}`, SECRET, NOW),
  false,
);
ok("truncated mac rejected", verifyOwnerSession(token.slice(0, -2), SECRET, NOW), false);

ok("right password accepted", checkOwnerPassword(SECRET, SECRET), true);
ok("wrong password rejected", checkOwnerPassword("guess", SECRET), false);
ok("empty password rejected", checkOwnerPassword("", SECRET), false);

// The edge (WebCrypto) verifier must agree with the node one on every case.
const edgeCases: [string, string, boolean][] = [
  [token, SECRET, true],
  [signOwnerSession(SECRET, PAST), SECRET, false],
  [token, "other secret", false],
  ["", SECRET, false],
  ["v1.garbage.nope", SECRET, false],
];
Promise.all(
  edgeCases.map(([t, s]) => verifyOwnerSessionEdge(t, s, NOW)),
).then((results) => {
  results.forEach((got, i) => ok(`edge verifier agrees (case ${i + 1})`, got, edgeCases[i][2]));
  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nall auth tests passed");
});
