// Run: node lib/journal.test.ts   (plain node script, same convention as the others)
//
// The item_events triggers in lib/schema.ts, checked against a scratch DB: a
// recurrence change is journaled, a card's history can describe it, and the time
// travel ledger reports it.

import Database from "better-sqlite3";
import { CREATE_TABLES, CREATE_TRIGGERS, migrateDb } from "./schema.ts";
import { diffBoardSince } from "./timetravel.ts";
import type { Item, ItemEvent } from "./types";

let failures = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.error(`✗ ${label}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`);
  } else console.log(`✓ ${label}`);
}

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
db.exec(CREATE_TABLES);
migrateDb(db);
db.exec(CREATE_TRIGGERS);
// Idempotent on a DB that already has every trigger, like a boot on the hosted file.
db.exec(CREATE_TRIGGERS);

db.prepare("insert into items (id, text, list, position, board_id) values ('a', 'vitamins', 'today', 1000, null)").run();
const tIso = new Date(Date.now() + 5).toISOString();
await new Promise((r) => setTimeout(r, 15));
db.prepare("update items set recurrence = 'daily' where id = 'a'").run();
db.prepare("update items set recurrence = 'daily' where id = 'a'").run(); // no change, no event

const events = db
  .prepare("select * from item_events where item_id = 'a' order by id")
  .all() as ItemEvent[];
eq(
  "a recurrence change is journaled once, as an edit with both values",
  events.filter((e) => e.field === "recurrence").map((e) => [e.type, e.old_value, e.new_value]),
  [["edited", "none", "daily"]],
);

const items = db.prepare("select * from items").all() as Item[];
await new Promise((r) => setTimeout(r, 15));
const diff = diffBoardSince(items, events, tIso, new Date().toISOString(), {
  listLabels: { today: "Today" },
  today: new Date().toISOString().slice(0, 10),
});
eq(
  "the ledger says the recurrence changed",
  diff.entries.map((e) => [e.id, e.kinds, e.phrase]),
  [["a", ["recurrence"], "recurrence changed to Every day"]],
);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall journal tests passed");
