// Run: node lib/session-state.test.ts   (plain node script, same convention as the others)
//
// The request session machine (lib/session-state.ts): no session = visitor, valid =
// owner board, invalid/expired = never a visitor.

import { UnauthenticatedError, classifySession, sessionGate } from "./session-state.ts";

let failures = 0;
function ok(label: string, got: unknown, want: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) {
    failures++;
    console.error(`✗ ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

ok("no cookie is a visitor (demo intended)", classifySession({ hasToken: false, verified: null, userExists: false }), "none");
ok("verifying token + existing user is valid", classifySession({ hasToken: true, verified: "u1", userExists: true }), "valid");
ok("expired / rotated-secret token is INVALID, not a visitor", classifySession({ hasToken: true, verified: null, userExists: false }), "invalid");
ok("token for a deleted user is INVALID", classifySession({ hasToken: true, verified: "u1", userExists: false }), "invalid");

const g = (state: "none" | "valid" | "invalid", method: string, path = "/", hasAuthorization = false) =>
  sessionGate({ state, method, path, hasAuthorization });
ok("visitor passes", g("none", "POST"), "pass");
ok("valid session passes", g("valid", "POST"), "pass");
ok("dead session + page load -> sign in", g("invalid", "GET", "/"), "login");
ok("dead session + server action POST is rejected (never reaches a demo store)", g("invalid", "POST", "/"), "reject");
ok("dead session + JSON API write is rejected", g("invalid", "POST", "/api/items"), "reject");
ok("the sign-in page itself stays reachable", g("invalid", "GET", "/login"), "pass");
ok("signing in again (POST /login) stays reachable", g("invalid", "POST", "/login"), "pass");
ok("bearer-token callers (the Shortcut) are never touched", g("invalid", "POST", "/api/items/done", true), "pass");

const e = new UnauthenticatedError();
ok("the error is explicit", [e.name, e.code], ["UnauthenticatedError", "unauthenticated"]);

console.log(failures === 0 ? "\nall session-state tests passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
