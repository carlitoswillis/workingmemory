// Run: node lib/completion.test.ts   (plain node script, same convention as the others)
//
// The completion machine (lib/completion.ts): what switching a card between one-off and
// repeating does to done / completed_on, and that the time machine replays the switch.

import Database from "better-sqlite3";
import { CREATE_TABLES, CREATE_TRIGGERS, migrateDb } from "./schema.ts";
import { checkOffPatch, recurrenceSwitchPatch, switchRecurrence } from "./completion.ts";
import { effectiveDone } from "./recurrence.ts";
import { reconstructItemAt } from "./timetravel.ts";

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

const TODAY = "2026-07-22";

// --- pure patches -----------------------------------------------------------
ok("done one-off -> daily is done today", recurrenceSwitchPatch({ recurrence: "none", completed_on: null, done: true }, "daily", TODAY), { completed_on: TODAY });
ok("open one-off -> daily is open", recurrenceSwitchPatch({ recurrence: "none", completed_on: null, done: false }, "daily", TODAY), { completed_on: null });
ok(
  "daily unchecked (stale done=1) -> none is open",
  recurrenceSwitchPatch({ recurrence: "daily", completed_on: null, done: true }, "none", TODAY),
  { done: 0 },
);
ok(
  "daily checked today -> none is done",
  recurrenceSwitchPatch({ recurrence: "daily", completed_on: TODAY, done: false }, "none", TODAY),
  { done: 1 },
);
ok("daily -> weekly touches nothing", recurrenceSwitchPatch({ recurrence: "daily", completed_on: TODAY, done: false }, "weekly:3", TODAY), {});
ok("none -> none touches nothing", recurrenceSwitchPatch({ recurrence: "none", completed_on: null, done: true }, "none", TODAY), {});
ok("check-off of a one-off flips done", checkOffPatch({ recurrence: "none", completed_on: null }, true, TODAY), { done: 1 });
ok("stale uncheck does not clear an older tick", checkOffPatch({ recurrence: "daily", completed_on: "2026-07-21" }, false, TODAY), {});

// --- through SQLite, with the real triggers ---------------------------------
function freshDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_TABLES);
  migrateDb(db);
  db.exec(CREATE_TRIGGERS);
  return db;
}
function addCard(db: Database.Database, id: string) {
  db.prepare(
    "insert into items (id, text, list, position, created_at, updated_at) values (?, 'x', 'today', 0, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')",
  ).run(id);
}
const row = (db: Database.Database, id: string) => {
  const r = db.prepare("select recurrence, done, completed_on from items where id = ?").get(id) as {
    recurrence: string;
    done: number;
    completed_on: string | null;
  };
  return { ...r, done: r.done === 1 };
};

{
  // (a) the audit's sequence: one-off done, -> daily, tick, untick, -> none must be OPEN.
  const db = freshDb();
  addCard(db, "a");
  db.prepare("update items set done = 1 where id = 'a'").run();
  switchRecurrence(db, null, "a", "daily", null, TODAY);
  ok("a: one-off done -> daily reads done today", effectiveDone(row(db, "a"), TODAY), true);
  db.prepare("update items set completed_on = null where id = 'a'").run(); // untick
  ok("a: unticked daily reads open", effectiveDone(row(db, "a"), TODAY), false);
  switchRecurrence(db, null, "a", "none", null, TODAY);
  ok("a: back to none stays open (the last action was an uncheck)", effectiveDone(row(db, "a"), TODAY), false);
  ok("a: unknown id is a no-op", switchRecurrence(db, null, "nope", "daily", null, TODAY), false);
}
{
  // daily ticked today, -> none: still done.
  const db = freshDb();
  addCard(db, "b");
  switchRecurrence(db, null, "b", "daily", null, TODAY);
  db.prepare("update items set completed_on = ? where id = 'b'").run(TODAY);
  switchRecurrence(db, null, "b", "none", null, TODAY);
  ok("b: daily ticked today -> none is done", effectiveDone(row(db, "b"), TODAY), true);
}
{
  // (b) time machine: done as a one-off at T, later made daily; the snapshot at T says done.
  const db = freshDb();
  addCard(db, "c");
  db.prepare("update items set done = 1 where id = 'c'").run();
  const T = new Date(Date.now() + 5).toISOString();
  const wait = Date.now() + 15;
  while (Date.now() < wait); // let the clock pass T so the switch lands after it
  switchRecurrence(db, null, "c", "daily", null, TODAY);
  const item = db.prepare("select * from items where id = 'c'").get() as any;
  item.done = item.done === 1;
  item.archived = item.archived === 1;
  const events = db.prepare("select * from item_events where item_id = 'c' order by id").all() as any[];
  ok("c: the switch is journalled", events.some((e) => e.field === "recurrence" && e.old_value === "none" && e.new_value === "daily"), true);
  const then = reconstructItemAt(item, events, T);
  ok("c: rewound to before the switch the card is done (judged as a one-off)", then.done, true);
}

console.log(failures === 0 ? "\nall completion tests passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
