import { NextResponse } from "next/server";
import { DEMO_MODE, getMainDb, getRequestUserId } from "@/lib/db";
import { isPushConfigured, pushUserId, sendToUser } from "@/lib/push";

// POST /api/push/test — the "Send test" button in PushSettings.tsx.
//
// Session cookie auth (the sibling of /api/push/subscribe), and it pushes only
// to the CURRENT user's own devices. That's the whole point: after granting
// permission on a home-screen install you need to see one arrive before you
// trust the 07:30 brief, and the round trip through the real VAPID + service
// worker path is the only thing that proves it. No body — a fixed payload
// keeps this from becoming a second, session-authenticated /api/push/send.

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // better-sqlite3 + web-push are node-only

export async function POST() {
  if (!isPushConfigured()) return new NextResponse("Not found", { status: 404 });
  const userId = pushUserId(DEMO_MODE, getRequestUserId());
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const result = await sendToUser(getMainDb(), userId, {
    title: "Working Memory",
    body: "Notifications are on. This is what they look like.",
    url: "/",
    // Its own tag, so a test never replaces (or is replaced by) a real brief.
    tag: "wm-test",
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
