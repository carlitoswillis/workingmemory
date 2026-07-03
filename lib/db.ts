import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { CREATE_TABLES, CREATE_TRIGGERS } from "./schema";
import { buildSeed } from "./demo/seed";
import { OWNER_COOKIE, verifyOwnerSession } from "./auth";

// The local store: one SQLite file under DATA_DIR (gitignored). Single-user,
// offline, no auth — your data lives on your machine. History is written by
// triggers in the DB (see lib/schema.ts), exactly as the old Postgres design did.
//
// DEMO MODE (hosted portfolio demo, DEMO_MODE=1): instead of the one local file,
// every visitor gets their own throwaway board at DATA_DIR/demo/<uuid>.db, keyed
// by an httpOnly cookie minted in middleware.ts. Each demo DB is seeded on first
// open with a realistic board + ~3 weeks of fabricated event history (see
// lib/demo/seed.ts) so the time machine has something to show immediately.
// Idle demo DBs are swept after 24h. With the flag off, nothing here changes.

export const DEMO_MODE = process.env.DEMO_MODE === "1";
export const DEMO_COOKIE = "wm_visitor";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DEMO_DIR = path.join(DATA_DIR, "demo");

const DEMO_TTL_MS = 24 * 60 * 60 * 1000; // delete demo DBs idle longer than this
const SWEEP_EVERY_MS = 10 * 60 * 1000; // opportunistic sweep, at most this often
const MAX_OPEN_DEMO_DBS = 50; // open connections, LRU-evicted (files stay)
const MAX_DEMO_DBS = 400; // files on disk; oldest deleted beyond this

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function openAt(file: string): Database.Database {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_TABLES);
  db.exec(CREATE_TRIGGERS);
  return db;
}

// ---------------------------------------------------------------------------
// Single-user local store (DEMO_MODE off) — same behavior as always.
// Reuse one connection across hot-reloads in dev (Next re-evaluates modules).

const globalForDb = globalThis as unknown as {
  __wmDb?: Database.Database;
  __wmOwnerDb?: Database.Database;
  __wmDemoCache?: Map<string, { db: Database.Database; lastUsed: number }>;
};

function localDb(): Database.Database {
  if (!globalForDb.__wmDb) globalForDb.__wmDb = openAt(path.join(DATA_DIR, "wm.db"));
  return globalForDb.__wmDb;
}

// The owner's real board on the hosted instance (DEMO_MODE=1 + a valid owner
// session). Separate file from the local one so DATA_DIR can be a mounted
// volume with demo/ and owner/ side by side; Litestream replicates this file.
function ownerDb(): Database.Database {
  if (!globalForDb.__wmOwnerDb)
    globalForDb.__wmOwnerDb = openAt(path.join(DATA_DIR, "owner", "wm.db"));
  return globalForDb.__wmOwnerDb;
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

// Does the current request carry a valid owner session? Only meaningful on the
// hosted instance (DEMO_MODE=1 + OWNER_SECRET set); locally there's no auth
// concept at all.
export function isOwnerRequest(): boolean {
  if (!DEMO_MODE) return false;
  const secret = process.env.OWNER_SECRET;
  if (!secret) return false;
  const token = cookies().get(OWNER_COOKIE)?.value ?? "";
  return verifyOwnerSession(token, secret);
}

// Is the current request a demo visitor (vs the owner / local single-user)?
// With DEMO_MODE on, everyone is a demo visitor EXCEPT a valid owner session.
export function isDemoRequest(): boolean {
  return DEMO_MODE && !isOwnerRequest();
}

// The database for the current request. With DEMO_MODE off this is always the
// single local file — identical to the old module-level singleton.
export function getDb(): Database.Database {
  if (!DEMO_MODE) return localDb();
  if (isOwnerRequest()) return ownerDb();
  const raw = cookies().get(DEMO_COOKIE)?.value?.toLowerCase() ?? "";
  // Sanitized: only a UUID ever becomes a filename. Cookieless clients (bots,
  // curl) share one throwaway board rather than erroring.
  const id = UUID_RE.test(raw) ? raw : "shared-fallback";
  return demoDb(id);
}

// The owner-side DB regardless of request cookies — for /api/export, which does
// its own auth. Hosted → the owner file; local (flag off) → the one local file.
export function getOwnerDb(): Database.Database {
  return DEMO_MODE ? ownerDb() : localDb();
}
