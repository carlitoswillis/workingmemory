import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { CREATE_TABLES, CREATE_TRIGGERS } from "./schema";

// The local store: one SQLite file under /data (gitignored). Single-user, offline,
// no auth — your data lives on your machine. History is written by triggers in the
// DB (see lib/schema.ts), exactly as the old Postgres design did.

const DB_PATH = path.join(process.cwd(), "data", "wm.db");

function open(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_TABLES);
  db.exec(CREATE_TRIGGERS);
  return db;
}

// Reuse one connection across hot-reloads in dev (Next re-evaluates modules).
const globalForDb = globalThis as unknown as { __wmDb?: Database.Database };
const db = globalForDb.__wmDb ?? open();
if (process.env.NODE_ENV !== "production") globalForDb.__wmDb = db;

export default db;
