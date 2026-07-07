import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { CREATE_TABLES, CREATE_TRIGGERS, migrateDb } from "./schema";
import { buildSeed } from "./demo/seed";
import { SESSION_COOKIE, hashPassword, verifyUserSession } from "./auth";
import { defaultBoardId, getMembership } from "./boards";

// The local store: one SQLite file under DATA_DIR (gitignored). Single-user,
// offline, no auth — your data lives on your machine. History is written by
// triggers in the DB (see lib/schema.ts), exactly as the old Postgres design did.
//
// HOSTED (DEMO_MODE=1): two kinds of boards.
//   - Accounts (multiple-accounts v1): every signed-up user's rows live in ONE
//     multi-tenant DB at DATA_DIR/owner/wm.db (the path predates accounts and is
//     kept so Litestream replication + B2 generations don't churn — read it as
//     "main.db"). Scoping is app-level: items.user_id + `user_id IS ?` in every
//     query (lib/queries.ts). One file means the drill-tested Litestream
//     restore-on-boot, /api/export|import, and pull-backup pipelines all keep
//     working unchanged — per-account files would silently not be replicated.
//   - Anonymous visitors get their own throwaway board at DATA_DIR/demo/<uuid>.db,
//     keyed by an httpOnly cookie minted in middleware.ts, seeded on first open
//     with ~3 weeks of fabricated history (lib/demo/seed.ts), swept after 24h idle.
// With the flag off, nothing here changes.

export const DEMO_MODE = process.env.DEMO_MODE === "1";
export const DEMO_COOKIE = "wm_visitor";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DEMO_DIR = path.join(DATA_DIR, "demo");

const DEMO_TTL_MS = 24 * 60 * 60 * 1000; // delete demo DBs idle longer than this
const SWEEP_EVERY_MS = 10 * 60 * 1000; // opportunistic sweep, at most this often
const MAX_OPEN_DEMO_DBS = 50; // open connections, LRU-evicted (files stay)
const MAX_DEMO_DBS = 400; // files on disk; oldest deleted beyond this

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function openAt(file: string, opts?: { bootstrapOwner?: boolean }): Database.Database {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_TABLES);
  migrateDb(db);
  // Bootstrap runs BEFORE triggers attach so backfills don't bump every item's
  // updated_at. The touch trigger fires on ANY update, so on an already-triggered
  // DB we drop it first (CREATE_TRIGGERS recreates it); the logging triggers only
  // fire on content columns, which bootstrap never touches.
  if (opts?.bootstrapOwner) {
    db.exec("drop trigger if exists items_touch_updated_at");
    bootstrapLegacyOwner(db);
    bootstrapBoards(db);
  }
  db.exec(CREATE_TRIGGERS);
  return db;
}

// Shared boards v1 bootstrap (main DB only), idempotent, one transaction, before
// triggers attach. Gives every account a "Personal" board (owner) and backfills
// items.board_id + re-homes the pre-boards `lists` columns (lists_legacy, produced
// by migrateDb's re-key) onto each owner's personal board. Keyed on "the membership
// is missing," so re-running — including after a pre-boards backup restore — is a
// no-op. actor_id/touched_by stay null on old rows (history before this feature has
// no actor; the UI shows nothing).
function bootstrapBoards(db: Database.Database) {
  const legacyExists = !!db
    .prepare("select 1 from sqlite_master where type = 'table' and name = 'lists_legacy'")
    .get();
  const usersNoBoard = db
    .prepare(
      "select id from users u where not exists (select 1 from board_members m where m.user_id = u.id)",
    )
    .all() as { id: string }[];
  if (usersNoBoard.length === 0 && !legacyExists) return;

  db.transaction(() => {
    for (const u of usersNoBoard) {
      const boardId = randomUUID();
      db.prepare("insert into boards (id, name, created_by) values (?, 'Personal', ?)").run(
        boardId,
        u.id,
      );
      db.prepare(
        "insert into board_members (board_id, user_id, role) values (?, ?, 'owner')",
      ).run(boardId, u.id);
      db.prepare("update items set board_id = ? where user_id = ? and board_id is null").run(
        boardId,
        u.id,
      );
    }
    if (legacyExists) {
      // Each user has exactly one owner membership at bootstrap (their personal
      // board), so this join re-homes their columns unambiguously.
      db.prepare(
        `insert or ignore into lists (id, board_id, label, hint, position, archived, created_at)
         select l.id, m.board_id, l.label, l.hint, l.position, l.archived, l.created_at
         from lists_legacy l
         join board_members m on m.user_id = l.user_id and m.role = 'owner'`,
      ).run();
      db.exec("drop table lists_legacy");
    }
  })();
}

