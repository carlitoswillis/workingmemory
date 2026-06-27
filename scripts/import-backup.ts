// Build the local SQLite store from a verified backup folder.
//
//   node scripts/import-backup.ts backups/<stamp>
//
// Order matters: create TABLES, bulk-insert the rows (items, the real history,
// settings), THEN attach the triggers. If triggers existed during import, every
// inserted item would emit a spurious "created" event and corrupt the history.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { CREATE_TABLES, CREATE_TRIGGERS } from "../lib/schema.ts";

const backupDir = process.argv[2];
if (!backupDir) {
  console.error("usage: node scripts/import-backup.ts backups/<stamp>");
  process.exit(1);
}

const read = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(backupDir, name), "utf8"));

const items = read("items.json");
const events = read("item_events.json");
const profiles = read("profiles.json");

const dbPath = path.join(process.cwd(), "data", "wm.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
if (fs.existsSync(dbPath)) {
  // Refuse to silently clobber an existing store.
  console.error(`Refusing to overwrite existing ${dbPath}. Delete it first to re-import.`);
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma("foreign_keys = OFF"); // import in any order
db.exec(CREATE_TABLES); // tables only — NO triggers yet

const insItem = db.prepare(`
  insert into items
    (id, text, list, done, position, archived, details, recurrence, completed_on, parent_id, created_at, updated_at)
  values
    (@id, @text, @list, @done, @position, @archived, @details, @recurrence, @completed_on, @parent_id, @created_at, @updated_at)
`);
const insEvent = db.prepare(`
  insert into item_events (id, item_id, type, field, old_value, new_value, at)
  values (@id, @item_id, @type, @field, @old_value, @new_value, @at)
`);
const insProfile = db.prepare(
  `insert into profiles (id, list_order, updated_at) values ('local', @list_order, @updated_at)`,
);

const b = (v: unknown) => (v ? 1 : 0);

const load = db.transaction(() => {
  for (const it of items) {
    insItem.run({
      id: it.id,
      text: it.text,
      list: it.list,
      done: b(it.done),
      position: it.position ?? 0,
      archived: b(it.archived),
      details: it.details ?? "",
      recurrence: it.recurrence ?? "none",
      completed_on: it.completed_on ?? null,
      parent_id: it.parent_id ?? null,
      created_at: it.created_at,
      updated_at: it.updated_at,
    });
  }
  for (const e of events) {
    insEvent.run({
      id: e.id,
      item_id: e.item_id,
      type: e.type,
      field: e.field ?? null,
      old_value: e.old_value ?? null,
      new_value: e.new_value ?? null,
      at: e.at,
    });
  }
  const p = profiles[0];
  if (p) {
    insProfile.run({
      list_order: JSON.stringify(p.list_order ?? []),
      updated_at: p.updated_at ?? new Date().toISOString(),
    });
  }
});
load();

db.exec(CREATE_TRIGGERS); // now safe to attach history triggers

const count = (t: string) =>
  (db.prepare(`select count(*) c from ${t}`).get() as { c: number }).c;
console.log(
  `Imported → items=${count("items")}, item_events=${count("item_events")}, profiles=${count("profiles")}`,
);
db.close();
