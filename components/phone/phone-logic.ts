// The phone app's pure logic — everything the React components would otherwise hide
// behind a finger. Kept dependency-free (bar lib/recurrence + lib/lists, which are
// themselves pure) and in a plain .ts file so `node components/phone/phone-logic.test.ts`
// can exercise it without a DOM. See components/collapsibleColumn.ts for the same
// convention.
//
// What lives here: the row's completion state machine (optimistic flip → undo window
// → collapse), the swipe's directional lock and edge guard, the Now screen's section
// derivation, the Lists pager's index maths, and the reorder's position reassignment.

import { effectiveDone, parseRecurrence } from "../../lib/recurrence.ts";
import { isSentinelList } from "../../lib/lists.ts";

// ── The row's completion state machine ───────────────────────────────────────
//
// One tap, zero dialogs, optimistic (spec §3). The flip happens in the tap's own
// handler, before any await; the server action is fired after and never gates the
// UI. For 900ms the row stays put with an inline Undo, then it collapses out of its
// section. A failure pins an error ON THE ROW — never a toast — and puts the
// checkbox back to what the server actually believes.

export type RowPhase =
  | "idle" // settled: whatever `checked` says is what's on screen
  | "undo" // flipped, inline Undo showing, server action in flight
  | "collapsing" // undo window elapsed; height+opacity animating out
  | "gone" // collapse finished; the row belongs to its new section now
  | "error"; // the write failed; state reverted, message pinned on the row

export type RowState = { checked: boolean; phase: RowPhase; error: string | null };

export type RowEvent =
  | { type: "toggle" } // the tap on the check zone (or a swipe-right)
  | { type: "undo" } // the inline Undo button
  | { type: "window-elapsed" } // UNDO_MS passed
  | { type: "collapsed" } // the collapse transition finished
  | { type: "failed"; message: string } // the server action rejected
  | { type: "sync"; checked: boolean }; // fresh server truth arrived

export function rowInitial(checked: boolean): RowState {
  return { checked, phase: "idle", error: null };
}

export function rowNext(state: RowState, event: RowEvent): RowState {
  switch (event.type) {
    case "toggle":
      // Tapping again inside the undo window is an undo — the same intent as the
      // button, so it takes the same path rather than queueing a second write.
      if (state.phase === "undo") return rowNext(state, { type: "undo" });
      return { checked: !state.checked, phase: "undo", error: null };
    case "undo":
      if (state.phase !== "undo") return state;
      return { checked: !state.checked, phase: "idle", error: null };
    case "window-elapsed":
      return state.phase === "undo" ? { ...state, phase: "collapsing" } : state;
    case "collapsed":
      return state.phase === "collapsing" ? { ...state, phase: "gone" } : state;
    case "failed":
      // Put the checkbox back where the server left it and pin the reason. The row
      // is the failure surface; nothing floats.
      return { checked: !state.checked, phase: "error", error: event.message };
    case "sync":
      // Revalidation must not yank a row out from under a finger mid-window.
      if (state.phase === "undo" || state.phase === "collapsing") return state;
      return state.checked === event.checked && !state.error
        ? state
        : { checked: event.checked, phase: "idle", error: null };
  }
}

// Is this row still occupying its ORIGINAL section? True until the collapse has
// finished — which is what keeps a just-checked card visible (with its Undo) for
// 900ms instead of teleporting into "Done today".
export function rowHeldInPlace(state: RowState): boolean {
  return state.phase === "undo" || state.phase === "collapsing";
}

// Only 7 / 30 / 100 get the single 400ms colour pulse. Ordinary days get nothing —
// a celebration on every tick is how a streak stops meaning anything.
export function isMilestone(streak: number): boolean {
  return streak === 7 || streak === 30 || streak === 100;
}

// The accessible name carries the state a sighted user reads off the glyph and the
// number: "Gym, 12 day streak, not done today" (spec §8).
export function rowAriaLabel(
  text: string,
  opts: { checked: boolean; streak?: number; repeats?: boolean },
): string {
  const parts = [text];
  if (opts.repeats && opts.streak && opts.streak > 0) {
    parts.push(`${opts.streak} day streak`);
  }
  parts.push(opts.checked ? "done today" : "not done today");
  return parts.join(", ");
}

// ── Swipe: directional lock + edge guard ─────────────────────────────────────

export type SwipeAxis = "x" | "y" | "pending";

export const SWIPE_COMMIT_PX = 10; // horizontal travel before we claim the gesture
export const SWIPE_RATIO = 2; // …and it must beat vertical travel by this much
export const SWIPE_DECIDE_PX = 15; // the window in which the decision is made
export const SWIPE_EDGE_INSET = 28; // px from either screen edge: iOS back's turf

// Decide who owns the gesture. "pending" means keep watching — the finger hasn't
// travelled far enough to say. Once it has, either we take it ("x") or the browser
// keeps its native vertical scroll ("y") and we never look at it again.
export function lockAxis(dx: number, dy: number): SwipeAxis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax > SWIPE_COMMIT_PX && ax > SWIPE_RATIO * ay) return "x";
  if (Math.hypot(dx, dy) > SWIPE_DECIDE_PX) return "y";
  return "pending";
}

// A horizontal drag that STARTS within 28px of either edge belongs to iOS
// (back/forward). Never race it — the row simply doesn't listen there.
export function withinSwipeZone(
  clientX: number,
  viewportWidth: number,
  inset: number = SWIPE_EDGE_INSET,
): boolean {
  return clientX >= inset && clientX <= viewportWidth - inset;
}

