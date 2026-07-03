import { NextResponse } from "next/server";

// Liveness probe for the deploy platform (fly.toml http check). Deliberately
// does NOT touch SQLite — a health check that opens DBs would defeat the
// demo-board TTL sweep's idle detection and keep connections warm for no one.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true });
}
