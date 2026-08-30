import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
// .ts extensions so plain-node tests can import these modules (see lib/nesting.ts).
import { NOTE_LIST } from "./lists.ts";
import { ensureLists, getLists, listExists } from "./columns.ts";
import { getBoardName, getMembership } from "./boards.ts";

// Card ↔ board doorways (2026-08-30). A card stays an ordinary card on its home
// board — its own done/column/history, drag, archive — and OPENS INTO another
// board. **Pointer, not portal**: the card never mirrors the linked board's items.
// Items live in exactly one place; the card is a doorway plus a live count.
//
// Pure functions over an explicit { db, boardId } handle — no Next imports — so
// `node lib/doorways.test.ts` runs them against a scratch DB. The server actions
// (app/actions.ts, app/boards/actions.ts) supply the handle from getBoardContext().
//
// Two authorization rules, both enforced here:
//   1. Installing a doorway requires membership of the TARGET board. A caller who
//      isn't on it gets a 404-shaped "No such board." — never a confirmation that
//      the board exists (the shared-boards rule).
//   2. The link itself is card content, visible to every member of the HOME board,
//      but the target's NAME and COUNT resolve only for a viewer who is a member of
//      it (getDoorwayMeta). A non-member sees a neutral, inert "Linked board" chip.
//
// The link change is one plain `update items set linked_board_id = ?`; the history
// event is written by items_log_linked_board_v2 (lib/schema.ts), never here.

const POSITION_GAP = 1000;

export type DoorwayMeta = { name: string; open: number };

// Where a card came from across a promote/demote seam — the "Continued from …"
// line in the panel's History.
export type Provenance = {
  itemId: string;
  text: string;
  boardId: string | null;
  boardName: string | null;
};

type CardRow = {
  id: string;
  text: string;
  list: string;
  parent_id: string | null;
  archived: number;
  linked_board_id: string | null;
};

// A full row as promotion/demotion copies it across the seam.
type SubtreeRow = {
  id: string;
  text: string;
  details: string;
  list: string;
  done: number;
  recurrence: string;
  completed_on: string | null;
  parent_id: string | null;
  position: number;
};

const SUBTREE_COLS =
  "id, text, details, list, done, recurrence, completed_on, parent_id, position";

function getCard(
  db: Database.Database,
  boardId: string | null,
  id: string,
): CardRow | undefined {
  return db
    .prepare(
      "select id, text, list, parent_id, archived, linked_board_id from items where id = ? and board_id is ?",
    )
    .get(id, boardId) as CardRow | undefined;
}

/**
 * Set (or clear) the board a card opens into.
 *
 * Refusals, all shaped as user-facing strings the panel surfaces:
 *  - the card isn't on this board (the usual IDOR guard);
 *  - the daily note (list='note') — same exclusion nesting uses;
 *  - linking a board to itself;
 *  - a target the caller isn't a member of, which reads as "No such board." so a
 *    stranger's board is never even confirmed to exist.
 *
 * Clearing (linkedBoardId null) needs no target check — you can always take a
 * doorway back out, and the card becomes an ordinary card again.
 */
export function setLinkedBoard(
  db: Database.Database,
  boardId: string | null,
  opts: { id: string; linkedBoardId: string | null; actorId: string | null },
): { ok: true; changed: boolean } | { error: string } {
  const { id, linkedBoardId, actorId } = opts;
  const card = getCard(db, boardId, id);
  if (!card) return { error: "That card is no longer on this board." };
  if (card.list === NOTE_LIST) return { error: "The daily note can't open a board." };

  if (linkedBoardId !== null) {
    if (boardId !== null && linkedBoardId === boardId) {
      return { error: "A card can't open the board it's already on." };
    }
    // Membership of the TARGET is the permission to install a doorway. No session
    // (local/demo) means there are no boards to link, so the same refusal applies.
    if (!actorId || !getMembership(db, linkedBoardId, actorId)) {
      return { error: "No such board." };
    }
  }
  if (card.linked_board_id === linkedBoardId) return { ok: true, changed: false };

  db.prepare(
    "update items set linked_board_id = ?, touched_by = ? where id = ? and board_id is ?",
  ).run(linkedBoardId, actorId, id, boardId);
  return { ok: true, changed: true };
}

