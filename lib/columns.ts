import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
// .ts extension so plain-node tests can import this module (see lib/users.ts,
// lib/columns.test.ts). tsc allows it (allowImportingTsExtensions); webpack
// resolves the literal path.
import { DEFAULT_LISTS, MAX_LIST_LABEL, MAX_LISTS, NOTE_LIST, type ListDef } from "./lists.ts";

// Board columns as data (user-created). Pure functions over an explicit
// { db, boardId } handle — no Next imports — so `node lib/columns.test.ts` runs
// them against a scratch DB. Server actions (app/actions.ts) and the board renderer
// (app/BoardScreen.tsx) get the handle from lib/db.ts#getBoardContext().
//
// Scoping mirrors items: `board_id IS ?` on every query (null on local/demo boards
// matches the whole file). Columns are soft-deleted (archived=1), never removed, so
// a since-deleted column's label still resolves in history / archive / time-travel.

const POSITION_GAP = 1000;

function clampLabel(raw: string): string {
  return raw.trim().slice(0, MAX_LIST_LABEL);
}

// Seed the five DEFAULT_LISTS the first time a board is rendered. Idempotent: does
// nothing once the board has any column row. Called from BoardScreen (covers local,
// each account board, and demo boards through one path). A migrated personal board
// already has its columns (re-homed by the bootstrap), so this only fires for freshly
// created boards.
export function ensureLists(db: Database.Database, boardId: string | null): void {
  const count = (
    db.prepare("select count(*) c from lists where board_id is ?").get(boardId) as { c: number }
  ).c;
  if (count > 0) return;

  const insert = db.prepare(
    "insert into lists (id, board_id, label, hint, position) values (?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    DEFAULT_LISTS.forEach((l, i) =>
      insert.run(l.id, boardId, l.label, l.hint, (i + 1) * POSITION_GAP),
    );
  })();
}

// Live (non-deleted) columns for the board, in display order.
export function getLists(db: Database.Database, boardId: string | null): ListDef[] {
  return db
    .prepare(
      "select id, label, hint from lists where board_id is ? and archived = 0 order by position asc, created_at asc",
    )
    .all(boardId) as ListDef[];
}

// id -> label for EVERY column incl. soft-deleted, so history / archive / snapshot
// views can label a card's list even after that column is gone.
export function getListLabels(db: Database.Database, boardId: string | null): Record<string, string> {
  const rows = db
    .prepare("select id, label from lists where board_id is ?")
    .all(boardId) as { id: string; label: string }[];
  const map: Record<string, string> = {};
  for (const r of rows) map[r.id] = r.label;
  return map;
}

// Does `id` name a live column on this board? Guards every item mutation that
// targets a list (add / move / reorder), replacing the old static isListId().
export function listExists(db: Database.Database, boardId: string | null, id: string): boolean {
  return !!db
    .prepare("select 1 from lists where id = ? and board_id is ? and archived = 0")
    .get(id, boardId);
}

function liveCount(db: Database.Database, boardId: string | null): number {
  return (
    db
      .prepare("select count(*) c from lists where board_id is ? and archived = 0")
      .get(boardId) as { c: number }
  ).c;
}

// Create a column. Returns the new id, or a user-facing error string.
export function addList(
  db: Database.Database,
  boardId: string | null,
  label: string,
): { id: string } | { error: string } {
  const name = clampLabel(label);
  if (!name) return { error: "Give the column a name." };
  if (liveCount(db, boardId) >= MAX_LISTS) {
    return { error: `A board can have at most ${MAX_LISTS} columns.` };
  }
  const max = (
    db
      .prepare("select coalesce(max(position), 0) m from lists where board_id is ?")
      .get(boardId) as { m: number }
  ).m;
  const id = randomUUID();
  db.prepare("insert into lists (id, board_id, label, hint, position) values (?, ?, ?, ?, ?)").run(
    id,
    boardId,
    name,
    "",
    max + POSITION_GAP,
  );
  return { id };
}

// Rename a live column. Returns whether a row was updated.
export function renameList(
  db: Database.Database,
  boardId: string | null,
  id: string,
  label: string,
): boolean {
  const name = clampLabel(label);
  if (!name) return false;
  const res = db
    .prepare("update lists set label = ? where id = ? and board_id is ? and archived = 0")
    .run(name, id, boardId);
  return res.changes > 0;
}

// Soft-delete a column. Refused (with a reason) if it's the last one or still holds
// a visible card — deleting must never drop a card off the board. Archived cards and
// past history keep the row's label (it's only archived, not removed).
export function deleteList(
  db: Database.Database,
  boardId: string | null,
  id: string,
): { ok: true } | { error: string } {
  if (id === NOTE_LIST) return { error: "The note isn't a column." };
  if (!listExists(db, boardId, id)) return { error: "That column no longer exists." };
  if (liveCount(db, boardId) <= 1) return { error: "Keep at least one column." };
  const cards = (
    db
      .prepare(
        "select count(*) c from items where list = ? and archived = 0 and parent_id is null and board_id is ?",
      )
      .get(id, boardId) as { c: number }
  ).c;
  if (cards > 0) {
    return { error: "Move or archive this column's cards first." };
  }
  db.prepare("update lists set archived = 1 where id = ? and board_id is ?").run(id, boardId);
  return { ok: true };
}

// Persist a new left-to-right column order (drag-to-reorder). Ids not on the board
// are ignored; unmentioned live columns keep their relative order after the listed
// ones.
export function reorderLists(db: Database.Database, boardId: string | null, order: string[]): void {
  const live = new Set(getLists(db, boardId).map((l) => l.id));
  const seen = new Set<string>();
  const final: string[] = [];
  for (const id of order) {
    if (live.has(id) && !seen.has(id)) {
      final.push(id);
      seen.add(id);
    }
  }
  for (const id of live) if (!seen.has(id)) final.push(id);

  const update = db.prepare("update lists set position = ? where id = ? and board_id is ?");
  db.transaction(() => {
    final.forEach((id, i) => update.run((i + 1) * POSITION_GAP, id, boardId));
  })();
}
