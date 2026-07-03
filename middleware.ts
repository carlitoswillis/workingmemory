import { NextResponse, type NextRequest } from "next/server";

// Demo-mode edge middleware. With DEMO_MODE off it does nothing at all.
//
// With DEMO_MODE=1 it does two things, both tiny (no SQLite here — native
// modules can't run in middleware; all DB work stays in lib/db.ts):
//   1. Mints the per-visitor board cookie if missing, and injects it into the
//      CURRENT request too, so the very first render already has a board id.
//   2. Rate-limits writes (server actions are POSTs) per visitor — a simple
//      in-memory token bucket, plenty for a single-instance demo deploy.

const DEMO_MODE = process.env.DEMO_MODE === "1";
const COOKIE = "wm_visitor";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const RATE_PER_MS = 30 / 60_000; // refill: 30 writes per minute
const BURST = 60; // bucket size

const buckets = new Map<string, { tokens: number; last: number }>();

function allowWrite(id: string): boolean {
  const now = Date.now();
  const b = buckets.get(id) ?? { tokens: BURST, last: now };
  b.tokens = Math.min(BURST, b.tokens + (now - b.last) * RATE_PER_MS);
  b.last = now;
  if (b.tokens < 1) {
    buckets.set(id, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(id, b);

  // Keep the map bounded: drop buckets idle long enough to be full again.
  if (buckets.size > 2000) {
    for (const [k, v] of buckets) {
      if (now - v.last > BURST / RATE_PER_MS) buckets.delete(k);
    }
  }
  return true;
}

export function middleware(req: NextRequest) {
  if (!DEMO_MODE) return NextResponse.next();

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
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
