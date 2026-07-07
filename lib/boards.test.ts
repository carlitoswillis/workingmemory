// Run: node lib/boards.test.ts   (plain node script, same convention as the others)
//
// Shared boards v1: board is the scope now. Covers board CRUD + membership/roles,
// board-scoped isolation of every query + the `and board_id is ?` IDOR guard actions
// use, trigger v2 actor attribution (+ no double-logging after a v1→v2 upgrade), and
// migrateDb's lists (id,user_id)→(id,board_id) re-key.

import Database from "better-sqlite3";
import { CREATE_TABLES, CREATE_TRIGGERS, migrateDb, ISO_NOW } from "./schema.ts";
import { createUser } from "./users.ts";
import { getItems, getArchivedItems, getHistory, getTimelineData } from "./queries.ts";
import { ensureLists, getLists } from "./columns.ts";
import {
  createBoard,
  defaultBoardId,
  getMembership,
  getUserBoards,
  inviteMember,
  removeMember,
  MAX_MEMBERS_PER_BOARD,
} from "./boards.ts";

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

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_TABLES);
  migrateDb(db);
  db.exec(CREATE_TRIGGERS);
  return db;
}

function newUser(db: Database.Database, name: string): string {
  const res = createUser(db, name, "longenough");
  if ("error" in res) throw new Error(`createUser ${name}: ${res.error}`);
  return res.id;
}

const db = freshDb();
const aliceId = newUser(db, "alice");
const bob = newUser(db, "bob");

// --- board creation + membership + roles -----------------------------------
const aBoardRes = createBoard(db, aliceId, "Alice Personal");
const aBoard = "id" in aBoardRes ? aBoardRes.id : "";
ok("createBoard makes the creator an owner", getMembership(db, aBoard, aliceId), "owner");
ok("defaultBoardId is the user's board", defaultBoardId(db, aliceId), aBoard);
ok("non-member has no membership", getMembership(db, aBoard, bob), null);

const bBoardRes = createBoard(db, bob, "Bob Personal");
const bBoard = "id" in bBoardRes ? bBoardRes.id : "";

// invite bob to alice's board
ok("invite by username adds a member", "ok" in inviteMember(db, aBoard, "bob"), true);
ok("invited user is a member", getMembership(db, aBoard, bob), "member");
ok("re-invite is idempotent (still member, no dup)", "ok" in inviteMember(db, aBoard, "BOB"), true);
ok(
  "board_members has exactly one row for bob on aBoard",
  (db.prepare("select count(*) c from board_members where board_id = ? and user_id = ?").get(aBoard, bob) as { c: number }).c,
  1,
);
ok("invite unknown username errors", "error" in inviteMember(db, aBoard, "nobody"), true);
ok("bob now belongs to two boards", getUserBoards(db, bob).length, 2);

// --- board-scoped item isolation -------------------------------------------
const ins = db.prepare(
  "insert into items (id, text, list, position, user_id, board_id, touched_by) values (?, ?, ?, ?, ?, ?, ?)",
);
ins.run("a1", "on alice board", "today", 1, aliceId, aBoard, aliceId);
ins.run("a2", "also alice board", "focus", 2, bob, aBoard, bob); // bob created it, on aBoard
ins.run("b1", "on bob board", "today", 3, bob, bBoard, bob);

ok("aBoard sees its items", getItems(db, aBoard).map((i) => i.id), ["a1", "a2"]);
ok("bBoard sees its items", getItems(db, bBoard).map((i) => i.id), ["b1"]);

// IDOR guard: acting on bBoard, try to edit a1 (an aBoard card) by id — no-op.
const guard = db.prepare("update items set text = ? where id = ? and board_id is ?");
ok("cross-board update is a no-op", guard.run("hacked", "a1", bBoard).changes, 0);
ok("same-board update lands", guard.run("edited on board", "a1", aBoard).changes, 1);

// history + timeline scope by board (through the items join)
ok("history scoped to the board", getHistory(db, aBoard, "a1").map((e) => e.type), ["created", "edited"]);
ok("other board can't read that history", getHistory(db, bBoard, "a1"), []);
ok("timeline items scoped", getTimelineData(db, aBoard).items.map((i) => i.id).sort(), ["a1", "a2"]);

// archive scope
db.prepare("update items set archived = 1 where id = ? and board_id is ?").run("a2", aBoard);
ok("archive scoped to the board", getArchivedItems(db, aBoard).map((i) => i.id), ["a2"]);
ok("other board's archive is empty", getArchivedItems(db, bBoard), []);

