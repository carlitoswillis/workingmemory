import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { brainBearerOk, completeItem, resolveOwnerBoard } from "@/lib/bridge";
import { getMainDb } from "@/lib/db";
import { pokeBoard } from "@/lib/realtime";

// POST /api/items/complete — mark one item done (or undone) for a day with the
// bearer token; the browser-only setDailyDoneAction/toggleDoneAction are the
// in-app twins. Body: {itemId, date: "YYYY-MM-DD", done}. Recurring items set
// or clear completed_on; one-off items flip done. History is appended by the DB
// triggers (touched_by = the owner). Auth: `Authorization: Bearer <BRAIN_TOKEN>`.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!process.env.BRAIN_TOKEN) return new NextResponse("Not found", { status: 404 });
  if (!brainBearerOk(req)) return new NextResponse("Unauthorized", { status: 401 });

  let body: { itemId?: unknown; date?: unknown; done?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  const { itemId, date, done } = body;
  const dateOk =
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
  if (typeof itemId !== "string" || !itemId || !dateOk || typeof done !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "Need {itemId: string, date: YYYY-MM-DD, done: boolean}" },
      { status: 400 },
    );
  }

  const db = getMainDb();
  const scope = resolveOwnerBoard(db);
  const item = scope ? completeItem(db, scope, itemId, date as string, done) : null;
  if (!scope || !item) {
    return NextResponse.json({ ok: false, error: "Item not found on the owner board" }, { status: 404 });
  }

  revalidatePath("/", "layout");
  pokeBoard(scope.boardId);
  return NextResponse.json({ ok: true, item });
}
