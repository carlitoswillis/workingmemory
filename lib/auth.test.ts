// Run: node lib/auth.test.ts   (plain node script, same convention as the others)
import {
  signUserSession,
  verifyUserSession,
  hashPassword,
  verifyPassword,
} from "./auth.ts";
import { verifyUserSessionEdge } from "./auth-edge.ts";

let failures = 0;
function ok<T>(label: string, got: T, want: T) {
  if (got !== want) {
    failures++;
    console.error(`✗ ${label} — got ${got}, want ${want}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

const SECRET = "correct horse battery staple";
const USER = "3f2c8a10-1111-4222-8333-444455556666";
const OTHER_USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000";
const NOW = Date.parse("2026-07-04T12:00:00.000Z");
const FUTURE = NOW + 1000 * 60 * 60; // valid for another hour
const PAST = NOW - 1000; // already expired

const token = signUserSession(SECRET, USER, FUTURE);

ok("valid token returns its user id", verifyUserSession(token, SECRET, NOW), USER);
ok("expired token rejected", verifyUserSession(signUserSession(SECRET, USER, PAST), SECRET, NOW), null);
ok("wrong secret rejected", verifyUserSession(token, "other secret", NOW), null);
ok("empty token rejected", verifyUserSession("", SECRET, NOW), null);
ok("garbage token rejected", verifyUserSession("v2.garbage.123.nope", SECRET, NOW), null);
ok("v1-shaped token rejected", verifyUserSession(`v1.${FUTURE}.deadbeef`, SECRET, NOW), null);
ok(
  "tampered expiry rejected",
  verifyUserSession(`v2.${USER}.${FUTURE + 999999}.${token.split(".")[3]}`, SECRET, NOW),
  null,
);
ok(
  "tampered user id rejected (someone else's mac)",
  verifyUserSession(`v2.${OTHER_USER}.${FUTURE}.${token.split(".")[3]}`, SECRET, NOW),
  null,
);
ok("non-uuid user id rejected", verifyUserSession(`v2.owner.${FUTURE}.${token.split(".")[3]}`, SECRET, NOW), null);
ok("truncated mac rejected", verifyUserSession(token.slice(0, -2), SECRET, NOW), null);

const stored = hashPassword("hunter2hunter2");
ok("stored hash is scrypt-tagged", stored.startsWith("scrypt$"), true);
ok("right password accepted", verifyPassword("hunter2hunter2", stored), true);
ok("wrong password rejected", verifyPassword("guess", stored), false);
ok("empty password rejected", verifyPassword("", stored), false);
ok("garbage stored hash rejected", verifyPassword("hunter2hunter2", "not-a-hash"), false);
ok(
  "same password hashes differently (random salt)",
  hashPassword("hunter2hunter2") === stored,
  false,
);

// The edge (WebCrypto) verifier must agree with the node one on every case.
const edgeCases: [string, string, string | null][] = [
  [token, SECRET, USER],
  [signUserSession(SECRET, USER, PAST), SECRET, null],
  [token, "other secret", null],
  ["", SECRET, null],
  ["v2.garbage.123.nope", SECRET, null],
  [`v2.${OTHER_USER}.${FUTURE}.${token.split(".")[3]}`, SECRET, null],
];
Promise.all(
  edgeCases.map(([t, s]) => verifyUserSessionEdge(t, s, NOW)),
).then((results) => {
  results.forEach((got, i) => ok(`edge verifier agrees (case ${i + 1})`, got, edgeCases[i][2]));
  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nall auth tests passed");
});
