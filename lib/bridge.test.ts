// Run: node lib/bridge.test.ts   (plain node script, same convention as the others)
//
// The bridge's board resolver (lib/bridge.ts#resolveOwnerBoard) — the one place
// /api/context, /api/review and /api/items agree on "the owner's board".
//
// The bug this pins down (2026-09-04): resolution was ONLY "the board the owner
// most recently wrote to", so a batch of status flips on the "watching"
// sub-board edged out "Personal" by seconds and the Friday review POSTed its
// sentinel card onto a movie list. Resolution is now deterministic — an env pin,
// then the oldest ROOT board with the canonical columns, then the old heuristic.

import Database from "better-sqlite3";
import { CREATE_TABLES, CREATE_TRIGGERS, migrateDb } from "./schema.ts";
import { resolveOwnerBoard } from "./bridge.ts";
import { DEFAULT_LISTS } from "./lists.ts";

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

// The hosted shape, in miniature: the owner ("owner") holds a task board and a
// "watching" movie list that a card on the task board OPENS INTO (a doorway),
// plus a stranger who owns a board of their own.
function seed(db: Database.Database) {
  db.prepare("insert into users (id, username, pass_hash) values ('u1', 'owner', 'x')").run();
  db.prepare("insert into users (id, username, pass_hash) values ('u2', 'ros1ta', 'x')").run();
  for (const [id, name, by, at] of [
    ["bHome", "Personal", "u1", "2026-07-07T22:11:19.475Z"],
    ["bWatch", "watching", "u1", "2026-08-30T22:55:46.708Z"],
    ["bTheirs", "Theirs", "u2", "2026-07-08T00:00:00.000Z"],
  ] as const) {
    db.prepare("insert into boards (id, name, created_by, created_at) values (?, ?, ?, ?)").run(
      id,
      name,
      by,
      at,
    );
  }
  for (const [board, user, role] of [
    ["bHome", "u1", "owner"],
    ["bWatch", "u1", "owner"],
    ["bTheirs", "u2", "owner"],
  ] as const) {
    db.prepare("insert into board_members (board_id, user_id, role) values (?, ?, ?)").run(
      board,
      user,
      role,
    );
  }
  // Both of the owner's boards carry the seeded DEFAULT_LISTS — which is exactly
  // why the canonical columns alone can't tell them apart, and the doorway does.
  for (const boardId of ["bHome", "bWatch", "bTheirs"]) {
    DEFAULT_LISTS.forEach((l, i) =>
      db
        .prepare("insert into lists (id, board_id, label, hint, position) values (?, ?, ?, ?, ?)")
        .run(l.id, boardId, l.label, l.hint, (i + 1) * 1000),
    );
  }
}

// An item whose updated_at is forced, so "most recently touched" is decidable.
let seq = 0;
function addItem(
  db: Database.Database,
  id: string,
  text: string,
  boardId: string,
  updatedAt: string,
  linkedBoardId: string | null = null,
) {
  db.prepare(
    `insert into items (id, text, list, position, user_id, board_id, touched_by, linked_board_id, created_at, updated_at)
     values (?, ?, 'today', ?, 'u1', ?, 'u1', ?, ?, ?)`,
  ).run(id, text, ++seq, boardId, linkedBoardId, updatedAt, updatedAt);
  // The triggers stamp updated_at on write; set it back to the value under test.
  db.prepare("update items set updated_at = ? where id = ?").run(updatedAt, id);
}

