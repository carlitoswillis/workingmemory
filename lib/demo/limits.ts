import type Database from "better-sqlite3";

// Write caps for hosted boards (see lib/db.ts). These are abuse guards, not UX —
// generous enough that a real visitor never hits them. Write RATE limiting is
// handled per-visitor/IP in middleware.ts; these bound total size instead.
//
// Demo boards (whole throwaway file) and accounts (rows in the multi-tenant
// main DB) get separate item caps; the text/details clamps apply to both.

export const DEMO_MAX_ITEMS = 250;
export const DEMO_MAX_TEXT = 500;
export const DEMO_MAX_DETAILS = 5000;
export const ACCOUNT_MAX_ITEMS = Number(process.env.ACCOUNT_MAX_ITEMS ?? 2000);

export function demoAddBlocked(db: Database.Database): boolean {
  const { c } = db.prepare("select count(*) c from items").get() as { c: number };
  return c >= DEMO_MAX_ITEMS;
}

// Item cap for the current board: per-user on the main DB, whole-file on demo.
export function addBlocked(db: Database.Database, userId: string | null): boolean {
  if (userId === null) return demoAddBlocked(db);
  const { c } = db
    .prepare("select count(*) c from items where user_id is ?")
    .get(userId) as { c: number };
  return c >= ACCOUNT_MAX_ITEMS;
}

export const clampDemoText = (s: string) => s.slice(0, DEMO_MAX_TEXT);
export const clampDemoDetails = (s: string) => s.slice(0, DEMO_MAX_DETAILS);
