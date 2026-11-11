import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { brainBearerOk, doneMessage, markDoneByName, resolveOwnerBoard } from "@/lib/bridge";
import { getMainDb } from "@/lib/db";
import { pokeBoard } from "@/lib/realtime";

// POST /api/items/done — idempotent "mark <item> done today" by NAME, for the
// iOS Shortcut. Body: {item: "Gym", source?: string}. "Today" is computed here
// in America/Los_Angeles. Answers {marked:true,...} or {marked:false,reason}.
// A second call the same day is a no-op. Auth: Bearer <BRAIN_TOKEN>.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!process.env.BRAIN_TOKEN) return new NextResponse("Not found", { status: 404 });
  if (!brainBearerOk(req)) return new NextResponse("Unauthorized", { status: 401 });

  let body: { item?: unknown; source?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ marked: false, error: "Body must be JSON", message: "Body must be JSON" }, { status: 400 });
  }
  if (typeof body.item !== "string" || !body.item.trim()) {
    return NextResponse.json({ marked: false, error: "Need {item: string}", message: "Need an item name" }, { status: 400 });
  }

  const db = getMainDb();
  const scope = resolveOwnerBoard(db);
  if (!scope) return NextResponse.json({ marked: false, reason: "no owner board", message: "No owner board" }, { status: 404 });
  const res = markDoneByName(db, scope, body.item);
  if (res.marked) {
    revalidatePath("/", "layout");
    pokeBoard(scope.boardId);
  }
  const status = !res.marked && (res.reason === "not found" || res.reason === "ambiguous") ? 404 : 200;
  return NextResponse.json({ ...res, message: doneMessage(res, body.item) }, { status });
}