const ENV_KEYS = ["WM_OWNER_BOARD_ID", "OWNER_USERNAME"] as const;
function withEnv<T>(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => T): T {
  const saved = ENV_KEYS.map((k) => [k, process.env[k]] as const);
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ── (b) a root canonical board beats a more-recently-touched sub-board ──────
// The regression itself: "watching" is written to 28 seconds after "Personal",
// exactly as it happened on 2026-09-04.
{
  const db = freshDb();
  seed(db);
  addItem(db, "i1", "Ship the thing", "bHome", "2026-09-04T00:56:23.050Z");
  addItem(db, "i2", "Sinners", "bWatch", "2026-09-04T00:56:51.552Z");
  // The doorway: a card on Personal that opens into the watching board.
  addItem(db, "i3", "watching", "bHome", "2026-08-30T22:56:00.000Z", "bWatch");

  const got = withEnv({}, () => resolveOwnerBoard(db));
  ok("root canonical board wins over a fresher sub-board", got, {
    ownerId: "u1",
    boardId: "bHome",
    boardName: "Personal",
  });

  // ── (a) the env pin wins over everything ─────────────────────────────────
  ok(
    "WM_OWNER_BOARD_ID pins the board",
    withEnv({ WM_OWNER_BOARD_ID: "bWatch" }, () => resolveOwnerBoard(db)),
    { ownerId: "u1", boardId: "bWatch", boardName: "watching" },
  );
  ok(
    "a pin is trimmed before it is looked up",
    withEnv({ WM_OWNER_BOARD_ID: "  bWatch \n" }, () => resolveOwnerBoard(db)),
    { ownerId: "u1", boardId: "bWatch", boardName: "watching" },
  );

  // A pin the owner has no claim on never redirects the bridge — it warns and
  // falls through to the deterministic rule.
  for (const [label, pin] of [
    ["a pin for a board that doesn't exist falls through", "nope"],
    ["a pin for someone else's board falls through", "bTheirs"],
  ] as const) {
    ok(label, withEnv({ WM_OWNER_BOARD_ID: pin }, () => resolveOwnerBoard(db)), {
      ownerId: "u1",
      boardId: "bHome",
      boardName: "Personal",
    });
  }

  // Archiving the doorway card makes the movie list a root board too — and the
  // tie is then broken by age, not by which was touched last.
  db.prepare("update items set archived = 1 where id = 'i3'").run();
  ok("with the doorway gone, the OLDEST canonical root board wins", withEnv({}, () =>
    resolveOwnerBoard(db),
  ), { ownerId: "u1", boardId: "bHome", boardName: "Personal" });
}

// ── (c) the fallback: no canonical root board ──────────────────────────────
// Every column renamed, so nothing is canonical — resolution drops back to the
// old "most recently touched" heuristic rather than returning nothing.
{
  const db = freshDb();
  seed(db);
  db.prepare("update lists set label = 'currently' where id = 'today'").run();
  db.prepare("update lists set label = 'unreleased' where id = 'backlog'").run();
  addItem(db, "i1", "Ship the thing", "bHome", "2026-09-04T00:56:23.050Z");
  addItem(db, "i2", "Sinners", "bWatch", "2026-09-04T00:56:51.552Z");

  ok("falls back to the most recently touched board", withEnv({}, () => resolveOwnerBoard(db)), {
    ownerId: "u1",
    boardId: "bWatch",
    boardName: "watching",
  });

  // …and with no items at all, to the oldest board the owner created.
  db.prepare("delete from items").run();
  ok("with no items, falls back to the oldest board", withEnv({}, () => resolveOwnerBoard(db)), {
    ownerId: "u1",
    boardId: "bHome",
    boardName: "Personal",
  });
}

// An archived canonical column doesn't count: a board whose Today was retired is
// no longer the task board.
{
  const db = freshDb();
  seed(db);
  db.prepare("update lists set archived = 1 where id = 'today' and board_id = 'bHome'").run();
  addItem(db, "i2", "Sinners", "bWatch", "2026-09-04T00:56:51.552Z");
  ok(
    "a board with an archived Today is not canonical",
    withEnv({}, () => resolveOwnerBoard(db)),
    { ownerId: "u1", boardId: "bWatch", boardName: "watching" },
  );
}

// OWNER_USERNAME still picks who "the owner" is, and an empty DB still resolves
// to nothing rather than throwing.
{
  const db = freshDb();
  seed(db);
  ok(
    "OWNER_USERNAME selects the account",
    withEnv({ OWNER_USERNAME: "ros1ta" }, () => resolveOwnerBoard(db)),
    { ownerId: "u2", boardId: "bTheirs", boardName: "Theirs" },
  );
  ok("an empty DB resolves to null", withEnv({}, () => resolveOwnerBoard(freshDb())), null);
}

console.log(failures === 0 ? "\nbridge: all passed" : `\nbridge: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
