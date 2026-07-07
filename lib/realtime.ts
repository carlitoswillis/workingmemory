import { EventEmitter } from "node:events";

// In-process poke bus for real-time (shared boards, phase 2). A mutation calls
// pokeBoard(boardId) after its write; each open SSE connection (app/api/boards/
// [boardId]/stream) subscribes to its board and, on a poke, tells the client to
// refetch (notify-then-pull — the poke carries NO state, so a lost poke costs
// freshness not correctness). One process, one bus: SQLite is single-writer +
// single-instance by architectural commitment, so the writer always shares memory
// with every reader's connection — no broker needed (see the plan §7–§8).
//
// Pure Node (no Next imports) so `node lib/realtime.test.ts` can exercise it. The
// bus is stashed on globalThis so Next's dev hot-reload (re-evaluating modules)
// reuses one emitter, exactly like the DB handles in lib/db.ts.

const g = globalThis as unknown as { __wmBus?: EventEmitter };

function bus(): EventEmitter {
  if (!g.__wmBus) {
    const e = new EventEmitter();
    e.setMaxListeners(0); // one listener per open board view; don't warn on many
    g.__wmBus = e;
  }
  return g.__wmBus;
}

// Channel per board. boardId is never null in practice (local/demo have no SSE),
// but keep the mapping total.
const chan = (boardId: string | null) => `board:${boardId ?? "local"}`;

export function pokeBoard(boardId: string | null): void {
  bus().emit(chan(boardId));
}

// Subscribe a connection to its board; returns an unsubscribe. The SSE route MUST
// call the returned fn on abort — every reconnect adds a listener, so this is the
// one real leak risk in the design (covered by lib/realtime.test.ts).
export function subscribeBoard(boardId: string | null, fn: () => void): () => void {
  const c = chan(boardId);
  bus().on(c, fn);
  return () => {
    bus().off(c, fn);
  };
}

// Current listener count on a board channel — for the leak test.
export function boardListenerCount(boardId: string | null): number {
  return bus().listenerCount(chan(boardId));
}
