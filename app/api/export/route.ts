import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getMainDb } from "@/lib/db";

// GET /api/export — download a consistent snapshot of the main DB.
// Auth: `Authorization: Bearer <OWNER_SECRET>` ONLY (the Mac pull-backup
// script). Since multiple-accounts v1 the main DB holds EVERY user's board, so
// the old owner-session-cookie path is gone — no browser session may dump the
// whole file; OWNER_SECRET is purely the operator's ops credential now.
//
// Uses better-sqlite3's db.backup() — the online-backup API — because copying a
// live WAL-mode .db file directly would tear (recent writes still live in the
// -wal file). The snapshot lands in a temp file, is read, deleted, and returned
// with a timestamped filename ready for backups/<stamp>/.

export const dynamic = "force-dynamic";

function bearerOk(req: NextRequest, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const supplied = header.slice("Bearer ".length);
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(supplied), h(secret));
}

export async function GET(req: NextRequest) {
  const secret = process.env.OWNER_SECRET;
  // Without a configured secret there is nothing to authenticate against —
  // the endpoint simply doesn't exist (local dev doesn't need it).
  if (!secret) return new NextResponse("Not found", { status: 404 });

  if (!bearerOk(req, secret)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const tmp = path.join(os.tmpdir(), `wm-export-${randomUUID()}.db`);
  try {
    await getMainDb().backup(tmp);
    const buf = fs.readFileSync(tmp);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="wm-${stamp}.db"`,
        "Cache-Control": "no-store",
      },
    });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