// What a committed horizontal swipe means, once released. Right completes (a
// redundant shortcut for the tap); left reveals the row's actions. Anything short
// of the threshold springs back.
export type SwipeIntent = "complete" | "reveal" | "none";
export const SWIPE_ACTION_PX = 64;
export function swipeIntent(dx: number, threshold: number = SWIPE_ACTION_PX): SwipeIntent {
  if (dx >= threshold) return "complete";
  if (dx <= -threshold) return "reveal";
  return "none";
}

// ── Now: Today / Due today / Done today ──────────────────────────────────────

export type NowItem = {
  id: string;
  list: string;
  done: boolean;
  recurrence: string;
  completed_on: string | null;
  parent_id: string | null;
  archived: boolean;
  updated_at: string;
};

export type NowSection = "today" | "due" | "done";
export type NowSections<T> = { today: T[]; due: T[]; done: T[] };

// The local calendar day an ISO timestamp falls on. The DB writes UTC ISO strings
// (lib/schema.ts ISO_NOW), so the Date does the conversion and the parts are read
// back in the browser's zone — the same day boundary localToday() uses.
export function localDayOf(iso: string): string | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(
    t.getDate(),
  ).padStart(2, "0")}`;
}

// Which of Now's three sections an item belongs to — or null for "not on Now at
// all" (a backlog card, a sub-card, a note/review sentinel, something finished on
// an earlier day).
//
//  - repeating cards are the Due-today spine: done-ness is DERIVED via effectiveDone,
//    never a stored boolean, so a daily card reopens itself at local midnight;
//  - the Today column's own cards fill the top section;
//  - a one-off that was ticked today drops into Done today and is gone tomorrow.
export function sectionOf(item: NowItem, today: string, todayListId: string): NowSection | null {
  if (item.parent_id || item.archived || isSentinelList(item.list)) return null;
  const repeats = parseRecurrence(item.recurrence).kind !== "none";
  const done = effectiveDone(item, today);
  if (repeats) return done ? "done" : "due";
  if (item.list !== todayListId) return null;
  if (!done) return "today";
  return localDayOf(item.updated_at) === today ? "done" : null;
}

// Group a board's items into Now's sections, preserving the incoming (position)
// order. `held` pins rows that are mid-flip to the section they were tapped in, so
// a revalidation landing inside the 900ms undo window can't move them early.
export function deriveNowSections<T extends NowItem>(
  items: readonly T[],
  opts: { today: string; todayListId: string; held?: ReadonlyMap<string, NowSection> },
): NowSections<T> {
  const out: NowSections<T> = { today: [], due: [], done: [] };
  for (const item of items) {
    const pinned = opts.held?.get(item.id);
    const section = pinned ?? sectionOf(item, opts.today, opts.todayListId);
    if (section) out[section].push(item);
  }
  return out;
}

// ── Lists pager ──────────────────────────────────────────────────────────────

// The pages of the Lists pager: every real column except the one Now already owns.
// User-created columns come along; the note and the review never do.
export function pagerLists<T extends { id: string }>(
  lists: readonly T[],
  todayListId: string,
): T[] {
  return lists.filter((l) => l.id !== todayListId && !isSentinelList(l.id));
}

// Which page a horizontal scroll offset is sitting on. Used only to reconcile the
// segmented header after a native snap — never to drive the scroll itself.
export function pageIndexFor(scrollLeft: number, pageWidth: number, pageCount: number): number {
  if (pageWidth <= 0 || pageCount <= 0) return 0;
  const raw = Math.round(scrollLeft / pageWidth);
  return Math.min(pageCount - 1, Math.max(0, raw));
}

// ── Reorder ──────────────────────────────────────────────────────────────────

export type PositionUpdate = { id: string; list: string; position: number };

// Move one card within a list and hand back only the rows whose position actually
// changed. The list's EXISTING position values are reused in the new order, so a
// reorder never invents numbers, never drifts, and never has to renumber the board.
export function reassignPositions<T extends { id: string; position: number }>(
  items: readonly T[],
  from: number,
  to: number,
  list: string,
): PositionUpdate[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [];
  const slots = items.map((i) => i.position).sort((a, b) => a - b);
  const reordered = items.slice();
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);
  const updates: PositionUpdate[] = [];
  reordered.forEach((item, index) => {
    if (item.position !== slots[index]) updates.push({ id: item.id, list, position: slots[index] });
  });
  return updates;
}

// The same move applied locally, so the list settles under the finger instead of
// waiting for the server.
export function applyReorder<T extends { id: string; position: number }>(
  items: readonly T[],
  from: number,
  to: number,
): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items.slice();
  }
  const slots = items.map((i) => i.position).sort((a, b) => a - b);
  const reordered = items.slice();
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);
  return reordered.map((item, index) => ({ ...item, position: slots[index] }));
}

// An empty list is an instruction, not a mood. Each column says the one thing you
// could do about it, in a full sentence — never "— empty —".
//
// (Owned by package P1; P2's PhoneList.tsx is the consumer.)
export function emptyCopyFor(listId: string): string {
  switch (listId) {
    case "focus":
      return "Nothing in Focus right now.";
    case "waiting":
      return "Nothing waiting. Snooze a card here from its row menu.";
    case "backlog":
      return "Backlog's empty.";
    case "braindump":
      return "Nothing dumped yet. Tap Capture to drop a thought.";
    default:
      return "Nothing in this list yet.";
  }
}
