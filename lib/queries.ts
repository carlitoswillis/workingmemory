import type Database from "better-sqlite3";
import type { Item, ItemEvent } from "./types";
import type { ListId } from "./lists";
// .ts extension so plain-node tests can import this module (see lib/users.ts).
import { completedDays } from "./streaks.ts";

// Reads from a SQLite board (multiple-accounts v1). Every function takes the
// request's { db, userId } from lib/db.ts#getBoardContext() explicitly — this
// module stays pure (no Next imports) so tests can run it against scratch DBs.
//
// Scoping: `user_id IS ?`. On the multi-tenant main DB userId is the signed-in
// user's uuid; on local/demo boards it's null, and IS null matches every row
// there (they're all unowned) — one SQL shape for both. history/timeline scope
// item_events through a join on items (events carry no user_id of their own).
//
// SQLite stores done/archived as 0/1, so map every row through `rowToItem` to
// get the boolean shape the app expects.

type ItemRow = Omit<Item, "done" | "archived"> & { done: number; archived: number };

function rowToItem(r: ItemRow): Item {
  return {
    id: r.id,
    text: r.text,
    details: r.details ?? "",
    list: r.list as ListId,
    done: !!r.done,
    recurrence: r.recurrence,
    completed_on: r.completed_on ?? null,
    parent_id: r.parent_id ?? null,
    position: r.position,
    archived: !!r.archived,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function getItems(db: Database.Database, userId: string | null): Item[] {
  const rows = db
    .prepare(
      "select * from items where archived = 0 and user_id is ? order by position asc, created_at asc",
    )
    .all(userId) as ItemRow[];
  const items = rows.map(rowToItem);

  // Attach completed-day history to daily tasks (streaks). One query for all
  // items; the replay itself is pure (lib/streaks.ts). Chronological order
  // matters — an uncheck must land after the check it reverts.
  if (items.some((i) => i.recurrence === "daily")) {
    const evRows = db
      .prepare(
        `select e.item_id, e.field, e.old_value, e.new_value
         from item_events e join items i on i.id = e.item_id
         where e.field = 'completed_on' and i.user_id is ?
         order by e.at asc, e.id asc`,
      )
      .all(userId) as { item_id: string; field: string; old_value: string | null; new_value: string | null }[];
    const byItem = new Map<string, typeof evRows>();
    for (const e of evRows) {
      const arr = byItem.get(e.item_id);
      if (arr) arr.push(e);
      else byItem.set(e.item_id, [e]);
    }
    for (const it of items) {
      if (it.recurrence !== "daily") continue;
      it.completed_days = [...completedDays(byItem.get(it.id) ?? [], it.completed_on)].sort();
    }
  }
  return items;
}

// Archived items, most-recently-archived first (updated_at is bumped on archive).
// Drives the Archive view (browse + restore). Full history is preserved either way;
// this is just the "where did it go" list. Includes archived sub-cards.
export function getArchivedItems(db: Database.Database, userId: string | null): Item[] {
  const rows = db
    .prepare("select * from items where archived = 1 and user_id is ? order by updated_at desc")
    .all(userId) as ItemRow[];
  return rows.map(rowToItem);
}

export function getHistory(
  db: Database.Database,
  userId: string | null,
  itemId: string,
): ItemEvent[] {
  return db
    .prepare(
      `select e.* from item_events e join items i on i.id = e.item_id
       where e.item_id = ? and i.user_id is ? order by e.at asc`,
    )
    .all(itemId, userId) as ItemEvent[];
}

// All items + events for client-side time-travel. Shipped once when the user opens
// the time machine so the scrubber can reconstruct any past moment locally (the data
// is tiny per board) with no per-tick server round-trip.
export function getTimelineData(
  db: Database.Database,
  userId: string | null,
): { items: Item[]; events: ItemEvent[] } {
  const items = (
    db.prepare("select * from items where user_id is ?").all(userId) as ItemRow[]
  ).map(rowToItem);
  const events = db
    .prepare(
      `select e.* from item_events e join items i on i.id = e.item_id
       where i.user_id is ? order by e.at asc`,
    )
    .all(userId) as ItemEvent[];
  return { items, events };
}
