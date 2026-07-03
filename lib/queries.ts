import { getDb } from "./db";
import type { Item, ItemEvent } from "./types";
import type { ListId } from "./lists";

// Reads from the SQLite store for the current request (the one local file, or a
// per-visitor demo DB — lib/db.ts decides). SQLite stores done/archived as 0/1,
// so map every row through `rowToItem` to get the boolean shape the app expects.

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

export function getItems(): Item[] {
  const rows = getDb()
    .prepare("select * from items where archived = 0 order by position asc, created_at asc")
    .all() as ItemRow[];
  return rows.map(rowToItem);
}

// The saved column (list) order, or null if it was never set.
export function getListOrder(): string[] | null {
  const row = getDb().prepare("select list_order from profiles limit 1").get() as
    | { list_order: string | null }
    | undefined;
  if (!row?.list_order) return null;
  try {
    const order = JSON.parse(row.list_order);
    return Array.isArray(order) ? (order as string[]) : null;
  } catch {
    return null;
  }
}

export function getHistory(itemId: string): ItemEvent[] {
  return getDb()
    .prepare("select * from item_events where item_id = ? order by at asc")
    .all(itemId) as ItemEvent[];
}

// All items + events for client-side time-travel. Shipped once when the user opens
// the time machine so the scrubber can reconstruct any past moment locally (the data
// is tiny + single-user) with no per-tick server round-trip.
export function getTimelineData(): { items: Item[]; events: ItemEvent[] } {
  const db = getDb();
  const items = (db.prepare("select * from items").all() as ItemRow[]).map(rowToItem);
  const events = db
    .prepare("select * from item_events order by at asc")
    .all() as ItemEvent[];
  return { items, events };
}
