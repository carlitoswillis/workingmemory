"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { isListId } from "@/lib/lists";
import { getDb, isDemoRequest } from "@/lib/db";
import { demoAddBlocked, clampDemoText, clampDemoDetails } from "@/lib/demo/limits";
import { getHistory, getTimelineData } from "@/lib/queries";
import type { Item, ItemEvent } from "@/lib/types";

// Mutations are plain CRUD against the request's SQLite file (the one local file,
// or a per-visitor demo DB — lib/db.ts decides) — the DB triggers append the
// history events (see lib/schema.ts). Demo boards get size caps here; write RATE
// limiting lives in middleware.ts. With DEMO_MODE off none of the caps apply.

export async function addItemAction(text: string, list: string) {
  let t = text.trim();
  if (!t || !isListId(list)) return;
  const db = getDb();
  if (isDemoRequest()) {
    if (demoAddBlocked(db)) return;
    t = clampDemoText(t);
  }
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
  let t = text.trim();
  if (!t) return;
  const db = getDb();
  if (isDemoRequest()) {
    if (demoAddBlocked(db)) return;
    t = clampDemoText(t);
  }
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
  let t = text.trim();
  if (!t) return;
  if (isDemoRequest()) t = clampDemoText(t);
  getDb().prepare("update items set text = ? where id = ?").run(t, id);
  revalidatePath("/");
}

export async function editDetailsAction(id: string, details: string) {
  // details may be empty (cleared); no trim-reject.
  const d = isDemoRequest() ? clampDemoDetails(details) : details;
  getDb().prepare("update items set details = ? where id = ?").run(d, id);
  revalidatePath("/");
}

export async function moveItemAction(id: string, list: string) {
  if (!isListId(list)) return;
  getDb().prepare("update items set list = ? where id = ?").run(list, id);
  revalidatePath("/");
}

export async function toggleDoneAction(id: string, done: boolean) {
  getDb().prepare("update items set done = ? where id = ?").run(done ? 1 : 0, id);
  revalidatePath("/");
}

export async function archiveItemAction(id: string) {
  getDb().prepare("update items set archived = 1 where id = ?").run(id);
  revalidatePath("/");
}

export async function setRecurrenceAction(id: string, recurrence: string) {
  const value = recurrence === "daily" ? "daily" : "none";
  getDb().prepare("update items set recurrence = ? where id = ?").run(value, id);
  revalidatePath("/");
}

// Check/uncheck a daily task for a given local date (null = uncheck).
export async function setDailyDoneAction(id: string, completedOn: string | null) {
  getDb().prepare("update items set completed_on = ? where id = ?").run(completedOn, id);
  revalidatePath("/");
}

export async function reorderItemAction(id: string, list: string, position: number) {
  if (!isListId(list)) return;
  getDb()
    .prepare("update items set position = ?, list = ? where id = ?")
    .run(position, list, id);
  revalidatePath("/");
}

// Move/reorder many cards at once (multi-select drag) — one transaction so the
// board never sees a half-applied move.
export async function reorderItemsAction(
  updates: { id: string; list: string; position: number }[],
) {
  const valid = updates.filter((u) => isListId(u.list));
  if (valid.length === 0) return;
  const db = getDb();
  const stmt = db.prepare("update items set position = ?, list = ? where id = ?");
  const run = db.transaction((rows: typeof valid) => {
    for (const r of rows) stmt.run(r.position, r.list, r.id);
  });
  run(valid);
  revalidatePath("/");
}

export async function saveListOrderAction(order: string[]) {
  const valid = order.filter(isListId);
  getDb()
    .prepare(
      `insert into profiles (id, list_order, updated_at) values ('local', ?, ?)
     on conflict(id) do update set list_order = excluded.list_order, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(valid), new Date().toISOString());
  revalidatePath("/");
}

// The daily note is a SINGLE pinned item with list='note' (body in `details`), so every
// edit is change-tracked + time-traveled — the time machine is the journal. There's only
// ever one; you clear and rewrite it each day rather than spawning new ones. This just
// creates it the first time (idempotent).
export async function createNoteAction() {
  const db = getDb();
  const existing = db
    .prepare("select id from items where list = 'note' and archived = 0 and parent_id is null limit 1")
    .get();
  if (existing) return;
  if (isDemoRequest() && demoAddBlocked(db)) return;
  db.prepare(
    "insert into items (id, text, list, details) values (?, 'Daily note', 'note', '')",
  ).run(randomUUID());
  revalidatePath("/");
}

export async function historyAction(id: string): Promise<ItemEvent[]> {
  return getHistory(id);
}

// Ship the whole (small, single-user) event log to the client so the time-machine
// scrubber can reconstruct any past moment locally — no per-tick server round-trip.
export async function timelineDataAction(): Promise<{ items: Item[]; events: ItemEvent[] }> {
  return getTimelineData();
}
