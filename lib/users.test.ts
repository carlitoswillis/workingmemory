// Run: node lib/users.test.ts   (plain node script, same convention as the others)
//
// Covers the accounts layer against a scratch in-memory DB: user CRUD + auth
// (lib/users.ts). Board-scoped isolation of the queries/actions moved to
// lib/boards.test.ts when the scope became board_id (shared boards, 2026-07-07).

import Database from "better-sqlite3";
import { CREATE_TABLES, CREATE_TRIGGERS, migrateDb } from "./schema.ts";
import { createUser, authenticate, changePassword, findUserByUsername, getUsername } from "./users.ts";

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

// keep bobId referenced for the round-trip above; board isolation lives in boards.test.ts
void bobId;

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall users tests passed");
