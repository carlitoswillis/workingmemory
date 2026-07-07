import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
// .ts extension so plain-node tests can import this module (see lib/users.ts,
// lib/columns.test.ts). tsc allows it (allowImportingTsExtensions); webpack
// resolves the literal path.
import { DEFAULT_LISTS, MAX_LIST_LABEL, MAX_LISTS, NOTE_LIST, type ListDef } from "./lists.ts";

// Board columns as data (user-created since 2026-07-07). Pure functions over an
// explicit { db, userId } handle — no Next imports — so `node lib/columns.test.ts`
// can run them against a scratch DB. Server actions (app/actions.ts) and the board
// renderer (app/BoardScreen.tsx) get the handle from lib/db.ts#getBoardContext().
//
// Scoping mirrors items: `user_id IS ?` on every query (null on local/demo boards
// matches the whole file). Columns are soft-deleted (archived=1), never removed, so
// a since-deleted column's label still resolves in history / archive / time-travel.

const POSITION_GAP = 1000;

function clampLabel(raw: string): string {
  return raw.trim().slice(0, MAX_LIST_LABEL);
}

// Seed the five DEFAULT_LISTS the first time a board is rendered. Idempotent: does
// nothing once the board has any column row. Called from BoardScreen (covers local,
// each account, and demo boards through one path). Honors a pre-columns board's saved
// profiles.list_order so a reordered board keeps its column order across the upgrade.
export function ensureLists(db: Database.Database, userId: string | null): void {
  const count = (
    db.prepare("select count(*) c from lists where user_id is ?").get(userId) as { c: number }
  ).c;
  if (count > 0) return;

  const savedOrder = readSavedOrder(db, userId);
  const ordered = orderDefaults(savedOrder);

  const insert = db.prepare(
    "insert into lists (id, user_id, label, hint, position) values (?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    ordered.forEach((l, i) => insert.run(l.id, userId, l.label, l.hint, (i + 1) * POSITION_GAP));
  })();
}

function readSavedOrder(db: Database.Database, userId: string | null): string[] | null {
  const row = db
    .prepare("select list_order from profiles where id = ?")
    .get(userId ?? "local") as { list_order: string | null } | undefined;
  if (!row?.list_order) return null;
  try {
    const parsed = JSON.parse(row.list_order);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

// DEFAULT_LISTS in the given saved order; unknown ids dropped, missing ones appended.
function orderDefaults(order: string[] | null): ListDef[] {
  if (!order) return DEFAULT_LISTS;
  const byId = new Map(DEFAULT_LISTS.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const out: ListDef[] = [];
  for (const id of order) {
    const l = byId.get(id);
    if (l && !seen.has(id)) {
      out.push(l);
      seen.add(id);
    }
  }
  for (const l of DEFAULT_LISTS) if (!seen.has(l.id)) out.push(l);
  return out;
}

// Live (non-deleted) columns for the board, in display order.
export function getLists(db: Database.Database, userId: string | null): ListDef[] {
  return db
    .prepare(
      "select id, label, hint from lists where user_id is ? and archived = 0 order by position asc, created_at asc",
    )
    .all(userId) as ListDef[];
}

// id -> label for EVERY column incl. soft-deleted, so history / archive / snapshot
// views can label a card's list even after that column is gone.
export function getListLabels(db: Database.Database, userId: string | null): Record<string, string> {
  const rows = db
    .prepare("select id, label from lists where user_id is ?")
    .all(userId) as { id: string; label: string }[];
  const map: Record<string, string> = {};
  for (const r of rows) map[r.id] = r.label;
  return map;
}

// Does `id` name a live column on this board? Guards every item mutation that
// targets a list (add / move / reorder), replacing the old static isListId().
export function listExists(db: Database.Database, userId: string | null, id: string): boolean {
  return !!db
    .prepare("select 1 from lists where id = ? and user_id is ? and archived = 0")
    .get(id, userId);
}

function liveCount(db: Database.Database, userId: string | null): number {
  return (
    db
      .prepare("select count(*) c from lists where user_id is ? and archived = 0")
      .get(userId) as { c: number }
  ).c;
}

// Create a column. Returns the new id, or a user-facing error string.
export function addList(
  db: Database.Database,
  userId: string | null,
  label: string,
): { id: string } | { error: string } {
  const name = clampLabel(label);
  if (!name) return { error: "Give the column a name." };
  if (liveCount(db, userId) >= MAX_LISTS) {
    return { error: `A board can have at most ${MAX_LISTS} columns.` };
  }
  const max = (
    db
      .prepare("select coalesce(max(position), 0) m from lists where user_id is ?")
      .get(userId) as { m: number }
  ).m;
  const id = randomUUID();
  db.prepare("insert into lists (id, user_id, label, hint, position) values (?, ?, ?, ?, ?)").run(
    id,
    userId,
    name,
    "",
    max + POSITION_GAP,
  );
  return { id };
}

// Rename a live column. Returns whether a row was updated.
export function renameList(
  db: Database.Database,
  userId: string | null,
  id: string,
  label: string,
): boolean {
  const name = clampLabel(label);
  if (!name) return false;
  const res = db
    .prepare("update lists set label = ? where id = ? and user_id is ? and archived = 0")
    .run(name, id, userId);
  return res.changes > 0;
}

// Soft-delete a column. Refused (with a reason) if it's the last one or still holds
// a visible card — deleting must never drop a card off the board. Archived cards and
// past history keep the row's label (it's only archived, not removed).
export function deleteList(
  db: Database.Database,
  userId: string | null,
  id: string,
): { ok: true } | { error: string } {
  if (id === NOTE_LIST) return { error: "The note isn't a column." };
  if (!listExists(db, userId, id)) return { error: "That column no longer exists." };
  if (liveCount(db, userId) <= 1) return { error: "Keep at least one column." };
  const cards = (
    db
      .prepare(
        "select count(*) c from items where list = ? and archived = 0 and parent_id is null and user_id is ?",
      )
      .get(id, userId) as { c: number }
  ).c;
  if (cards > 0) {
    return { error: "Move or archive this column's cards first." };
  }
  db.prepare("update lists set archived = 1 where id = ? and user_id is ?").run(id, userId);
  return { ok: true };
}

// Persist a new left-to-right column order (drag-to-reorder). Ids not owned by the
// board are ignored; unmentioned live columns keep their relative order after the
// listed ones.
export function reorderLists(db: Database.Database, userId: string | null, order: string[]): void {
  const live = new Set(getLists(db, userId).map((l) => l.id));
  const seen = new Set<string>();
  const final: string[] = [];
  for (const id of order) {
    if (live.has(id) && !seen.has(id)) {
      final.push(id);
      seen.add(id);
    }
  }
  for (const id of live) if (!seen.has(id)) final.push(id);

  const update = db.prepare("update lists set position = ? where id = ? and user_id is ?");
  db.transaction(() => {
    final.forEach((id, i) => update.run((i + 1) * POSITION_GAP, id, userId));
  })();
}