// How many open cards are waiting behind a doorway: TOP-LEVEL cards that aren't
// done and aren't archived — the number you'd feel walking in. Computed at read
// time from the live DB; never stored, never synced.
export function countOpenCards(db: Database.Database, boardId: string): number {
  return (
    db
      .prepare(
        "select count(*) c from items where board_id = ? and archived = 0 and done = 0 and parent_id is null",
      )
      .get(boardId) as { c: number }
  ).c;
}

/**
 * Name + open count for each linked board the VIEWER is a member of.
 *
 * Boards the viewer isn't on are simply absent from the map — the UI then draws a
 * neutral "Linked board" chip with no name, no count, no navigation, so a doorway
 * on a shared board leaks nothing about a board you're not part of. One query per
 * distinct linked board on the page; a board has few doorways.
 *
 * The count is live: it refreshes when the HOME board re-renders. A change on the
 * linked board doesn't poke this board's SSE bus (realtime is per-board by design),
 * so the number can lag until the next refresh. Accepted, by design.
 */
export function getDoorwayMeta(
  db: Database.Database,
  viewerId: string | null,
  linkedBoardIds: readonly string[],
): Record<string, DoorwayMeta> {
  const out: Record<string, DoorwayMeta> = {};
  if (!viewerId) return out;
  for (const id of new Set(linkedBoardIds)) {
    if (!id) continue;
    if (!getMembership(db, id, viewerId)) continue; // non-member: nothing resolves
    const name = getBoardName(db, id);
    if (name === null) continue; // deleted out from under us
    out[id] = { name, open: countOpenCards(db, id) };
  }
  return out;
}

// Every live (non-archived) descendant of `rootId`, parents before children, so
// recreating them in order always finds the new parent id already mapped.
function liveSubtree(
  db: Database.Database,
  boardId: string | null,
  rootId: string,
): SubtreeRow[] {
  const kids = db.prepare(
    `select ${SUBTREE_COLS} from items
     where parent_id = ? and board_id is ? and archived = 0
     order by position asc, created_at asc`,
  );
  const out: SubtreeRow[] = [];
  const seen = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const row of kids.all(parent, boardId) as SubtreeRow[]) {
      if (seen.has(row.id)) continue; // a hand-edited cycle can't spin us forever
      seen.add(row.id);
      out.push(row);
      queue.push(row.id);
    }
  }
  return out;
}

// The column a promoted block should land in on the target board: its Backlog if it
// has one (the plan's landing spot), else its first live column. ensureLists seeds a
// brand-new board — "New board from this card" creates one that has never rendered.
function landingList(db: Database.Database, boardId: string): string | null {
  ensureLists(db, boardId);
  if (listExists(db, boardId, "backlog")) return "backlog";
  return getLists(db, boardId)[0]?.id ?? null;
}

function maxPosition(
  db: Database.Database,
  boardId: string | null,
  where: string,
  arg: string | null,
): number {
  return (
    db
      .prepare(
        `select coalesce(max(position), 0) m from items where ${where} and board_id is ?`,
      )
      .get(arg, boardId) as { m: number }
  ).m;
}

