"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  addList,
  deleteList,
  listExists,
  renameList,
  reorderLists,
} from "@/lib/columns";
import { DEMO_MODE, getBoardContext } from "@/lib/db";
import { addBlocked, clampDemoText, clampDemoDetails } from "@/lib/demo/limits";
import { getArchivedItems, getHistory, getTimelineData } from "@/lib/queries";
import type { Item, ItemEvent } from "@/lib/types";

// Mutations are plain CRUD against the request's board ({db, userId, boardId} from
// lib/db.ts#getBoardContext(boardId)) — the DB triggers append the history events
// (see lib/schema.ts). Shared-boards scoping: the client passes the boardId it's
// viewing; getBoardContext verifies membership ONCE (the choke point) then every
// read filters `board_id IS ?` and every mutation carries `and board_id is ?`, so
// knowing a card's id is never enough to touch it from another board (IDOR guard).
// On local/demo boards boardId is null and IS null matches the whole file — same
// SQL shape. Inserts/updates also stamp `touched_by` = the acting user, which the
// triggers copy into item_events.actor_id ("who did it"); null off the hosted
// instance. Hosted boards get size caps here; write RATE limiting lives in
// middleware.ts.

// The board renders at "/" (personal + local + demo) and "/b/[id]" (other boards);
// revalidating the root layout refreshes whichever route is showing.
function revalidateBoard() {
  revalidatePath("/", "layout");
}

export async function addItemAction(boardId: string | null, text: string, list: string) {
  let t = text.trim();
  if (!t) return;
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  if (!listExists(db, bid, list)) return;
  if (DEMO_MODE) {
    if (addBlocked(db, bid)) return;
    t = clampDemoText(t);
  }
  db.prepare(
    "insert into items (id, text, list, position, user_id, board_id, touched_by) values (?, ?, ?, ?, ?, ?, ?)",
  ).run(randomUUID(), t, list, Date.now(), userId, bid, userId);
  revalidateBoard();
}

