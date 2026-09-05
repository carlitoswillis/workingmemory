"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getUserBoards } from "@/lib/boards";
import {
  addList,
  deleteList,
  ensureLists,
  getListLabels,
  getLists,
  listExists,
  renameList,
  reorderLists,
} from "@/lib/columns";
import { DEMO_MODE, getBoardContext, getMainDb } from "@/lib/db";
import {
  demoteToCard,
  getProvenance,
  promoteSubtree,
  setLinkedBoard,
  type Provenance,
} from "@/lib/doorways";
import { setParent } from "@/lib/nesting";
import { formatRecurrence, parseRecurrence } from "@/lib/recurrence";
import { pokeBoard } from "@/lib/realtime";
import { addBlocked, clampDemoText, clampDemoDetails } from "@/lib/demo/limits";
import type { ListDef } from "@/lib/lists";
import {
  getArchivedItems,
  getHistory,
  getItem,
  getItems,
  getTimelineData,
} from "@/lib/queries";
import { searchItems, searchTerms } from "@/lib/search";
import type { SearchHit } from "@/lib/search";
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

// After a write: revalidate the acting client's own view (root-layout scope covers
// "/" and "/b/[id]"), AND poke the board's real-time bus so every OTHER open session
// on that board refetches within a debounce (notify-then-pull — see lib/realtime.ts +
// the SSE route). Self-poke isn't filtered; one extra debounced refresh is invisible.
function revalidateBoard(boardId: string | null) {
  revalidatePath("/", "layout");
  pokeBoard(boardId);
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
  revalidateBoard(bid);
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
  revalidateBoard(bid);
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
  revalidateBoard(bid);
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
  revalidateBoard(bid);
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
  revalidateBoard(bid);
}

// Move cards into another card (parentId set) or back out onto the board (null) —
// drag a card onto another card's nest strip, or use the "Inside" picker in the panel.
// The rules (no cycles, no nesting the note, board-scoped ids) live in lib/nesting.ts;
// a refusal comes back as a string for the UI to show. `list` only matters when popping
// out: it's the column the card lands in.
export async function setParentAction(
  boardId: string | null,
  ids: string[],
  parentId: string | null,
  list?: string,
): Promise<string | null> {
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  if (list != null && !listExists(db, bid, list)) return "That column no longer exists.";
  const res = setParent(db, bid, { ids, parentId, actorId: userId, list });
  if ("error" in res) return res.error;
  if (res.moved > 0) revalidateBoard(bid);
  return null;
}

// ---- Card ↔ board doorways -----------------------------------------------------
// A card opens into a board (pointer, not portal — see lib/doorways.ts). Setting or
// clearing the link is an ordinary card edit: one update, journaled by the
// items_log_linked_board_v2 trigger. Membership of the TARGET is what permits it,
// and a refusal comes back as a string for the panel to show.

export async function setLinkedBoardAction(
  boardId: string | null,
  id: string,
  linkedBoardId: string | null,
): Promise<string | null> {
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  const res = setLinkedBoard(db, bid, { id, linkedBoardId, actorId: userId });
  if ("error" in res) return res.error;
  if (res.changed) revalidateBoard(bid);
  return null;
}

// Promote this card's sub-cards onto the board it opens: archived here, recreated
// there, one transaction. Both boards are poked — the cards left one and arrived on
// the other, and anyone looking at either should see it.
export async function promoteSubtreeAction(
  boardId: string | null,
  id: string,
): Promise<string | null> {
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  const res = promoteSubtree(db, bid, { id, actorId: userId });
  if ("error" in res) return res.error;
  revalidateBoard(bid);
  pokeBoard(res.targetBoardId);
  return null;
}

// "Convert back to a regular card" — promotion's inverse. The linked board's cards
// come back as sub-cards and the link clears; the emptied board stays alive.
export async function demoteToCardAction(
  boardId: string | null,
  id: string,
): Promise<string | null> {
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  const res = demoteToCard(db, bid, { id, actorId: userId });
  if ("error" in res) return res.error;
  revalidateBoard(bid);
  pokeBoard(res.sourceBoardId);
  return null;
}

// Follow a card's `converted_from` pointer back to the card it continues from, so
// the panel's History can offer "view original". Null when the viewer isn't on the
// board the original lives on (or it's since been deleted).
export async function provenanceAction(
  boardId: string | null,
  id: string,
): Promise<Provenance | null> {
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  const card = getItem(db, bid, id);
  if (!card?.converted_from) return null;
  return getProvenance(db, userId, card.converted_from);
}

export async function toggleDoneAction(boardId: string | null, id: string, done: boolean) {
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  db.prepare("update items set done = ?, touched_by = ? where id = ? and board_id is ?").run(
    done ? 1 : 0,
    userId,
    id,
    bid,
  );
  revalidateBoard(bid);
}

