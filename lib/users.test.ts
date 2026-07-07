// Run: node lib/users.test.ts   (plain node script, same convention as the others)
//
// Covers the accounts layer end-to-end against a scratch in-memory DB:
// user CRUD (lib/users.ts) and — the part that matters most — per-user
// isolation of every read in lib/queries.ts plus the `and user_id is ?`
// ownership guard the server actions put on every update.

import Database from "better-sqlite3";
import { CREATE_TABLES, CREATE_TRIGGERS, migrateDb } from "./schema.ts";
import { createUser, authenticate, changePassword, findUserByUsername, getUsername } from "./users.ts";
import { getItems, getArchivedItems, getHistory, getTimelineData } from "./queries.ts";
import { ensureLists, getLists, renameList } from "./columns.ts";

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

// --- user CRUD -------------------------------------------------------------

ok("bad username rejected", "error" in createUser(db, "x", "longenough"), true);
ok("uppercase username normalized", "id" in createUser(db, "Alice", "longenough"), true);
ok("short password rejected", "error" in createUser(db, "bob", "short"), true);

const alice = findUserByUsername(db, "alice")!;
ok("username stored lowercased", alice.username, "alice");
ok("duplicate rejected case-insensitively", "error" in createUser(db, "ALICE", "longenough"), true);

const bobRes = createUser(db, "bob", "bobs-password");
const bobId = "id" in bobRes ? bobRes.id : "";
ok("second user created", bobId.length > 0, true);
ok("getUsername round-trips", getUsername(db, bobId), "bob");

ok("authenticate: right password", authenticate(db, "alice", "longenough"), alice.id);
ok("authenticate: wrong password", authenticate(db, "alice", "nope-nope-nope"), null);
ok("authenticate: unknown user", authenticate(db, "carol", "whatever-pw"), null);

ok("changePassword: wrong old rejected", "error" in changePassword(db, alice.id, "wrong-old", "new-password-1"), true);
ok("changePassword: ok", "ok" in changePassword(db, alice.id, "longenough", "new-password-1"), true);
ok("old password no longer works", authenticate(db, "alice", "longenough"), null);
ok("new password works", authenticate(db, "alice", "new-password-1"), alice.id);

// --- per-user isolation ----------------------------------------------------
// Inserts/updates use the exact SQL shapes app/actions.ts uses.

const ins = db.prepare("insert into items (id, text, list, position, user_id) values (?, ?, ?, ?, ?)");
ins.run("a1", "alice card", "today", 1, alice.id);
ins.run("a2", "alice secret", "focus", 2, alice.id);
ins.run("b1", "bob card", "today", 3, bobId);
ins.run("n1", "unowned (demo/local) card", "today", 4, null);

ok("alice sees only her items", getItems(db, alice.id).map((i) => i.id), ["a1", "a2"]);
ok("bob sees only his items", getItems(db, bobId).map((i) => i.id), ["b1"]);
ok("null scope sees only unowned rows", getItems(db, null).map((i) => i.id), ["n1"]);

// Ownership guard: bob "guesses" a1's id — the update must be a no-op.
const guard = db.prepare("update items set text = ? where id = ? and user_id is ?");
ok("cross-user update is a no-op", guard.run("hacked", "a1", bobId).changes, 0);
ok("own update lands", guard.run("alice card v2", "a1", alice.id).changes, 1);

// History (written by the triggers above) stays scoped through the items join.
ok(
  "alice's history shows her edit",
  getHistory(db, alice.id, "a1").map((e) => e.type),
  ["created", "edited"],
);
ok("bob can't read alice's history", getHistory(db, bobId, "a1"), []);

const tlA = getTimelineData(db, alice.id);
ok("timeline items scoped", tlA.items.map((i) => i.id).sort(), ["a1", "a2"]);
ok("timeline events all belong to alice's items", tlA.events.every((e) => e.item_id === "a1" || e.item_id === "a2"), true);

// Archive view scoping.
db.prepare("update items set archived = 1 where id = ? and user_id is ?").run("a2", alice.id);
ok("alice's archive shows a2", getArchivedItems(db, alice.id).map((i) => i.id), ["a2"]);
ok("bob's archive is empty", getArchivedItems(db, bobId), []);

// Columns (user-created lists) are per-user: seeding + reads scope by user_id, and
// a pre-columns board's saved profiles.list_order seeds the default column order.
db.prepare(
  `insert into profiles (id, list_order, updated_at) values (?, ?, ?)
   on conflict(id) do update set list_order = excluded.list_order, updated_at = excluded.updated_at`,
).run(alice.id, JSON.stringify(["focus", "today"]), new Date().toISOString());
ensureLists(db, alice.id);
ensureLists(db, null); // local scope, seeded independently
ok("alice seeded the 5 default columns", getLists(db, alice.id).length, 5);
ok("alice's saved list_order leads the seed", getLists(db, alice.id)[0].id, "focus");
ok("bob has no columns until his board is seeded", getLists(db, bobId), []);
ok("local scope seeded independently", getLists(db, null).length, 5);
renameList(db, alice.id, "today", "Alice Today");
ok("rename is scoped to alice", getLists(db, null).find((l) => l.id === "today")!.label, "Today");
ok("alice sees her rename", getLists(db, alice.id).find((l) => l.id === "today")!.label, "Alice Today");

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall users tests passed");
