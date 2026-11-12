// The request SESSION machine, written down once. Pure (no cookies, no DB, no Node
// imports) so lib/db.ts (node) and middleware.ts (edge) share the same rules and plain
// node can test them.
//
//   none     no session cookie at all  -> a visitor. The throwaway demo board is intended.
//   valid    token verifies, user exists -> the owner board (membership checked later)
//   invalid  a session cookie IS present but does not verify (expired, SESSION_SECRET
//            rotated, user deleted)     -> NEVER a visitor. Reads send the person to
//            sign in; writes fail loudly. Falling through to the demo store would
//            report success for a capture that lands in a file swept after 24 h.
//
// Transitions: none --login--> valid --(expiry | secret rotation | user deleted)--> invalid
//              invalid --login--> valid     invalid --cookie cleared--> none

export type SessionState = "none" | "valid" | "invalid";

// `verified` = the token's user id when it verifies (signature + expiry), else null;
// `userExists` = whether that account is still in the users table.
export function classifySession(args: {
  hasToken: boolean;
  verified: string | null;
  userExists: boolean;
}): SessionState {
  if (!args.hasToken) return "none";
  return args.verified && args.userExists ? "valid" : "invalid";
}

export class UnauthenticatedError extends Error {
  readonly code = "unauthenticated";
  constructor() {
    super("Your session has expired. Sign in again.");
    this.name = "UnauthenticatedError";
  }
}

// What the edge middleware does with a request, given the session state it can see.
//   pass       carry on (visitor flow / valid session / the sign-in pages themselves)
//   login      a page navigation with a dead session: clear the cookie, go to /login
//   reject     anything else (server action POST, fetch, API): 401 + clear the cookie
// Bearer-token API callers (the Shortcut, the brain bridge) send an Authorization header
// and no session cookie; they are never touched.
export function sessionGate(args: {
  state: SessionState;
  method: string;
  path: string;
  hasAuthorization: boolean;
}): "pass" | "login" | "reject" {
  if (args.state !== "invalid") return "pass";
  if (args.hasAuthorization) return "pass";
  if (args.path === "/login" || args.path === "/signup") return "pass";
  return args.method === "GET" || args.method === "HEAD" ? "login" : "reject";
}
