import { NextResponse, type NextRequest } from "next/server";
import { brainBearerOk, resolveOwnerBoard } from "@/lib/bridge";
import { getMainDb } from "@/lib/db";
import { buildPayload, isPushConfigured, LOCAL_PUSH_USER_ID, sendToUser } from "@/lib/push";

// POST /api/push/send — the Mac assistant's outbound channel to the phone.
//
// There is deliberately NO scheduler in this app (the owner's
// no-background-process rule): the 07:30 "Today" and 21:00 "Nightly log"
// moments are LaunchAgents on the Mac that curl this route. Same bearer as
// GET /api/context and POST /api/items (BRAIN_TOKEN, lib/bridge.ts), so the
// assistant already holding that token gains one verb, not a new credential;
// unset BRAIN_TOKEN = the endpoint doesn't exist.
//
// Body: {title, body?, url?, tag?}. Recipients are every device subscribed by
// the BRIDGE OWNER — the same account resolveOwnerBoard() picks — because the
// token is the owner's, not an account selector. Returns {sent, pruned};
// pruned counts subscriptions the push service reported 404/410 for, which are
// deleted so a reinstalled app doesn't leave a dead row forever.
//
//   curl -X POST "$WM_URL/api/push/send" \
//     -H "Authorization: Bearer $WM_BRAIN_TOKEN" \
//     -H 'Content-Type: application/json' \
//     -d '{"title":"Today","body":"3 due · Gym, Standup, Taxes","url":"/"}'

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // better-sqlite3 + web-push are node-only

export async function POST(req: NextRequest) {
  if (!process.env.BRAIN_TOKEN) return new NextResponse("Not found", { status: 404 });
  if (!brainBearerOk(req)) return new NextResponse("Unauthorized", { status: 401 });
  if (!isPushConfigured()) {
    return new NextResponse("Push is not configured (VAPID keys unset)", { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Body must be JSON", { status: 400 });
  }
  // Shape it here as well as inside sendToUser so a title-less body is a 400
  // rather than a silent {sent:0} the Mac-side script would never notice.
  if (!buildPayload(body as Record<string, unknown>)) {
    return new NextResponse("`title` is required", { status: 400 });
  }

  const db = getMainDb();
  // Local mode has no users table to resolve against; subscriptions there live
  // under the sentinel id (lib/push.ts).
  const userId = resolveOwnerBoard(db)?.ownerId ?? LOCAL_PUSH_USER_ID;

  const result = await sendToUser(db, userId, body as Record<string, unknown>);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