// One-time, idempotent cutover of the pre-accounts hosted board (main DB only):
// if no users exist yet but legacy single-owner rows do, create user #1
// ('owner', password = the OWNER_SECRET that used to BE the login) and hand it
// every unowned row. The owner signs in as owner/<OWNER_SECRET> and changes the
// password. Re-runs are no-ops (users table non-empty). Restoring an old
// pre-accounts backup re-triggers it — which is exactly what you'd want.
function bootstrapLegacyOwner(db: Database.Database) {
  const secret = process.env.OWNER_SECRET;
  if (!secret) return;
  const users = (db.prepare("select count(*) c from users").get() as { c: number }).c;
  if (users > 0) return;
  const legacyItems = (
    db.prepare("select count(*) c from items where user_id is null").get() as { c: number }
  ).c;
  const legacyProfile = db.prepare("select 1 from profiles where id = 'local'").get();
  if (legacyItems === 0 && !legacyProfile) return;

  const id = randomUUID();
  db.transaction(() => {
    db.prepare("insert into users (id, username, pass_hash) values (?, 'owner', ?)").run(
      id,
      hashPassword(secret),
    );
    db.prepare("update items set user_id = ? where user_id is null").run(id);
    db.prepare("update profiles set id = ? where id = 'local'").run(id);
  })();
}

// ---------------------------------------------------------------------------
// Single-user local store (DEMO_MODE off) — same behavior as always.
// Reuse one connection across hot-reloads in dev (Next re-evaluates modules).

const globalForDb = globalThis as unknown as {
  __wmDb?: Database.Database;
  __wmMainDb?: Database.Database;
  __wmDemoCache?: Map<string, { db: Database.Database; lastUsed: number }>;
};

function localDb(): Database.Database {
  if (!globalForDb.__wmDb) globalForDb.__wmDb = openAt(path.join(DATA_DIR, "wm.db"));
  return globalForDb.__wmDb;
}

// The multi-tenant accounts DB on the hosted instance (all signed-up users,
// including the migrated ex-owner). Separate file from the local one so
// DATA_DIR can be a mounted volume with demo/ and owner/ side by side;
// Litestream replicates this file.
function mainDb(): Database.Database {
  if (!globalForDb.__wmMainDb)
    globalForDb.__wmMainDb = openAt(path.join(DATA_DIR, "owner", "wm.db"), {
      bootstrapOwner: true,
    });
  return globalForDb.__wmMainDb;
}

// ---------------------------------------------------------------------------
// Demo boards — one DB per visitor, seeded on creation, swept when idle.

const demoCache =
  globalForDb.__wmDemoCache ?? (globalForDb.__wmDemoCache = new Map());

function openDemoDb(file: string): Database.Database {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Seed BEFORE attaching triggers (the import-backup.ts pattern): if triggers
  // existed during the seed, every inserted row would emit a spurious "created"
  // event and clobber the fabricated history.
  db.exec(CREATE_TABLES);
  migrateDb(db);
  const empty =
    (db.prepare("select count(*) c from items").get() as { c: number }).c === 0;
  if (empty) {
    const seed = buildSeed(new Date());
    const insItem = db.prepare(`
      insert into items
        (id, text, list, done, position, archived, details, recurrence, completed_on, parent_id, created_at, updated_at)
      values
        (@id, @text, @list, @done, @position, @archived, @details, @recurrence, @completed_on, @parent_id, @created_at, @updated_at)
    `);
    const insEvent = db.prepare(`
      insert into item_events (item_id, type, field, old_value, new_value, at)
      values (@item_id, @type, @field, @old_value, @new_value, @at)
    `);
    db.transaction(() => {
      for (const it of seed.items) insItem.run(it);
      for (const e of seed.events) insEvent.run(e);
    })();
  }
  db.exec(CREATE_TRIGGERS);
  return db;
}

function closeDemoDb(id: string) {
  const entry = demoCache.get(id);
  if (entry) {
    try {
      entry.db.close();
    } catch {}
    demoCache.delete(id);
  }
}

function removeDemoFiles(file: string) {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {}
  }
}

// A demo DB's "last used" is the newest of the main file and its WAL (writes land
// in the -wal file until checkpoint, so the .db mtime alone can be stale).
function demoDbMtime(file: string): number {
  let t = 0;
  for (const f of [file, `${file}-wal`]) {
    try {
      t = Math.max(t, fs.statSync(f).mtimeMs);
    } catch {}
  }
  return t;
}

let lastSweep = 0;

// No background process (owner constraint): sweep opportunistically when a new
// demo board is created, throttled. Deletes DBs idle > TTL, then trims the
// oldest files if the count cap is still exceeded.
function sweepDemoDbs() {
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;

  let files: string[];
  try {
    files = fs.readdirSync(DEMO_DIR).filter((f) => f.endsWith(".db"));
  } catch {
    return;
  }

  const aged = files
    .map((f) => {
      const file = path.join(DEMO_DIR, f);
      return { id: f.slice(0, -3), file, mtime: demoDbMtime(file) };
    })
    .sort((a, b) => a.mtime - b.mtime);

  let live = aged.length;
  for (const d of aged) {
    const idle = now - d.mtime > DEMO_TTL_MS;
    const overCap = live > MAX_DEMO_DBS;
    if (!idle && !overCap) break;
    closeDemoDb(d.id);
    removeDemoFiles(d.file);
    live--;
  }
}

