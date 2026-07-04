"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { isListId } from "@/lib/lists";
import { DEMO_MODE, getBoardContext } from "@/lib/db";
import { addBlocked, clampDemoText, clampDemoDetails } from "@/lib/demo/limits";
import { getArchivedItems, getHistory, getTimelineData } from "@/lib/queries";
import type { Item, ItemEvent } from "@/lib/types";

// Mutations are plain CRUD against the request's board ({db, userId} from
// lib/db.ts#getBoardContext()) — the DB triggers append the history events
// (see lib/schema.ts). Scoping (multiple-accounts v1): inserts stamp user_id;
// EVERY update carries `and user_id is ?` so a request can never mutate
// another user's row by guessing its id (on local/demo boards userId is null
// and IS null matches the whole file — same guard, no-op effect). Hosted
// boards get size caps here; write RATE limiting lives in middleware.ts. With
// DEMO_MODE off none of the caps apply.

// The board renders at "/" (accounts + local) AND "/demo" (anonymous hosted
// visitors, whose "/" is the landing page) — layout scope refreshes both.
function revalidateBoard() {
  revalidatePath("/", "layout");
}

export async function addItemAction(text: string, list: string) {
  let t = text.trim();
  if (!t || !isListId(list)) return;
  const { db, userId } = getBoardContext();
  if (DEMO_MODE) {
    if (addBlocked(db, userId)) return;
    t = clampDemoText(t);
  }
  db.prepare(
    "insert into items (id, text, list, position, user_id) values (?, ?, ?, ?, ?)",
  ).run(randomUUID(), t, list, Date.now(), userId);
  revalidateBoard();
}

// Add a sub-card under `parentId`. The child is a real item (so it gets history,
// recurrence, the panel) and inherits the parent's list — children never render as
// top-level board cards, but `list` is NOT NULL so we keep it sensible.
export async function addChildAction(parentId: string, text: string) {
  let t = text.trim();
  if (!t) return;
  const { db, userId } = getBoardContext();
  if (DEMO_MODE) {
    if (addBlocked(db, userId)) return;
    t = clampDemoText(t);
  }
  const parent = db
    .prepare("select list from items where id = ? and user_id is ?")
    .get(parentId, userId) as { list: string } | undefined;
  if (!parent?.list) return;
  db.prepare(
    "insert into items (id, text, list, parent_id, position, user_id) values (?, ?, ?, ?, ?, ?)",
  ).run(randomUUID(), t, parent.list, parentId, Date.now(), userId);
  revalidateBoard();
}

export async function editItemAction(id: string, text: string) {
  let t = text.trim();
  if (!t) return;
  if (DEMO_MODE) t = clampDemoText(t);
  const { db, userId } = getBoardContext();
  db.prepare("update items set text = ? where id = ? and user_id is ?").run(t, id, userId);
  revalidateBoard();
}

export async function editDetailsAction(id: string, details: string) {
  // details may be empty (cleared); no trim-reject.
  const d = DEMO_MODE ? clampDemoDetails(details) : details;
  const { db, userId } = getBoardContext();
  db.prepare("update items set details = ? where id = ? and user_id is ?").run(d, id, userId);
  revalidateBoard();
}

export async function moveItemAction(id: string, list: string) {
  if (!isListId(list)) return;
  const { db, userId } = getBoardContext();
  db.prepare("update items set list = ? where id = ? and user_id is ?").run(list, id, userId);
  revalidateBoard();
}

export async function toggleDoneAction(id: string, done: boolean) {
  const { db, userId } = getBoardContext();
  db.prepare("update items set done = ? where id = ? and user_id is ?").run(
    done ? 1 : 0,
    id,
    userId,
  );
  revalidateBoard();
}

export async function archiveItemAction(id: string) {
  const { db, userId } = getBoardContext();
  db.prepare("update items set archived = 1 where id = ? and user_id is ?").run(id, userId);
  revalidateBoard();
}

