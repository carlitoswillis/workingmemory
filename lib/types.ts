import type { ListId } from "./lists";

// Mirrors the local SQLite tables (see lib/schema.ts). In the DB `done`/`archived`
// are 0/1 integers; the data layer (lib/queries.ts) maps them to booleans here.
// `id` is a uuid string. Single-user/offline now — no user_id.
export interface Item {
  id: string;
  text: string;
  details: string;
  list: ListId;
  done: boolean;
  recurrence: string; // 'none' | 'daily'
  completed_on: string | null; // YYYY-MM-DD a daily task was last checked off
  // Every day this daily task ended up checked, from completed_on history events
  // (lib/streaks.ts). Populated by lib/queries.ts for daily items only — not a DB
  // column. Streak display = currentStreak() over these, client-side (browser TZ).
  completed_days?: string[];
  parent_id: string | null; // a sub-card's parent item; null = top-level board card
  position: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ItemEvent {
  id: number;
  item_id: string;
  type: string; // created | edited | moved | completed | reopened | archived
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  actor_id: string | null; // who did it (shared boards); null pre-feature + local/demo
  at: string;
}
