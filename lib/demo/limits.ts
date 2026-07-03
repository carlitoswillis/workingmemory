import type Database from "better-sqlite3";

// Write caps for demo boards (see lib/db.ts). These are abuse guards, not UX —
// generous enough that a real visitor never hits them. Write RATE limiting is
// handled per-visitor in middleware.ts; these bound total size instead.

export const DEMO_MAX_ITEMS = 250;
export const DEMO_MAX_TEXT = 500;
export const DEMO_MAX_DETAILS = 5000;

export function demoAddBlocked(db: Database.Database): boolean {
  const { c } = db.prepare("select count(*) c from items").get() as { c: number };
  return c >= DEMO_MAX_ITEMS;
}

export const clampDemoText = (s: string) => s.slice(0, DEMO_MAX_TEXT);
export const clampDemoDetails = (s: string) => s.slice(0, DEMO_MAX_DETAILS);