// Add a sub-card under `parentId`. The child is a real item (so it gets history,
// recurrence, the panel) and inherits the parent's list — children never render as
// top-level board cards, but `list` is NOT NULL so we keep it sensible.
export async function addChildAction(boardId: string | null, parentId: string, text: string) {
  let t = text.trim();
  if (!t) return;
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  if (DEMO_MODE) {
    if (addBlocked(db, bid)) return;
    t = clampDemoText(t);
  }
  const parent = db
    .prepare("select list from items where id = ? and board_id is ?")
    .get(parentId, bid) as { list: string } | undefined;
  if (!parent?.list) return;
  db.prepare(
    "insert into items (id, text, list, parent_id, position, user_id, board_id, touched_by) values (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(randomUUID(), t, parent.list, parentId, Date.now(), userId, bid, userId);
  revalidateBoard();
}

export async function editItemAction(boardId: string | null, id: string, text: string) {
  let t = text.trim();
  if (!t) return;
  if (DEMO_MODE) t = clampDemoText(t);
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  db.prepare("update items set text = ?, touched_by = ? where id = ? and board_id is ?").run(
    t,
    userId,
    id,
    bid,
  );
  revalidateBoard();
}

export async function editDetailsAction(boardId: string | null, id: string, details: string) {
  // details may be empty (cleared); no trim-reject.
  const d = DEMO_MODE ? clampDemoDetails(details) : details;
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  db.prepare("update items set details = ?, touched_by = ? where id = ? and board_id is ?").run(
    d,
    userId,
    id,
    bid,
  );
  revalidateBoard();
}

export async function moveItemAction(boardId: string | null, id: string, list: string) {
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  if (!listExists(db, bid, list)) return;
  db.prepare("update items set list = ?, touched_by = ? where id = ? and board_id is ?").run(
    list,
    userId,
    id,
    bid,
  );
  revalidateBoard();
}

export async function toggleDoneAction(boardId: string | null, id: string, done: boolean) {
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  db.prepare("update items set done = ?, touched_by = ? where id = ? and board_id is ?").run(
    done ? 1 : 0,
    userId,
    id,
    bid,
  );
  revalidateBoard();
}

export async function archiveItemAction(boardId: string | null, id: string) {
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  db.prepare("update items set archived = 1, touched_by = ? where id = ? and board_id is ?").run(
    userId,
    id,
    bid,
  );
  revalidateBoard();
}

// Restore an archived item back onto the board (archived 1 -> 0). The DB trigger
// logs the restore to history (see lib/schema.ts).
export async function unarchiveItemAction(boardId: string | null, id: string) {
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  db.prepare("update items set archived = 0, touched_by = ? where id = ? and board_id is ?").run(
    userId,
    id,
    bid,
  );
  revalidateBoard();
}

// Archived items for the Archive view (browse + restore). Loaded on demand when the
// panel opens, mirroring historyAction/timelineDataAction.
export async function archivedItemsAction(boardId: string | null): Promise<Item[]> {
  const { db, boardId: bid } = getBoardContext(boardId);
  return getArchivedItems(db, bid);
}

export async function setRecurrenceAction(boardId: string | null, id: string, recurrence: string) {
  const value = recurrence === "daily" ? "daily" : "none";
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  db.prepare("update items set recurrence = ?, touched_by = ? where id = ? and board_id is ?").run(
    value,
    userId,
    id,
    bid,
  );
  revalidateBoard();
}

// Check/uncheck a daily task for a given local date (null = uncheck).
export async function setDailyDoneAction(
  boardId: string | null,
  id: string,
  completedOn: string | null,
) {
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  db.prepare("update items set completed_on = ?, touched_by = ? where id = ? and board_id is ?").run(
    completedOn,
    userId,
    id,
    bid,
  );
  revalidateBoard();
}

export async function reorderItemAction(
  boardId: string | null,
  id: string,
  list: string,
  position: number,
) {
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  if (!listExists(db, bid, list)) return;
  db.prepare(
    "update items set position = ?, list = ?, touched_by = ? where id = ? and board_id is ?",
  ).run(position, list, userId, id, bid);
  revalidateBoard();
}

// Move/reorder many cards at once (multi-select drag) — one transaction so the
// board never sees a half-applied move.
export async function reorderItemsAction(
  boardId: string | null,
  updates: { id: string; list: string; position: number }[],
) {
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  const valid = updates.filter((u) => listExists(db, bid, u.list));
  if (valid.length === 0) return;
  const stmt = db.prepare(
    "update items set position = ?, list = ?, touched_by = ? where id = ? and board_id is ?",
  );
  const run = db.transaction((rows: typeof valid) => {
    for (const r of rows) stmt.run(r.position, r.list, userId, r.id, bid);
  });
  run(valid);
  revalidateBoard();
}

// ---- Columns (user-created "lists") --------------------------------------------
// The board's columns are data (a `lists` table — see lib/columns.ts). CRUD lives
// here so it's scoped + revalidated like every other mutation. Delete returns a
// reason string on refusal (last column / still holds cards) for the UI to surface.

export async function reorderListsAction(boardId: string | null, order: string[]) {
  const { db, boardId: bid } = getBoardContext(boardId);
  reorderLists(db, bid, order);
  revalidateBoard();
}

export async function addListAction(boardId: string | null, label: string): Promise<string | null> {
  const { db, boardId: bid } = getBoardContext(boardId);
  const res = addList(db, bid, label);
  if ("error" in res) return res.error;
  revalidateBoard();
  return null;
}

export async function renameListAction(boardId: string | null, id: string, label: string) {
  const { db, boardId: bid } = getBoardContext(boardId);
  if (renameList(db, bid, id, label)) revalidateBoard();
}

export async function deleteListAction(boardId: string | null, id: string): Promise<string | null> {
  const { db, boardId: bid } = getBoardContext(boardId);
  const res = deleteList(db, bid, id);
  if ("error" in res) return res.error;
  revalidateBoard();
  return null;
}

// The daily note is a SINGLE pinned item with list='note' (body in `details`), so every
// edit is change-tracked + time-traveled — the time machine is the journal. There's only
// ever one per board; you clear and rewrite it each day rather than spawning new ones.
// This just creates it the first time (idempotent).
export async function createNoteAction(boardId: string | null) {
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  const existing = db
    .prepare(
      "select id from items where list = 'note' and archived = 0 and parent_id is null and board_id is ? limit 1",
    )
    .get(bid);
  if (existing) return;
  if (DEMO_MODE && addBlocked(db, bid)) return;
  db.prepare(
    "insert into items (id, text, list, details, user_id, board_id, touched_by) values (?, 'Daily note', 'note', '', ?, ?, ?)",
  ).run(randomUUID(), userId, bid, userId);
  revalidateBoard();
}

export async function historyAction(boardId: string | null, id: string): Promise<ItemEvent[]> {
  const { db, boardId: bid } = getBoardContext(boardId);
  return getHistory(db, bid, id);
}

// Ship the whole (small, per-board) event log to the client so the time-machine
// scrubber can reconstruct any past moment locally — no per-tick server round-trip.
export async function timelineDataAction(
  boardId: string | null,
): Promise<{ items: Item[]; events: ItemEvent[] }> {
  const { db, boardId: bid } = getBoardContext(boardId);
  return getTimelineData(db, bid);
}
