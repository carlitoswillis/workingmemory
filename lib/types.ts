import type { ListId } from "./lists";

// Mirrors the Postgres tables (see supabase/migrations). `done`/`archived` are
// real booleans now (Postgres), and `id` is a uuid string.
export interface Item {
  id: string;
  user_id: string;
  text: string;
  details: string;
  list: ListId;
  done: boolean;
  recurrence: string; // 'none' | 'daily'
  completed_on: string | null; // YYYY-MM-DD a daily task was last checked off
  position: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ItemEvent {
  id: number;
  item_id: string;
  user_id: string;
  type: string; // created | edited | moved | completed | reopened | archived
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  at: string;
}