// Restore an archived item back onto the board (archived 1 -> 0). The DB trigger
// logs the restore to history (see lib/schema.ts).
export async function unarchiveItemAction(id: string) {
  const { db, userId } = getBoardContext();
  db.prepare("update items set archived = 0 where id = ? and user_id is ?").run(id, userId);
  revalidateBoard();
}

// Archived items for the Archive view (browse + restore). Loaded on demand when the
// panel opens, mirroring historyAction/timelineDataAction.
export async function archivedItemsAction(): Promise<Item[]> {
  const { db, userId } = getBoardContext();
  return getArchivedItems(db, userId);
}

export async function setRecurrenceAction(id: string, recurrence: string) {
  const value = recurrence === "daily" ? "daily" : "none";
  const { db, userId } = getBoardContext();
  db.prepare("update items set recurrence = ? where id = ? and user_id is ?").run(
    value,
    id,
    userId,
  );
  revalidateBoard();
}

// Check/uncheck a daily task for a given local date (null = uncheck).
export async function setDailyDoneAction(id: string, completedOn: string | null) {
  const { db, userId } = getBoardContext();
  db.prepare("update items set completed_on = ? where id = ? and user_id is ?").run(
    completedOn,
    id,
    userId,
  );
  revalidateBoard();
}

export async function reorderItemAction(id: string, list: string, position: number) {
  if (!isListId(list)) return;
  const { db, userId } = getBoardContext();
  db.prepare("update items set position = ?, list = ? where id = ? and user_id is ?").run(
    position,
    list,
    id,
    userId,
  );
  revalidateBoard();
}

// Move/reorder many cards at once (multi-select drag) — one transaction so the
// board never sees a half-applied move.
export async function reorderItemsAction(
  updates: { id: string; list: string; position: number }[],
) {
  const valid = updates.filter((u) => isListId(u.list));
  if (valid.length === 0) return;
  const { db, userId } = getBoardContext();
  const stmt = db.prepare(
    "update items set position = ?, list = ? where id = ? and user_id is ?",
  );
  const run = db.transaction((rows: typeof valid) => {
    for (const r of rows) stmt.run(r.position, r.list, r.id, userId);
  });
  run(valid);
  revalidateBoard();
}

export async function saveListOrderAction(order: string[]) {
  const valid = order.filter(isListId);
  const { db, userId } = getBoardContext();
  db.prepare(
    `insert into profiles (id, list_order, updated_at) values (?, ?, ?)
     on conflict(id) do update set list_order = excluded.list_order, updated_at = excluded.updated_at`,
  ).run(userId ?? "local", JSON.stringify(valid), new Date().toISOString());
  revalidateBoard();
}

// The daily note is a SINGLE pinned item with list='note' (body in `details`), so every
// edit is change-tracked + time-traveled — the time machine is the journal. There's only
// ever one per board; you clear and rewrite it each day rather than spawning new ones.
// This just creates it the first time (idempotent).
export async function createNoteAction() {
  const { db, userId } = getBoardContext();
  const existing = db
    .prepare(
      "select id from items where list = 'note' and archived = 0 and parent_id is null and user_id is ? limit 1",
    )
    .get(userId);
  if (existing) return;
  if (DEMO_MODE && addBlocked(db, userId)) return;
  db.prepare(
    "insert into items (id, text, list, details, user_id) values (?, 'Daily note', 'note', '', ?)",
  ).run(randomUUID(), userId);
  revalidateBoard();
}

export async function historyAction(id: string): Promise<ItemEvent[]> {
  const { db, userId } = getBoardContext();
  return getHistory(db, userId, id);
}

// Ship the whole (small, per-board) event log to the client so the time-machine
// scrubber can reconstruct any past moment locally — no per-tick server round-trip.
export async function timelineDataAction(): Promise<{ items: Item[]; events: ItemEvent[] }> {
  const { db, userId } = getBoardContext();
  return getTimelineData(db, userId);
}
