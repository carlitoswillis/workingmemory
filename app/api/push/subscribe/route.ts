import { NextResponse, type NextRequest } from "next/server";
import { DEMO_MODE, getMainDb, getRequestUserId } from "@/lib/db";
import {
  deleteSubscription,
  isPushConfigured,
  parseSubscription,
  pushUserId,
  upsertSubscription,
  vapidPublicKey,
} from "@/lib/push";

// The phone app's own push registration, session-authenticated (the ordinary
// wm_session cookie — NOT the brain bearer; this is the owner's browser talking
// about its own device).
//
//   GET    → {configured, publicKey}   what the client needs before it can call
//                                      pushManager.subscribe()
//   POST   → body is a PushSubscription's toJSON(); upserted by endpoint
//   DELETE → body {endpoint}; removes that device
//
// Unset VAPID keys = the feature doesn't exist, so POST/DELETE 404 (the
// BRAIN_TOKEN / OWNER_SECRET pattern). GET still answers, with configured:false,
// because PushSettings.tsx needs to render "not set up" rather than an error.

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // better-sqlite3 is a native module; not edge

function currentUserId(): string | null {
  return pushUserId(DEMO_MODE, getRequestUserId());
}

export async function GET() {
  return NextResponse.json(
    { configured: isPushConfigured(), publicKey: vapidPublicKey() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  if (!isPushConfigured()) return new NextResponse("Not found", { status: 404 });
  const userId = currentUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Body must be JSON", { status: 400 });
  }
  const sub = parseSubscription(body);
  if (!sub) return new NextResponse("Not a PushSubscription", { status: 400 });

  // Re-POSTed on every app open as a heartbeat, so this must stay idempotent —
  // the endpoint's UNIQUE index does that (lib/push.ts).
  upsertSubscription(getMainDb(), userId, sub, req.headers.get("user-agent"));
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: NextRequest) {
  if (!isPushConfigured()) return new NextResponse("Not found", { status: 404 });
  const userId = currentUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  let body: { endpoint?: unknown };
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Body must be JSON", { status: 400 });
  }
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) return new NextResponse("`endpoint` is required", { status: 400 });

  const removed = deleteSubscription(getMainDb(), userId, endpoint);
  return NextResponse.json({ ok: true, removed }, { headers: { "Cache-Control": "no-store" } });
}
