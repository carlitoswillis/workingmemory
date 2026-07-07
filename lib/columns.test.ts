// Run: node lib/columns.test.ts   (plain node script, same convention as the others)
//
// Covers the user-created columns layer (lib/columns.ts) against a scratch DB:
// default seeding, ordering, CRUD, and the delete guards that keep a card from ever
// falling off the board when its column is removed.

import Database from "better-sqlite3";
import { CREATE_TABLES, CREATE_TRIGGERS, migrateDb } from "./schema.ts";
import {
  addList,
  deleteList,
  ensureLists,
  getLists,
  getListLabels,
  listExists,
  renameList,
  reorderLists,
} from "./columns.ts";

let failures = 0;
function ok(label: string, got: unknown, want: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) {
    failures++;
    console.error(`✗ ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
db.exec(CREATE_TABLES);
migrateDb(db);
db.exec(CREATE_TRIGGERS);

// Everything here runs on the null (local) scope.
const U = null;

// --- seeding ---------------------------------------------------------------
ensureLists(db, U);
ok("seeds the 5 default columns", getLists(db, U).map((l) => l.id), [
  "today",
  "focus",
  "waiting",
  "backlog",
  "braindump",
]);
const beforeLabels = getListLabels(db, U);
ensureLists(db, U); // idempotent
ok("ensureLists is idempotent", getLists(db, U).length, 5);
ok("default label resolves", beforeLabels["today"], "Today");

// --- add / rename ----------------------------------------------------------
const added = addList(db, U, "  Errands  ");
ok("addList returns an id", "id" in added, true);
const errandsId = "id" in added ? added.id : "";
ok("new column is appended last", getLists(db, U).at(-1)!.id, errandsId);
ok("label is trimmed", getLists(db, U).at(-1)!.label, "Errands");
ok("empty label rejected", "error" in addList(db, U, "   "), true);

ok("rename works", renameList(db, U, errandsId, "Chores"), true);
ok("renamed label sticks", getLists(db, U).at(-1)!.label, "Chores");
ok("rename of missing column is a no-op", renameList(db, U, "nope", "X"), false);

// --- reorder ---------------------------------------------------------------
reorderLists(db, U, ["focus", "today"]); // partial order; rest keep relative order
ok("reorder puts focus first", getLists(db, U)[0].id, "focus");
ok("reorder puts today second", getLists(db, U)[1].id, "today");
ok("unmentioned columns follow", getLists(db, U)[2].id, "waiting");

// --- listExists ------------------------------------------------------------
ok("listExists true for a live column", listExists(db, U, "today"), true);
ok("listExists false for unknown", listExists(db, U, "ghost"), false);

// --- delete guards ---------------------------------------------------------
// A column holding a visible card can't be deleted.
db.prepare("insert into items (id, text, list, user_id) values ('i1', 'a task', 'backlog', null)").run();
ok("delete blocked while it holds a card", "error" in deleteList(db, U, "backlog"), true);
ok("blocked delete left the column live", listExists(db, U, "backlog"), true);

// Archived cards don't block deletion, and the label survives the soft-delete.
db.prepare("update items set archived = 1 where id = 'i1'").run();
ok("delete allowed once its card is archived", "ok" in deleteList(db, U, "backlog"), true);
ok("deleted column drops off the live board", listExists(db, U, "backlog"), false);
ok("deleted column's label still resolves", getListLabels(db, U)["backlog"], "Backlog");

// The last remaining column can't be deleted.
for (const l of getLists(db, U).slice(1)) deleteList(db, U, l.id);
ok("one column remains", getLists(db, U).length, 1);
ok("last column can't be deleted", "error" in deleteList(db, U, getLists(db, U)[0].id), true);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall columns tests passed");
