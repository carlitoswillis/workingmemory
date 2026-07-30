import { NextResponse, type NextRequest } from "next/server";
import { brainBearerOk, resolveOwnerBoard } from "@/lib/bridge";
import { getMainDb } from "@/lib/db";

// GET /api/context — the owner's active board as triage context for the
// sibling brain app: open items ({list, label, text}) plus asOf (the newest
// write, so the caller can apply its own staleness policy). Read-only and
// ~2KB, replacing the brain app's need to pull the whole DB via /api/export.
// Auth: `Authorization: Bearer <BRAIN_TOKEN>` (see lib/bridge.ts).

export const dynamic = "force-dynamic";

const MAX_ITEMS = 100;

export async function GET(req: NextRequest) {
  if (!process.env.BRAIN_TOKEN) return new NextResponse("Not found", { status: 404 });
  if (!brainBearerOk(req)) return new NextResponse("Unauthorized", { status: 401 });

  const db = getMainDb();
  const scope = resolveOwnerBoard(db);
  if (!scope) return NextResponse.json({ board: null, asOf: null, items: [] });

  const asOf =
    (
      db.prepare("select max(updated_at) as m from items where board_id = ?").get(scope.boardId) as {
        m: string | null;
      }
    ).m ?? null;

  const items = db
    .prepare(
      `select i.list as list, coalesce(l.label, i.list) as label, i.text as text
         from items i
         left join lists l on l.id = i.list and l.board_id is i.board_id
        where i.board_id = ? and i.archived = 0 and i.done = 0
          and i.text is not null and trim(i.text) <> ''
        order by i.position
        limit ${MAX_ITEMS}`,
    )
    .all(scope.boardId);

  return NextResponse.json(
    { board: { id: scope.boardId, name: scope.boardName }, asOf, items },
    { headers: { "Cache-Control": "no-store" } },
  );
}