// Archive/restore, one card or a block of them. The plural form is what the board's
// multi-select archive and its undo run through: one transaction and ONE revalidation,
// so ten cards leaving the board is one re-render rather than ten. The DB trigger logs
// each flip to history either way (see lib/schema.ts).
function setArchived(boardId: string | null, ids: string[], archived: 0 | 1) {
  if (ids.length === 0) return;
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  const stmt = db.prepare(
    "update items set archived = ?, touched_by = ? where id = ? and board_id is ?",
  );
  db.transaction(() => {
    for (const id of ids) stmt.run(archived, userId, id, bid);
  })();
  revalidateBoard(bid);
}

export async function archiveItemAction(boardId: string | null, id: string) {
  setArchived(boardId, [id], 1);
}

export async function unarchiveItemAction(boardId: string | null, id: string) {
  setArchived(boardId, [id], 0);
}

export async function archiveItemsAction(boardId: string | null, ids: string[]) {
  setArchived(boardId, ids, 1);
}

export async function unarchiveItemsAction(boardId: string | null, ids: string[]) {
  setArchived(boardId, ids, 0);
}

// Archived items for the Archive view (browse + restore). Loaded on demand when the
// panel opens, mirroring historyAction/timelineDataAction.
export async function archivedItemsAction(boardId: string | null): Promise<Item[]> {
  const { db, boardId: bid } = getBoardContext(boardId);
  return getArchivedItems(db, bid);
}

// "none" | "daily" | "weekly:<0-6>" — normalized through lib/recurrence.ts, so
// anything unrecognised lands on "none" rather than in the column.
// One card by id (archived included) — how the search overlay opens something that
// isn't on the live board it already has.
export async function getItemAction(
  boardId: string | null,
  id: string,
): Promise<Item | null> {
  const { db, boardId: bid } = getBoardContext(boardId);
  return getItem(db, bid, id);
}

export async function setRecurrenceAction(boardId: string | null, id: string, recurrence: string) {
  const value = formatRecurrence(parseRecurrence(recurrence));
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  db.prepare("update items set recurrence = ?, touched_by = ? where id = ? and board_id is ?").run(
    value,
    userId,
    id,
    bid,
  );
  revalidateBoard(bid);
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
  revalidateBoard(bid);
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
  revalidateBoard(bid);
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
  revalidateBoard(bid);
}

// ---- Columns (user-created "lists") --------------------------------------------
// The board's columns are data (a `lists` table — see lib/columns.ts). CRUD lives
// here so it's scoped + revalidated like every other mutation. Delete returns a
// reason string on refusal (last column / still holds cards) for the UI to surface.

export async function reorderListsAction(boardId: string | null, order: string[]) {
  const { db, boardId: bid } = getBoardContext(boardId);
  reorderLists(db, bid, order);
  revalidateBoard(bid);
}

export async function addListAction(boardId: string | null, label: string): Promise<string | null> {
  const { db, boardId: bid } = getBoardContext(boardId);
  const res = addList(db, bid, label);
  if ("error" in res) return res.error;
  revalidateBoard(bid);
  return null;
}

export async function renameListAction(boardId: string | null, id: string, label: string) {
  const { db, boardId: bid } = getBoardContext(boardId);
  if (renameList(db, bid, id, label)) revalidateBoard(bid);
}

export async function deleteListAction(boardId: string | null, id: string): Promise<string | null> {
  const { db, boardId: bid } = getBoardContext(boardId);
  const res = deleteList(db, bid, id);
  if ("error" in res) return res.error;
  revalidateBoard(bid);
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
  revalidateBoard(bid);
}

// The half of search that isn't already in the browser: ARCHIVED cards. The live board
// is searched client-side with the same pure matcher (lib/search.ts) — this is the
// debounced server trip the overlay makes alongside it. Ranking happens here so only
// the hits cross the wire.
export async function searchArchivedAction(
  boardId: string | null,
  query: string,
): Promise<SearchHit[]> {
  if (searchTerms(query).length === 0) return [];
  const { db, boardId: bid } = getBoardContext(boardId);
  return searchItems(getArchivedItems(db, bid), query, 10);
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

// ---- Phone app -----------------------------------------------------------------
// The phone sheets (components/phone/*) live in a subtree that may be mounted beside
// the desktop board rather than inside it, so they can't count on being handed the
// board as props. This is their one read: everything a sheet needs, in a single trip,
// through the same scoped choke point as every other action.
//
// It's a FALLBACK, not the normal path — when the phone shell provides its board data
// through <PhoneDataProvider>, no sheet ever calls this. It exists so package B is
// correct on its own, whatever the shell around it ends up doing.

export type PhoneBoardSnapshot = {
  items: Item[];
  lists: ListDef[];
  listLabels: Record<string, string>;
  boards: { id: string; name: string }[];
};

export async function phoneBoardDataAction(
  boardId: string | null,
): Promise<PhoneBoardSnapshot> {
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  ensureLists(db, bid);
  return {
    items: getItems(db, bid),
    lists: getLists(db, bid),
    listLabels: getListLabels(db, bid),
    // The board switcher's list. Empty off the hosted instance, where there is
    // exactly one board and nothing to switch to.
    boards: userId
      ? getUserBoards(getMainDb(), userId).map((b) => ({ id: b.id, name: b.name }))
      : [],
  };
}
