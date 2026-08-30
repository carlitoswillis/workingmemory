import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { brainBearerOk, resolveOwnerBoard } from "@/lib/bridge";
import { getMainDb } from "@/lib/db";
import { REVIEW_LIST } from "@/lib/lists";
import { pokeBoard } from "@/lib/realtime";

// POST /api/review — receive the generated weekly review; GET /api/review — read
// the current one back. The hosted app does NOT generate: there is no model key
// and no LLM dependency here. Generation happens off-box, by hand, in
// scripts/weekly-review.mjs (a `claude -p` / ollama child process over a DB
// snapshot), and the finished markdown is POSTed here. Nothing on this box is
// scheduled — the script is run when the owner runs it.
//
// Storage is the daily-note pattern: ONE sentinel item per board
// (list='review', body in `details`). Each POST rewrites that one row, so the
// details trigger journals every version into item_events — the time machine is
// the archive of past reviews, with no new table and no schema change.
//
// Auth: `Authorization: Bearer <BRAIN_TOKEN>`, the same ops bearer as
// /api/context and /api/items. Unset BRAIN_TOKEN = the endpoint doesn't exist.

export const dynamic = "force-dynamic";

// A 250–400-word review is ~3KB. The cap is generous enough for a long one and
// small enough that this endpoint can never be used to stuff the DB.
const MAX_MARKDOWN = 20000;

type Sentinel = { id: string; details: string; updated_at: string };

function findReview(db: ReturnType<typeof getMainDb>, boardId: string): Sentinel | undefined {
  return db
    .prepare(
      `select id, details, updated_at from items
        where list = ? and archived = 0 and parent_id is null and board_id is ?
        order by created_at limit 1`,
    )
    .get(REVIEW_LIST, boardId) as Sentinel | undefined;
}

export async function POST(req: NextRequest) {
  if (!process.env.BRAIN_TOKEN) return new NextResponse("Not found", { status: 404 });
  if (!brainBearerOk(req)) return new NextResponse("Unauthorized", { status: 401 });

  // JSON {markdown} is the documented shape; a raw text/markdown body is accepted
  // too so a bare `curl --data-binary @review.md` works.
  const ctype = req.headers.get("content-type") ?? "";
  let markdown: string;
  if (ctype.includes("application/json")) {
    let body: { markdown?: unknown };
    try {
      body = await req.json();
    } catch {
      return new NextResponse("Body must be JSON", { status: 400 });
    }
    if (typeof body.markdown !== "string") {
      return new NextResponse("`markdown` is required", { status: 400 });
    }
    markdown = body.markdown;
  } else {
    markdown = await req.text();
  }
  markdown = markdown.trim().slice(0, MAX_MARKDOWN);
  if (!markdown) return new NextResponse("`markdown` is required", { status: 400 });

  const db = getMainDb();
  const scope = resolveOwnerBoard(db);
  if (!scope) return new NextResponse("No owner board to write to", { status: 409 });

  const existing = findReview(db, scope.boardId);
  let id: string;
  if (existing) {
    id = existing.id;
    if (existing.details === markdown) {
      // Identical text writes no event (the trigger's `when new.details is not
      // old.details` guard) — say so rather than implying a new version landed.
      return NextResponse.json({
        ok: true,
        id,
        board: scope.boardName,
        generatedAt: existing.updated_at,
        unchanged: true,
      });
    }
    db.prepare("update items set details = ?, touched_by = ? where id = ? and board_id is ?").run(
      markdown,
      scope.ownerId,
      id,
      scope.boardId,
    );
  } else {
    // Insert EMPTY, then update — deliberately two writes. The insert trigger logs
    // only a 'created' event carrying the title, so a body written inline at insert
    // time would be the one version the history never records. The follow-up update
    // fires items_log_details_v2, so version 1 is journaled like every other.
    id = randomUUID();
    db.transaction(() => {
      db.prepare(
        "insert into items (id, text, list, details, position, user_id, board_id, touched_by) values (?, 'Weekly review', ?, '', ?, ?, ?, ?)",
      ).run(id, REVIEW_LIST, Date.now(), scope.ownerId, scope.boardId, scope.ownerId);
      db.prepare("update items set details = ?, touched_by = ? where id = ?").run(
        markdown,
        scope.ownerId,
        id,
      );
    })();
  }

  const saved = findReview(db, scope.boardId);
  revalidatePath("/", "layout");
  pokeBoard(scope.boardId);
  return NextResponse.json({
    ok: true,
    id,
    board: scope.boardName,
    generatedAt: saved?.updated_at ?? null,
    chars: markdown.length,
  });
}

export async function GET(req: NextRequest) {
  if (!process.env.BRAIN_TOKEN) return new NextResponse("Not found", { status: 404 });
  if (!brainBearerOk(req)) return new NextResponse("Unauthorized", { status: 401 });

  const db = getMainDb();
  const scope = resolveOwnerBoard(db);
  if (!scope) return NextResponse.json({ board: null, generatedAt: null, markdown: null });

  const review = findReview(db, scope.boardId);
  return NextResponse.json(
    {
      board: { id: scope.boardId, name: scope.boardName },
      generatedAt: review?.updated_at ?? null,
      markdown: review?.details || null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
