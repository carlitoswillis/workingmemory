import type Database from "better-sqlite3";
// .ts extension so plain-node tests can import this module (see lib/columns.ts).
import { NOTE_LIST } from "./lists.ts";

// Move cards INTO another card, and back OUT to the board (2026-07-23). Sub-cards
// already existed — they could only be born inside a parent (addChildAction); this is
// the missing verb: re-parenting an existing card, subtree and all.
//
// Pure functions over an explicit { db, boardId } handle — no Next imports — so
// `node lib/nesting.test.ts` runs them against a scratch DB. The server action
// (app/actions.ts#setParentAction) supplies the handle from getBoardContext().
//
// The change itself is one plain `update items set parent_id = ?`; the history event
// is written by the items_log_parent_v2 trigger (lib/schema.ts), never here — same
// rule as every other mutation. Scoping is the usual `board_id IS ?` on every read
// AND write, so a card id from another board is invisible (IDOR guard).

const POSITION_GAP = 1000;

type ItemRow = { id: string; list: string; parent_id: string | null; archived: number };

function getRow(
  db: Database.Database,
  boardId: string | null,
  id: string,
): ItemRow | undefined {
  return db
    .prepare("select id, list, parent_id, archived from items where id = ? and board_id is ?")
    .get(id, boardId) as ItemRow | undefined;
}

// Is `candidateId` the card itself, or somewhere inside its subtree? Walks UP the
// parent chain from the candidate: if we reach `rootId`, dropping root into candidate
// would detach a loop from the board (root would be its own ancestor). `seen` guards
// against spinning forever on a pre-existing cycle in a hand-edited DB.
export function isSelfOrDescendant(
  db: Database.Database,
  boardId: string | null,
  rootId: string,
  candidateId: string,
): boolean {
  const parentOf = db.prepare("select parent_id from items where id = ? and board_id is ?");
  const seen = new Set<string>();
  let cur: string | null = candidateId;
  while (cur) {
    if (cur === rootId) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    const row = parentOf.get(cur, boardId) as { parent_id: string | null } | undefined;
    cur = row?.parent_id ?? null;
  }
  return false;
}

/**
 * Re-parent one or more cards.
 *
 *  - `parentId` set  → nest them at the end of that card's sub-cards. They inherit the
 *    parent's list, so the subtree stays in one column and popping a card back out
 *    lands it somewhere real.
 *  - `parentId` null → pop them back onto the board, into `list` (defaults to the card's
 *    own list) at the end of that column.
 *
 * Whole subtrees ride along: children reference their parent by id, so nothing else
 * has to move. Returns a user-facing reason string on refusal — the UI surfaces it.
 */
export function setParent(
  db: Database.Database,
  boardId: string | null,
  opts: {
    ids: string[];
    parentId: string | null;
    actorId: string | null;
    list?: string; // only consulted when popping out to the board
  },
): { ok: true; moved: number } | { error: string } {
  const { ids, parentId, actorId, list } = opts;
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return { ok: true, moved: 0 };

  const rows: ItemRow[] = [];
  for (const id of unique) {
    const row = getRow(db, boardId, id);
    if (!row) return { error: "That card is no longer on this board." };
    if (row.list === NOTE_LIST) return { error: "The daily note can't go inside a card." };
    if (row.parent_id === parentId) continue; // already there — nothing to do
    rows.push(row);
  }
  if (rows.length === 0) return { ok: true, moved: 0 };

  let targetList: string | null = null;
  if (parentId !== null) {
    const parent = getRow(db, boardId, parentId);
    if (!parent) return { error: "That card is no longer on this board." };
    if (parent.archived) return { error: "That card is archived." };
    if (parent.list === NOTE_LIST) return { error: "The daily note can't hold cards." };
    for (const row of rows) {
      if (isSelfOrDescendant(db, boardId, row.id, parentId)) {
        return { error: "A card can't go inside itself or one of its own sub-cards." };
      }
    }
    targetList = parent.list;
  }

  // End of the target's sub-cards (or of the destination column) — one shared cursor
  // so a dropped block keeps its order instead of stacking on one position.
  const maxPosition = (where: string, arg: string | null): number =>
    (
      db
        .prepare(`select coalesce(max(position), 0) m from items where ${where} and board_id is ?`)
        .get(arg, boardId) as { m: number }
    ).m;

  const update = db.prepare(
    "update items set parent_id = ?, list = ?, position = ?, touched_by = ? where id = ? and board_id is ?",
  );

  const run = db.transaction(() => {
    // One cursor per destination: the parent's sub-card stack when nesting, or the
    // tail of each column when popping out (cards can come out into different lists).
    const cursors = new Map<string, number>();
    const nextPosition = (key: string, where: string, arg: string | null): number => {
      const from = cursors.get(key) ?? maxPosition(where, arg);
      const pos = from + POSITION_GAP;
      cursors.set(key, pos);
      return pos;
    };
    for (const row of rows) {
      const nextList = parentId !== null ? targetList! : list ?? row.list;
      const pos =
        parentId !== null
          ? nextPosition(`p:${parentId}`, "parent_id is ?", parentId)
          : nextPosition(`l:${nextList}`, "list = ? and parent_id is null", nextList);
      update.run(parentId, nextList, pos, actorId, row.id, boardId);
    }
  });
  run();

  return { ok: true, moved: rows.length };
}