// Copy a block of cards onto another board / under another parent, preserving the
// shape of the tree via an old-id → new-id map. Roots get fresh positions at the end
// of their destination; deeper cards keep their own position, which only orders them
// among their siblings. `converted_from` records the source card, so the recreated
// card's History can point back at the original (which is archived, not deleted).
function recreate(
  db: Database.Database,
  opts: {
    roots: SubtreeRow[];
    descendants: SubtreeRow[];
    destBoardId: string | null;
    destList: string;
    destParentId: string | null;
    startPosition: number;
    actorId: string | null;
  },
): number {
  const { roots, descendants, destBoardId, destList, destParentId, startPosition, actorId } =
    opts;
  const insert = db.prepare(
    `insert into items
       (id, text, details, list, done, recurrence, completed_on, parent_id, position,
        archived, user_id, board_id, touched_by, converted_from)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
  );
  const idMap = new Map<string, string>();
  let cursor = startPosition;

  for (const r of roots) {
    const newId = randomUUID();
    idMap.set(r.id, newId);
    cursor += POSITION_GAP;
    insert.run(
      newId, r.text, r.details, destList, r.done, r.recurrence, r.completed_on,
      destParentId, cursor, actorId, destBoardId, actorId, r.id,
    );
  }
  // Ordered parents-before-children by liveSubtree, so the parent is always mapped.
  for (const r of descendants) {
    const parent = r.parent_id ? idMap.get(r.parent_id) : null;
    if (!parent) continue; // its parent didn't come along; skip rather than orphan
    const newId = randomUUID();
    idMap.set(r.id, newId);
    insert.run(
      newId, r.text, r.details, destList, r.done, r.recurrence, r.completed_on,
      parent, r.position, actorId, destBoardId, actorId, r.id,
    );
  }
  return idMap.size;
}

function archiveRows(
  db: Database.Database,
  boardId: string | null,
  ids: string[],
  actorId: string | null,
): void {
  const stmt = db.prepare(
    "update items set archived = 1, touched_by = ? where id = ? and board_id is ? and archived = 0",
  );
  for (const id of ids) stmt.run(actorId, id, boardId);
}

/**
 * PROMOTION — "promote this card's sub-cards to the board it opens".
 *
 * Archive here, recreate there (plan §6b): one transaction that archives the
 * doorway card's live sub-tree on the home board — journaled by the existing
 * archived trigger, so the home board's timeline truthfully shows the cards leaving
 * at that moment, and they stay browsable in its Archive — then inserts fresh rows
 * on the target board, nesting preserved by the old-id → new-id walk.
 *
 * `items` has no board_id trigger and the whole read path assumes a row's board is
 * forever (getTimelineData filters `board_id is ?`), so re-homing rows would make
 * the OLD board's past lie. This is the honest alternative: both timelines stay
 * truthful, and the only cost is that per-card history restarts at the seam — with
 * the full trail reachable through `converted_from`.
 */
export function promoteSubtree(
  db: Database.Database,
  boardId: string | null,
  opts: { id: string; actorId: string | null },
): { ok: true; moved: number; targetBoardId: string } | { error: string } {
  const { id, actorId } = opts;
  const card = getCard(db, boardId, id);
  if (!card) return { error: "That card is no longer on this board." };
  const target = card.linked_board_id;
  if (!target) return { error: "This card doesn't open a board yet." };
  if (!actorId || !getMembership(db, target, actorId)) return { error: "No such board." };

  const roots = db
    .prepare(
      `select ${SUBTREE_COLS} from items
       where parent_id = ? and board_id is ? and archived = 0
       order by position asc, created_at asc`,
    )
    .all(id, boardId) as SubtreeRow[];
  if (roots.length === 0) return { error: "This card has no sub-cards to promote." };
  const descendants = liveSubtree(db, boardId, id).filter(
    (r) => !roots.some((x) => x.id === r.id),
  );

  const list = landingList(db, target);
  if (!list) return { error: "That board has no column to land in." };
  const start = maxPosition(db, target, "list = ? and parent_id is null", list);

  let moved = 0;
  db.transaction(() => {
    // Archive first: the home board's timeline shows them leaving, then the target's
    // shows them arriving. Nothing is deleted, so nothing is lost either way.
    archiveRows(db, boardId, [...roots, ...descendants].map((r) => r.id), actorId);
    moved = recreate(db, {
      roots,
      descendants,
      destBoardId: target,
      destList: list,
      destParentId: null,
      startPosition: start,
      actorId,
    });
  })();

  return { ok: true, moved, targetBoardId: target };
}

/**
 * DEMOTION — "convert back to a regular card". Promotion run in reverse, same
 * machinery, same truth properties (owner requirement 2026-08-30: the feature is
 * opt-in AND opt-out).
 *
 * One transaction: archive the linked board's live cards ON THAT BOARD (its timeline
 * truthfully shows them leaving; they stay browsable in its Archive), recreate them
 * as sub-cards under the doorway card on the home board — the same old-id → new-id
 * walk preserves nesting — then clear the link, which the trigger journals as an
 * unlink.
 *
 * The emptied board is LEFT ALIVE. Deleting it stays a separate, explicit act:
 * deleteBoard is the app's one destructive path and demotion must never silently
 * invoke it. The linked board's daily note stays put too — a note can't become a
 * sub-card (the same rule lib/nesting.ts enforces).
 */
export function demoteToCard(
  db: Database.Database,
  boardId: string | null,
  opts: { id: string; actorId: string | null },
): { ok: true; moved: number; sourceBoardId: string } | { error: string } {
  const { id, actorId } = opts;
  const card = getCard(db, boardId, id);
  if (!card) return { error: "That card is no longer on this board." };
  if (card.archived) return { error: "That card is archived." };
  const source = card.linked_board_id;
  if (!source) return { error: "This card doesn't open a board." };
  // Reading the other board's cards requires being on it, exactly like linking.
  if (!actorId || !getMembership(db, source, actorId)) return { error: "No such board." };

  const roots = db
    .prepare(
      `select ${SUBTREE_COLS} from items
       where board_id is ? and parent_id is null and archived = 0 and list <> ?
       order by position asc, created_at asc`,
    )
    .all(source, NOTE_LIST) as SubtreeRow[];
  const descendants = roots.flatMap((r) => liveSubtree(db, source, r.id));
  const start = maxPosition(db, boardId, "parent_id is ?", id);

  let moved = 0;
  db.transaction(() => {
    archiveRows(db, source, [...roots, ...descendants].map((r) => r.id), actorId);
    moved = recreate(db, {
      roots,
      descendants,
      destBoardId: boardId,
      destList: card.list, // a sub-card inherits its parent's column
      destParentId: id,
      startPosition: start,
      actorId,
    });
    // Last: the card stops being a doorway. Journaled by items_log_linked_board_v2.
    db.prepare(
      "update items set linked_board_id = null, touched_by = ? where id = ? and board_id is ?",
    ).run(actorId, id, boardId);
  })();

  return { ok: true, moved, sourceBoardId: source };
}

/**
 * Follow a `converted_from` pointer back to the card this one continues from.
 *
 * The source lives on the OTHER board (archived there), so this is deliberately not
 * board-scoped — it's gated on the viewer's membership of the source board instead,
 * which is the same permission that would let them open it. A viewer who has since
 * lost access gets null, and the panel simply says nothing.
 */
export function getProvenance(
  db: Database.Database,
  viewerId: string | null,
  sourceId: string,
): Provenance | null {
  const row = db
    .prepare("select id, text, board_id from items where id = ?")
    .get(sourceId) as { id: string; text: string; board_id: string | null } | undefined;
  if (!row) return null;
  // Local/demo file: one board, no membership to check.
  if (row.board_id === null) {
    return { itemId: row.id, text: row.text, boardId: null, boardName: null };
  }
  if (!viewerId || !getMembership(db, row.board_id, viewerId)) return null;
  return {
    itemId: row.id,
    text: row.text,
    boardId: row.board_id,
    boardName: getBoardName(db, row.board_id),
  };
}
