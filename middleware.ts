import { NextResponse, type NextRequest } from "next/server";
import { verifyUserSessionEdge } from "./lib/auth-edge";

// Hosted-mode edge middleware. With DEMO_MODE off it does nothing at all.
//
// With DEMO_MODE=1 it does four things, all tiny (no SQLite here — native
// modules can't run in middleware; all DB work stays in lib/db.ts):
//   1. Rate-limits login attempts (POST /login) per IP.
//   2. Rate-limits signups (POST /signup) per IP, stricter.
//   3. Lets a valid account session straight through — no visitor cookie, no
//      demo write limits (verified here so a forged cookie can't skip #4;
//      lib/db.ts re-verifies before routing to the main accounts DB).
//   4. For everyone else: mints the per-visitor board cookie if missing
//      (injected into the CURRENT request too, so the very first render
//      already has a board id) and rate-limits writes (server actions are
//      POSTs) per visitor — a simple in-memory token bucket, plenty for a
//      single-instance deploy.

const DEMO_MODE = process.env.DEMO_MODE === "1";
const COOKIE = "wm_visitor";
const SESSION_COOKIE = "wm_session";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Bucket = { tokens: number; last: number };
const buckets = new Map<string, Bucket>();

// Generic token bucket over the shared map; refillPerMs sets sustained rate,
// burst sets the cap. Bounded by dropping buckets idle long enough to be full.
function allow(key: string, refillPerMs: number, burst: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: burst, last: now };
  b.tokens = Math.min(burst, b.tokens + (now - b.last) * refillPerMs);
  b.last = now;
  const ok = b.tokens >= 1;
  if (ok) b.tokens -= 1;
  buckets.set(key, b);

  if (buckets.size > 2000) {
    for (const [k, v] of buckets) {
      if (now - v.last > 10 * 60_000) buckets.delete(k);
    }
  }
  return ok;
}

// Visitor writes: 30/min sustained, burst 60.
const allowWrite = (id: string) => allow(`w:${id}`, 30 / 60_000, 60);
// Login attempts: 1 per 12s sustained, burst 5 — per IP.
const allowLogin = (ip: string) => allow(`l:${ip}`, 1 / 12_000, 5);
// Signups: 1 per 5min sustained, burst 3 — per IP (open signup, so strictest).
const allowSignup = (ip: string) => allow(`s:${ip}`, 1 / 300_000, 3);

function clientIp(req: NextRequest): string {
  return (
    req.ip ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export async function middleware(req: NextRequest) {
  if (!DEMO_MODE) return NextResponse.next();

  const secret = process.env.SESSION_SECRET;
  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value ?? "";
  const signedIn =
    !!secret &&
    !!sessionToken &&
    (await verifyUserSessionEdge(sessionToken, secret)) !== null;

  // Auth attempts get their own, much stricter limits (per IP, not per visitor
  // cookie — an attacker can mint cookies freely).
  if (req.method === "POST" && !signedIn) {
    const path = req.nextUrl.pathname;
    if (path === "/login" && !allowLogin(clientIp(req))) {
      return new NextResponse("Too many attempts — try again in a minute.", {
        status: 429,
      });
    }
    if (path === "/signup" && !allowSignup(clientIp(req))) {
      return new NextResponse("Too many signups — try again later.", { status: 429 });
    }
    if (path === "/login" || path === "/signup") return NextResponse.next();
  }

  // A signed-in account is not a demo visitor: no visitor cookie, no demo
  // write limits (per-account caps apply in app/actions.ts instead).
  if (signedIn) return NextResponse.next();

  let id = req.cookies.get(COOKIE)?.value?.toLowerCase() ?? "";
  const mint = !UUID_RE.test(id);
  if (mint) {
    id = crypto.randomUUID();
    // Make this request carry the cookie too (updates the Cookie header that
    // NextResponse.next({ request }) forwards), so the first page load reads
    // the same board id it will keep.
    req.cookies.set(COOKIE, id);
  }

  if (req.method === "POST" && !allowWrite(id)) {
    return new NextResponse("Demo rate limit — slow down a little.", { status: 429 });
  }

  const res = NextResponse.next({ request: { headers: req.headers } });
  if (mint) {
    res.cookies.set(COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
  }
  return res;
}

export const config = {
  // Skip static assets; everything else (pages + server actions) goes through.
  // The icons and the manifest are included: they're fetched on nearly every
  // cold load, and without this each one would mint a visitor cookie.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|icon-[\\w-]+\\.png|apple-icon\\.png|manifest\\.webmanifest).*)",
  ],
};
