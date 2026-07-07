import { getBoardContext } from "@/lib/db";
import { getBoardHighWater } from "@/lib/queries";
import { subscribeBoard } from "@/lib/realtime";

// Server-Sent Events stream for one board (shared boards, phase 2). A GET whose
// response never finishes: the client's EventSource holds it open and we push a
// frame whenever the board changes. Notify-then-pull — each frame carries only the
// board's high-water mark (max item_events.id); the client refetches through its
// normal path (router.refresh), so a dropped frame costs freshness, not correctness.
//
// Auth is the same choke point as everything else: getBoardContext(boardId) verifies
// membership (throws for a non-member) — no session or not a member → 404, never
// confirming the board exists. Request-scoped: the stream is born with the request
// and dies on abort (unsubscribe there — the one real leak risk), so nothing runs
// when nobody's watching (owner's no-background-process rule holds).

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // better-sqlite3 is a native module; not edge

const HEARTBEAT_MS = 25_000; // keep proxies from killing an idle connection

export async function GET(req: Request, { params }: { params: { boardId: string } }) {
  let db, boardId, userId;
  try {
    ({ db, boardId, userId } = getBoardContext(params.boardId));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  // Only a signed-in member of a real board streams (local/demo have no other
  // sessions to sync with — boardId null there).
  if (!userId || !boardId) return new Response("Not found", { status: 404 });
  const bid = boardId;

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          closed = true;
        }
      };
      const poke = () => send(`data: ${JSON.stringify({ h: getBoardHighWater(db, bid) })}\n\n`);

      // Initial frame: the current high-water mark, so a client that reconnects can
      // tell whether it missed changes while disconnected.
      poke();
      unsubscribe = subscribeBoard(bid, poke);
      heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };
      // Abort fires when the client navigates away / closes the tab — the load-bearing
      // unsubscribe (every reconnect would otherwise leak a listener).
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable proxy buffering so frames flush immediately
    },
  });
}
