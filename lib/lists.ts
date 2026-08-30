// The board's columns. Since 2026-07-07 columns are USER-CREATED data (a `lists`
// table — see lib/schema.ts + lib/columns.ts), not a fixed const. What remains here
// is dependency-free and shared by server + client:
//   - DEFAULT_LISTS: the five columns every new board is seeded with, mirroring the
//     paper "working memory" note. Their ids are stable ("today"…"braindump") so
//     items created before columns became data still resolve.
//   - ListDef / ListId: the shapes components and queries pass around.

export type ListDef = { id: string; label: string; hint: string };

// A column id is now just a string (default ids below, or a uuid for one you make).
export type ListId = string;

export const DEFAULT_LISTS: ListDef[] = [
  { id: "today", label: "Today", hint: "What you're actually doing today" },
  { id: "focus", label: "Focus", hint: "Currently on your mind / in progress" },
  { id: "waiting", label: "Waiting / Later", hint: "Parked — not now, but don't forget" },
  { id: "backlog", label: "Backlog", hint: "Someday / maybe" },
  { id: "braindump", label: "Brain Dump", hint: "Capture now, sort later" },
];

// The sentinel list of the pinned daily note (items.list='note'). Never a real
// column — it has its own dedicated area on the board, so it can't be created,
// renamed, deleted, or reordered.
export const NOTE_LIST = "note";

// The sentinel list of the AI weekly review (items.list='review'). Same shape as
// the note: ONE pinned item per board whose body lives in `details`, so every
// regeneration is journaled by the details trigger and the time machine becomes
// the archive of past reviews. It is written only by POST /api/review (the
// generator runs off-box — see scripts/weekly-review.mjs) and renders read-only.
export const REVIEW_LIST = "review";

// Lists that are NOT columns: they own a dedicated slot on the board and are
// excluded from grouping, dragging, search, and column CRUD. One predicate so a
// third sentinel never has to be chased through the codebase again.
export function isSentinelList(id: string): boolean {
  return id === NOTE_LIST || id === REVIEW_LIST;
}

// Guardrails for user-created columns.
export const MAX_LIST_LABEL = 40;
export const MAX_LISTS = 16; // beyond this the board grid stops being usable
