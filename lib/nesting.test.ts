// Run: node lib/nesting.test.ts   (plain node script, same convention as the others)
//
// Move cards into other cards and back out (lib/nesting.ts): re-parenting, the guards
// that keep the tree a tree (no self/descendant loops, no nesting the daily note),
// board scoping, and the trigger-written history the time machine reads back.

import Database from "better-sqlite3";
import { CREATE_TABLES, CREATE_TRIGGERS, migrateDb } from "./schema.ts";
import { setParent } from "./nesting.ts";
import { getItems } from "./queries.ts";
import { reconstructBoardAt } from "./timetravel.ts";

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

// Local scope (board_id null), like the owner's own file.
const B = null;
let seq = 0;
function addItem(id: string, text: string, list: string, boardId: string | null = B): string {
  db.prepare(
    "insert into items (id, text, list, position, board_id) values (?, ?, ?, ?, ?)",
  ).run(id, text, list, (seq += 1000), boardId);
  return id;
}
const row = (id: string) =>
  db.prepare("select list, parent_id, position from items where id = ?").get(id) as {
    list: string;
    parent_id: string | null;
    position: number;
  };
const parentEvents = (id: string) =>
  db
    .prepare("select old_value, new_value, type, actor_id from item_events where item_id = ? and field = 'parent' order by id")
    .all(id) as { old_value: string | null; new_value: string | null; type: string; actor_id: string | null }[];

addItem("host", "Ship the thing", "today");
addItem("chore", "Book the flight", "backlog");
addItem("chore2", "Pack", "backlog");
addItem("note", "Daily note", "note");

// --- nesting ---------------------------------------------------------------
ok(
  "nest returns moved count",
  setParent(db, B, { ids: ["chore"], parentId: "host", actorId: null }),
  { ok: true, moved: 1 },
);
ok("child points at its new parent", row("chore").parent_id, "host");
ok("child inherits the parent's column", row("chore").list, "today");
ok("nesting is logged as a parent move", parentEvents("chore"), [
  { old_value: null, new_value: "host", type: "moved", actor_id: null },
]);
ok(
  "the column change is logged too",
  (
    db
      .prepare("select old_value, new_value from item_events where item_id = 'chore' and field = 'list'")
      .all() as { old_value: string; new_value: string }[]
  ),
  [{ old_value: "backlog", new_value: "today" }],
);
ok(
  "a nested card leaves the board's top level",
  getItems(db, B).filter((i) => !i.parent_id).map((i) => i.id),
  ["host", "chore2", "note"],
);

// Re-nesting into the same parent is a no-op, not a duplicate event.
ok(
  "already-there is a no-op",
  setParent(db, B, { ids: ["chore"], parentId: "host", actorId: null }),
  { ok: true, moved: 0 },
);
ok("no extra event for the no-op", parentEvents("chore").length, 1);

// --- the guards ------------------------------------------------------------
ok(
  "a card can't go inside itself",
  setParent(db, B, { ids: ["host"], parentId: "host", actorId: null }),
  { error: "A card can't go inside itself or one of its own sub-cards." },
);
ok(
  "a card can't go inside its own sub-card",
  setParent(db, B, { ids: ["host"], parentId: "chore", actorId: null }),
  { error: "A card can't go inside itself or one of its own sub-cards." },
);
// …nor inside a deeper descendant.
addItem("grand", "Seat selection", "today");
setParent(db, B, { ids: ["grand"], parentId: "chore", actorId: null });
ok(
  "…nor inside a grandchild",
  setParent(db, B, { ids: ["host"], parentId: "grand", actorId: null }),
  { error: "A card can't go inside itself or one of its own sub-cards." },
);
ok("the refused card is untouched", row("host").parent_id, null);
ok(
  "the daily note can't be nested",
  setParent(db, B, { ids: ["note"], parentId: "host", actorId: null }),
  { error: "The daily note can't go inside a card." },
);
ok(
  "the daily note can't hold cards",
  setParent(db, B, { ids: ["chore2"], parentId: "note", actorId: null }),
  { error: "The daily note can't hold cards." },
);

// Archived parents are dead ends (you'd never see the card again).
addItem("gone", "Old plan", "backlog");
db.prepare("update items set archived = 1 where id = 'gone'").run();
ok(
  "an archived card can't be a parent",
  setParent(db, B, { ids: ["chore2"], parentId: "gone", actorId: null }),
  { error: "That card is archived." },
);

// --- board scoping (the IDOR guard) ----------------------------------------
db.prepare("insert into users (id, username, pass_hash) values ('u1', 'someone', 'x')").run();
db.prepare("insert into boards (id, name, created_by) values ('bOther', 'Other', 'u1')").run();
addItem("theirs", "Their card", "today", "bOther");
ok(
  "a card on another board is invisible",
  setParent(db, B, { ids: ["theirs"], parentId: "host", actorId: null }),
  { error: "That card is no longer on this board." },
);
ok("…and untouched", row("theirs").parent_id, null);
ok(
  "…and can't be used as a parent either",
  setParent(db, B, { ids: ["chore2"], parentId: "theirs", actorId: null }),
  { error: "That card is no longer on this board." },
);

// --- moving back out -------------------------------------------------------
ok(
  "pop out to a chosen column",
  setParent(db, B, { ids: ["chore"], parentId: null, actorId: null, list: "focus" }),
  { ok: true, moved: 1 },
);
ok("it's a board card again", row("chore").parent_id, null);
ok("…in the column it was sent to", row("chore").list, "focus");
ok("moving out is logged too", parentEvents("chore"), [
  { old_value: null, new_value: "host", type: "moved", actor_id: null },
  { old_value: "host", new_value: null, type: "moved", actor_id: null },
]);
ok("the subtree rode along", row("grand").parent_id, "chore");

// A block of cards keeps its order (distinct, increasing positions).
addItem("b1", "One", "backlog");
addItem("b2", "Two", "backlog");
setParent(db, B, { ids: ["b1", "b2"], parentId: "host", actorId: null });
ok("a dropped block lands in order", row("b1").position < row("b2").position, true);

// --- time travel reads the structure back ----------------------------------
// `chore` is a board card NOW; at a moment before it was popped out it was inside
// `host`, and before that it was a board card. The snapshot must say so.
const events = db
  .prepare("select * from item_events order by id")
  .all() as { item_id: string; at: string; field: string; new_value: string | null }[];
const nestedAt = events.find((e) => e.field === "parent" && e.new_value === "host")!.at;
const items = getItems(db, B);
const snapAtNest = reconstructBoardAt(items as never, events as never, nestedAt);
ok(
  "at the moment it was nested, it was a sub-card of host",
  snapAtNest.find((s) => s.id === "chore")?.parent_id,
  "host",
);
const beforeAll = "2000-01-01T00:00:00.000Z";
ok(
  "before any of it, nothing existed yet",
  reconstructBoardAt(items as never, events as never, beforeAll).length,
  0,
);

console.log(failures === 0 ? "\nall nesting tests passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
