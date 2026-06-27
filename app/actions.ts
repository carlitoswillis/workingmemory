"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { isListId } from "@/lib/lists";
import db from "@/lib/db";
import { getBoardAt, getHistory } from "@/lib/queries";
import type { ItemEvent } from "@/lib/types";
import type { BoardItemAt } from "@/lib/timetravel";

// Mutations are plain CRUD against the local SQLite file — the DB triggers append
// the history events (see lib/schema.ts). Single-user/offline: no auth, no RLS.

export async function addItemAction(text: string, list: string) {
  const t = text.trim();
  if (!t || !isListId(list)) return;
  db.prepare("insert into items (id, text, list, position) values (?, ?, ?, ?)").run(
    randomUUID(),
    t,
    list,
    Date.now(),
  );
  revalidatePath("/");
}

// Add a sub-card under `parentId`. The child is a real item (so it gets history,
// recurrence, the panel) and inherits the parent's list — children never render as
// top-level board cards, but `list` is NOT NULL so we keep it sensible.
export async function addChildAction(parentId: string, text: string) {
  const t = text.trim();
  if (!t) return;
  const parent = db.prepare("select list from items where id = ?").get(parentId) as
    | { list: string }
    | undefined;
  if (!parent?.list) return;
  db.prepare(
    "insert into items (id, text, list, parent_id, position) values (?, ?, ?, ?, ?)",
  ).run(randomUUID(), t, parent.list, parentId, Date.now());
  revalidatePath("/");
}

export async function editItemAction(id: string, text: string) {
  const t = text.trim();
  if (!t) return;
  db.prepare("update items set text = ? where id = ?").run(t, id);
  revalidatePath("/");
}

export async function editDetailsAction(id: string, details: string) {
  // details may be empty (cleared); no trim-reject.
  db.prepare("update items set details = ? where id = ?").run(details, id);
  revalidatePath("/");
}

export async function moveItemAction(id: string, list: string) {
  if (!isListId(list)) return;
  db.prepare("update items set list = ? where id = ?").run(list, id);
  revalidatePath("/");
}

export async function toggleDoneAction(id: string, done: boolean) {
  db.prepare("update items set done = ? where id = ?").run(done ? 1 : 0, id);
  revalidatePath("/");
}

export async function archiveItemAction(id: string) {
  db.prepare("update items set archived = 1 where id = ?").run(id);
  revalidatePath("/");
}

export async function setRecurrenceAction(id: string, recurrence: string) {
  const value = recurrence === "daily" ? "daily" : "none";
  db.prepare("update items set recurrence = ? where id = ?").run(value, id);
  revalidatePath("/");
}

// Check/uncheck a daily task for a given local date (null = uncheck).
export async function setDailyDoneAction(id: string, completedOn: string | null) {
  db.prepare("update items set completed_on = ? where id = ?").run(completedOn, id);
  revalidatePath("/");
}

export async function reorderItemAction(id: string, list: string, position: number) {
  if (!isListId(list)) return;
  db.prepare("update items set position = ?, list = ? where id = ?").run(position, list, id);
  revalidatePath("/");
}

export async function saveListOrderAction(order: string[]) {
  const valid = order.filter(isListId);
  db.prepare(
    `insert into profiles (id, list_order, updated_at) values ('local', ?, ?)
     on conflict(id) do update set list_order = excluded.list_order, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(valid), new Date().toISOString());
  revalidatePath("/");
}

export async function historyAction(id: string): Promise<ItemEvent[]> {
  return getHistory(id);
}

export async function boardAtAction(t: string): Promise<BoardItemAt[]> {
  return getBoardAt(t);
}
