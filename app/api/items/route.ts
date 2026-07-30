import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { brainBearerOk, resolveOwnerBoard } from "@/lib/bridge";
import { listExists } from "@/lib/columns";
import { getMainDb } from "@/lib/db";
import { pokeBoard } from "@/lib/realtime";

// POST /api/items — the brain app's push channel: create ONE item on the
// owner's active board through the normal write path (plain insert; the DB
// triggers append history, actor-attributed via touched_by). This is the
// front-door alternative to ever letting an outside app write the SQLite
// file. Body: {text, details?, list?} — the card title stays clean; links and
// summaries belong in details (the panel body). list falls back to braindump,
// then the board's first live column. Auth: `Authorization: Bearer <BRAIN_TOKEN>`.

export const dynamic = "force-dynamic";

const MAX_TEXT = 500;
const MAX_DETAILS = 4000;

export async function POST(req: NextRequest) {
  if (!process.env.BRAIN_TOKEN) return new NextResponse("Not found", { status: 404 });
  if (!brainBearerOk(req)) return new NextResponse("Unauthorized", { status: 401 });

  let body: { text?: unknown; details?: unknown; list?: unknown };
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Body must be JSON", { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return new NextResponse("`text` is required", { status: 400 });
  const details =
    typeof body.details === "string" ? body.details.trim().slice(0, MAX_DETAILS) : "";

  const db = getMainDb();
  const scope = resolveOwnerBoard(db);
  if (!scope) return new NextResponse("No owner board to push to", { status: 409 });

  const requested = typeof body.list === "string" ? body.list : "";
  let list = requested && listExists(db, scope.boardId, requested) ? requested : "";
  if (!list && listExists(db, scope.boardId, "braindump")) list = "braindump";
  if (!list) {
    const first = db
      .prepare(
        "select id from lists where board_id is ? and archived = 0 order by position limit 1",
      )
      .get(scope.boardId) as { id: string } | undefined;
    if (!first) return new NextResponse("Board has no lists", { status: 409 });
    list = first.id;
  }

  const id = randomUUID();
  db.prepare(
    "insert into items (id, text, details, list, position, user_id, board_id, touched_by) values (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, text, details, list, Date.now(), scope.ownerId, scope.boardId, scope.ownerId);

  revalidatePath("/", "layout");
  pokeBoard(scope.boardId);
  return NextResponse.json({ ok: true, id, list, board: scope.boardName });
}