// --- actor attribution (trigger v2) ----------------------------------------
// An edit through the real action shape stamps touched_by, which the trigger copies.
db.prepare("update items set text = ?, touched_by = ? where id = ? and board_id is ?").run(
  "bob was here",
  bob,
  "a1",
  aBoard,
);
ok(
  "created event records the actor from touched_by",
  (db.prepare("select actor_id from item_events where item_id = 'a1' and type = 'created'").get() as { actor_id: string }).actor_id,
  aliceId,
);
ok(
  "edited event records the editor (touched_by)",
  (db.prepare("select actor_id from item_events where item_id = 'a1' and type = 'edited' order by id desc limit 1").get() as { actor_id: string }).actor_id,
  bob,
);

// --- columns are board-scoped ----------------------------------------------
ensureLists(db, aBoard);
ensureLists(db, bBoard);
ok("each board seeds its own default columns", getLists(db, aBoard).map((l) => l.id), [
  "today", "focus", "waiting", "backlog", "braindump",
]);
ok(
  "same default id can exist on two boards (composite pk)",
  (db.prepare("select count(*) c from lists where id = 'today'").get() as { c: number }).c,
  2,
);

// --- roles + leave guard ---------------------------------------------------
ok("owner can remove a member", "ok" in removeMember(db, aBoard, bob), true);
ok("bob dropped from aBoard", getMembership(db, aBoard, bob), null);
ok("last owner can't leave", "error" in removeMember(db, aBoard, aliceId), true);

// member cap: owner + (MAX-1) invitees fills the board; one more is refused.
const capDb = freshDb();
const owner = newUser(capDb, "owner");
const capRes = createBoard(capDb, owner, "Cap");
const capBoard = "id" in capRes ? capRes.id : "";
for (let i = 1; i < MAX_MEMBERS_PER_BOARD; i++) {
  newUser(capDb, `member${i}`);
  inviteMember(capDb, capBoard, `member${i}`);
}
newUser(capDb, "overflow");
ok("member cap is enforced", "error" in inviteMember(capDb, capBoard, "overflow"), true);

// --- migrateDb: lists (id,user_id) -> (id,board_id) re-key ------------------
{
  const old = new Database(":memory:");
  old.pragma("foreign_keys = ON");
  // minimal old-shape DB: users + the FIRST lists schema (keyed by user_id)
  old.exec(`
    create table users (id text primary key, username text, pass_hash text, created_at text);
    create table lists (
      id text not null, user_id text, label text not null, hint text not null default '',
      position real not null default 0, archived integer not null default 0,
      created_at text not null default (${ISO_NOW}), primary key (id, user_id)
    );
    insert into users (id, username, pass_hash) values ('u1', 'owner', 'h');
    insert into lists (id, user_id, label, position) values ('today', 'u1', 'Today', 1000);
    insert into lists (id, user_id, label, position) values ('today', null, 'Today', 1000);
  `);
  // CREATE_TABLES won't touch the existing lists table; migrateDb rebuilds it.
  old.exec(CREATE_TABLES);
  migrateDb(old);
  const cols = (old.pragma("table_info(lists)") as { name: string }[]).map((c) => c.name);
  ok("re-keyed lists has board_id, not user_id", [cols.includes("board_id"), cols.includes("user_id")], [true, false]);
  ok(
    "unowned column copied straight over (board_id null)",
    (old.prepare("select count(*) c from lists where id = 'today' and board_id is null").get() as { c: number }).c,
    1,
  );
  ok(
    "owned column parked in lists_legacy for the bootstrap",
    (old.prepare("select count(*) c from lists_legacy where user_id = 'u1'").get() as { c: number }).c,
    1,
  );
}

// --- no double-logging after a v1 -> v2 trigger upgrade ---------------------
{
  const up = new Database(":memory:");
  up.pragma("foreign_keys = ON");
  up.exec(CREATE_TABLES);
  migrateDb(up);
  // Simulate a pre-shared-boards DB: a v1-named logging trigger already exists.
  up.exec(`
    create trigger items_log_text after update of text on items
    when new.text is not old.text
    begin
      insert into item_events (item_id, type, field, old_value, new_value, at)
      values (new.id, 'edited', 'text', old.text, new.text, ${ISO_NOW});
    end;
  `);
  up.exec(CREATE_TRIGGERS); // must DROP items_log_text and create items_log_text_v2
  up.prepare("insert into items (id, text, list) values ('x', 'a', 'today')").run();
  up.prepare("update items set text = 'b' where id = 'x'").run();
  ok(
    "exactly one 'edited' event (v1 trigger was dropped, no double-log)",
    (up.prepare("select count(*) c from item_events where item_id = 'x' and type = 'edited'").get() as { c: number }).c,
    1,
  );
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall boards tests passed");