function demoDb(id: string): Database.Database {
  const cached = demoCache.get(id);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.db;
  }

  const file = path.join(DEMO_DIR, `${id}.db`);
  if (!fs.existsSync(file)) sweepDemoDbs();
  const db = openDemoDb(file);

  if (demoCache.size >= MAX_OPEN_DEMO_DBS) {
    // Evict the least-recently-used open connection (its file stays on disk).
    let oldest: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of demoCache) {
      if (v.lastUsed < oldestAt) {
        oldestAt = v.lastUsed;
        oldest = k;
      }
    }
    if (oldest) closeDemoDb(oldest);
  }
  demoCache.set(id, { db, lastUsed: Date.now() });
  return db;
}

// ---------------------------------------------------------------------------

// The signed-in user for the current request, or null. Only meaningful on the
// hosted instance (DEMO_MODE=1 + SESSION_SECRET set); locally there's no auth
// concept at all. Tokens are stateless, so also confirm the user still exists
// (a deleted account's token would otherwise verify forever).
export function getRequestUserId(): string | null {
  if (!DEMO_MODE) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const token = cookies().get(SESSION_COOKIE)?.value ?? "";
  if (!token) return null;
  const userId = verifyUserSession(token, secret);
  if (!userId) return null;
  return mainDb().prepare("select 1 from users where id = ?").get(userId) ? userId : null;
}

// Is the current request a demo visitor (vs a signed-in account / local
// single-user)? With DEMO_MODE on, everyone is a demo visitor EXCEPT a valid
// session.
export function isDemoRequest(): boolean {
  return DEMO_MODE && !getRequestUserId();
}

// The board for the current request: which DB file, which board within it, and
// who's acting. boardId null means "the whole file is the board" (local mode and
// per-visitor demo files); every query filters `board_id IS ?` so both cases use
// the same SQL shape (IS matches null). userId is the acting account (for
// attribution + membership) or null off the hosted instance.
export type BoardContext = { db: Database.Database; userId: string | null; boardId: string | null };

// `requestedBoardId` comes from the URL (/b/[id]) or an action's explicit arg;
// omit it for the default (personal) board. Membership is verified HERE — the one
// choke point — so no query downstream re-checks it. A non-member (or bogus id)
// gets a 404, never a 403 (don't confirm a board exists to someone off it).
export function getBoardContext(requestedBoardId?: string | null): BoardContext {
  if (!DEMO_MODE) return { db: localDb(), userId: null, boardId: null };
  const userId = getRequestUserId();
  if (userId) {
    const db = mainDb();
    const boardId = requestedBoardId ?? defaultBoardId(db, userId);
    if (boardId && !getMembership(db, boardId, userId)) notFound();
    return { db, userId, boardId };
  }
  const raw = cookies().get(DEMO_COOKIE)?.value?.toLowerCase() ?? "";
  // Sanitized: only a UUID ever becomes a filename. Cookieless clients (bots,
  // curl) share one throwaway board rather than erroring.
  const id = UUID_RE.test(raw) ? raw : "shared-fallback";
  return { db: demoDb(id), userId: null, boardId: null };
}

// The main (accounts) DB regardless of request cookies — for login/signup and
// /api/export, which do their own auth. Hosted → the multi-tenant file; local
// (flag off) → the one local file.
export function getMainDb(): Database.Database {
  return DEMO_MODE ? mainDb() : localDb();
}

// Replace the main DB file with an uploaded snapshot (the one-time cutover
// migration of the local wm.db to the hosted instance, and the disaster-
// recovery path from any pulled backup). Verifies the incoming bytes as a
// sane Working Memory DB BEFORE touching the live file, then closes the open
// handle and swaps atomically. Throws (changing nothing) on a bad snapshot.
// A pre-accounts snapshot is fine: the next open migrates + re-bootstraps it.
// NOTE: if Litestream is replicating this file, restart the machine after an
// import so it snapshots a fresh generation.
export function replaceMainDb(snapshot: Buffer): { items: number; events: number } {
  const file = DEMO_MODE ? path.join(DATA_DIR, "owner", "wm.db") : path.join(DATA_DIR, "wm.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const incoming = `${file}.incoming`;
  fs.writeFileSync(incoming, snapshot);

  let counts: { items: number; events: number };
  const check = new Database(incoming, { readonly: true });
  try {
    const ic = check.pragma("integrity_check", { simple: true });
    if (ic !== "ok") throw new Error(`integrity_check: ${ic}`);
    counts = {
      items: (check.prepare("select count(*) c from items").get() as { c: number }).c,
      events: (check.prepare("select count(*) c from item_events").get() as { c: number }).c,
    };
  } catch (e) {
    check.close();
    fs.rmSync(incoming, { force: true });
    throw e instanceof Error ? e : new Error(String(e));
  }
  check.close();

  if (DEMO_MODE) {
    try {
      globalForDb.__wmMainDb?.close();
    } catch {}
    globalForDb.__wmMainDb = undefined;
  } else {
    try {
      globalForDb.__wmDb?.close();
    } catch {}
    globalForDb.__wmDb = undefined;
  }
  for (const f of [`${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  fs.renameSync(incoming, file); // next getBoardContext()/getMainDb() reopens lazily
  return counts;
}
