// The desktop board's MODE machine and its undo stack. Pure (no React, no DOM) so the
// rules can be tested with plain node and every mutation entry point asks the same
// question.
//
//   live      the real board; every mutation is allowed
//   rewound   the time machine is showing a past moment, read-only; NOTHING may write
//
//   live --pickMoment--> rewound --backToNow--> live
//
// Mode is derived from "is there a snapshot", never stored twice. Mutation entry points
// (capture, search-open-card, archive, undo, add) all gate on canMutate(mode) — including
// keyboard shortcuts, which the buttons' own `!snapshot` render guards do not cover.

export type BoardMode = "live" | "rewound";

export function boardMode(snapshot: unknown | null | undefined): BoardMode {
  return snapshot ? "rewound" : "live";
}

export function canMutate(mode: BoardMode): boolean {
  return mode === "live";
}

// ---------------------------------------------------------------------------
// Undo. An entry reverses one gesture. It is only safe to run while the board still
// looks the way the gesture left it: after a while, or after anything touched the
// cards it moved (another session, another edit), "undo" would stomp newer state.
// So every entry carries the cards it affects and what each looked like right after
// the gesture; popping re-reads them and refuses a stale entry.
// ---------------------------------------------------------------------------

export const UNDO_TTL_MS = 2 * 60_000;

export interface UndoEntry {
  label: string;
  ids: string[];
  expect: Record<string, string>; // id -> signature right after the gesture
  at: number;
  run: () => void;
}

// What a card looks like for staleness purposes: column + position, or "absent" when it
// is not on the live board (archived / nested away).
export function cardSignature(card: { list: string; position: number } | null | undefined): string {
  return card ? `${card.list}|${card.position}` : "absent";
}

export type UndoPop =
  | { ok: true; entry: UndoEntry }
  | { ok: false; reason: "empty" | "expired" | "changed" };

export class UndoStack {
  private entries: UndoEntry[] = [];
  private ttlMs: number;
  constructor(ttlMs: number = UNDO_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  get size(): number {
    return this.entries.length;
  }

  push(entry: UndoEntry): void {
    this.entries.push(entry);
  }

  // Take the newest entry if it is still fresh and its cards are as the gesture left
  // them. A stale newest entry means the older ones (which sit under it, in order) are
  // not safe either, so the whole stack is dropped.
  pop(now: number, current: (id: string) => string): UndoPop {
    const entry = this.entries.pop();
    if (!entry) return { ok: false, reason: "empty" };
    if (now - entry.at > this.ttlMs) {
      this.entries = [];
      return { ok: false, reason: "expired" };
    }
    if (entry.ids.some((id) => current(id) !== entry.expect[id])) {
      this.entries = [];
      return { ok: false, reason: "changed" };
    }
    return { ok: true, entry };
  }

  // Drop the newest entry (its gesture failed server-side).
  discardLast(): void {
    this.entries.pop();
  }

  clear(): void {
    this.entries = [];
  }
}
