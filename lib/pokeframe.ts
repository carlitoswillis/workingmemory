// The SSE frame the board stream sends, and the client's rule for when a frame means
// "refetch". Client-safe (no Node imports), so Board.tsx and plain-node tests share it.
//
//   h  max(item_events.id) for the board: catches history-writing changes made while the
//      client was disconnected.
//   v  the server's per-board poke counter (lib/realtime.ts): catches changes that
//      journal nothing (reorders, column add/rename/delete/reorder, a card leaving).

export interface PokeFrame {
  h: number;
  v: number;
}

export function parsePokeFrame(data: string): PokeFrame | null {
  try {
    const j = JSON.parse(data);
    if (typeof j?.h !== "number") return null;
    return { h: j.h, v: typeof j.v === "number" ? j.v : 0 };
  } catch {
    return null;
  }
}

// `last` is null until the baseline (first) frame. Compare for inequality: the counter
// resets when the server restarts, and h can fall when a card moves to another board.
export function frameChanged(last: PokeFrame | null, next: PokeFrame): boolean {
  return last !== null && (next.h !== last.h || next.v !== last.v);
}
