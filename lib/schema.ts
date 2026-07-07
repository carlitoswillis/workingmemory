// SQLite schema for the local, single-user store. Mirrors the old Postgres tables
// (supabase/migrations/0001–0005) so `lib/timetravel.ts`, the queries, and the
// components keep working unchanged.
//
// History is still written by DATABASE TRIGGERS, not app code — the whole point of
// the design — just translated to SQLite trigger syntax. Booleans are 0/1 integers
// and timestamps are ISO-8601 text (UTC, millisecond precision).
//
// TABLES and TRIGGERS are exported separately so the importer can bulk-load the
// backup BEFORE the triggers exist (otherwise every inserted row would generate a
// spurious "created" event and clobber the real history).

import type Database from "better-sqlite3";

export const ISO_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

export const CREATE_TABLES = `
-- Accounts (multiple-accounts v1). Only the main hosted DB ever has rows here;
-- demo/local DBs keep the table empty and all their items have user_id null.
create table if not exists users (
  id         text primary key,
  username   text not null unique collate nocase,
  pass_hash  text not null,
  created_at text not null default (${ISO_NOW})
);

create table if not exists items (
  id           text primary key,
  text         text not null check (length(text) > 0),
  list         text not null,
  done         integer not null default 0,
  position     real not null default 0,
  archived     integer not null default 0,
  details      text not null default '',
  recurrence   text not null default 'none',
  completed_on text,
  parent_id    text references items(id) on delete cascade,
  user_id      text references users(id),
  created_at   text not null default (${ISO_NOW}),
  updated_at   text not null default (${ISO_NOW})
);

create index if not exists items_parent_id_idx on items(parent_id);
create index if not exists items_list_idx on items(list, archived);

-- Append-only history log. Never updated or deleted in normal use.
create table if not exists item_events (
  id         integer primary key autoincrement,
  item_id    text not null references items(id) on delete cascade,
  type       text not null,   -- created | edited | moved | completed | reopened | archived
  field      text,            -- text | details | list | done | archived | completed_on
  old_value  text,
  new_value  text,
  at         text not null default (${ISO_NOW})
);

create index if not exists item_events_item_idx on item_events(item_id, at);

-- Single-row settings (replaces the per-user profiles table). list_order is JSON text.
-- Kept for backup/import compatibility; column ORDER now lives in lists.position
-- (see the lists table below). On first open of a pre-columns board, ensureLists()
-- reads list_order once to preserve the owner's saved column order.
create table if not exists profiles (
  id         text primary key,
  list_order text,
  updated_at text
);

-- Board columns ("lists"), user-created since 2026-07-07. Before this they were a
-- hardcoded const (lib/lists.ts DEFAULT_LISTS); those five are now seeded per board
-- on first render (ensureLists in lib/columns.ts), keeping their original ids so
-- existing items.list values still resolve. Ordered by position (real, same
-- fractional-insert trick as items). Soft-deleted (archived=1) rather than removed,
-- so a since-deleted column's label still resolves in history/archive/time-travel.
-- No triggers: columns are board STRUCTURE, not change-tracked content. Scoped like
-- items: user_id + user_id-IS guard in every query.
-- (id, user_id) is the key, not id alone: every account seeds the SAME default ids
-- ("today"…), so id is only unique WITHIN a user's board — exactly the scope items
-- reference it at (items.list + the user_id guard). Custom columns get a uuid id.
create table if not exists lists (
  id         text not null,
  user_id    text references users(id),
  label      text not null check (length(label) > 0),
  hint       text not null default '',
  position   real not null default 0,
  archived   integer not null default 0,
  created_at text not null default (${ISO_NOW}),
  primary key (id, user_id)
);

create index if not exists lists_user_idx on lists(user_id, archived, position);
`;

export const CREATE_TRIGGERS = `
-- On insert: record the birth of the item.
create trigger if not exists items_log_insert after insert on items
begin
  insert into item_events (item_id, type, field, old_value, new_value, at)
  values (new.id, 'created', 'text', null, new.text, ${ISO_NOW});
end;

-- Bump updated_at on any change. (recursive_triggers is OFF by default, so this
-- inner UPDATE does not re-fire the log triggers.)
create trigger if not exists items_touch_updated_at after update on items
begin
  update items set updated_at = ${ISO_NOW} where id = new.id;
end;

-- One trigger per change-tracked field, mirroring the old log_item_event() diff.
create trigger if not exists items_log_text after update of text on items
when new.text is not old.text
begin
  insert into item_events (item_id, type, field, old_value, new_value, at)
  values (new.id, 'edited', 'text', old.text, new.text, ${ISO_NOW});
end;

create trigger if not exists items_log_details after update of details on items
when new.details is not old.details
begin
  insert into item_events (item_id, type, field, old_value, new_value, at)
  values (new.id, 'edited', 'details', old.details, new.details, ${ISO_NOW});
end;

create trigger if not exists items_log_list after update of list on items
when new.list is not old.list
begin
  insert into item_events (item_id, type, field, old_value, new_value, at)
  values (new.id, 'moved', 'list', old.list, new.list, ${ISO_NOW});
end;

-- done/archived are stored 0/1 but logged as 'true'/'false' text, matching the
-- imported Postgres history (lib/timetravel.ts asBool() handles either form).
create trigger if not exists items_log_done after update of done on items
when new.done is not old.done
begin
  insert into item_events (item_id, type, field, old_value, new_value, at)
  values (
    new.id,
    case when new.done = 1 then 'completed' else 'reopened' end,
    'done',
    case when old.done = 1 then 'true' else 'false' end,
    case when new.done = 1 then 'true' else 'false' end,
    ${ISO_NOW}
  );
end;

-- Daily-task check-offs (completed_on holds the local YYYY-MM-DD it was last
-- checked). Logging them makes per-day completions part of history: streaks are
-- computed from these events, and the time machine can revert them. Uncheck
-- writes null. New trigger names are picked up by existing DBs on next open
-- (openAt runs CREATE_TRIGGERS idempotently), so no migration step is needed —
-- but events only exist from the day this trigger lands.
create trigger if not exists items_log_completed_on after update of completed_on on items
when new.completed_on is not old.completed_on
begin
  insert into item_events (item_id, type, field, old_value, new_value, at)
  values (
    new.id,
    case when new.completed_on is not null then 'completed' else 'reopened' end,
    'completed_on',
    old.completed_on,
    new.completed_on,
    ${ISO_NOW}
  );
end;

create trigger if not exists items_log_archived after update of archived on items
when new.archived is not old.archived and new.archived = 1
begin
  insert into item_events (item_id, type, field, old_value, new_value, at)
  values (new.id, 'archived', 'archived', 'false', 'true', ${ISO_NOW});
end;

-- Restore (archived 1 -> 0). Logged so un-archiving is part of history too, like
-- every other change. A separate trigger (not a widened items_log_archived) so
-- existing DBs pick it up on next open — 'create trigger if not exists' won't
-- replace an already-created trigger, but a NEW name is applied idempotently.
-- field='archived' keeps time-travel reconstruction correct (it reverts by field
-- + old_value, type-agnostic — see lib/timetravel.ts).
create trigger if not exists items_log_unarchived after update of archived on items
when new.archived is not old.archived and new.archived = 0
begin
  insert into item_events (item_id, type, field, old_value, new_value, at)
  values (new.id, 'reopened', 'archived', 'true', 'false', ${ISO_NOW});
end;
`;

// Additive migration for DBs created before multiple-accounts v1: `create table
// if not exists` can't add a column to an existing table, and ALTER TABLE isn't
// idempotent, so check pragma table_info first. The index lives here (not in
// CREATE_TABLES) because on an old DB it would reference a column that doesn't
// exist yet when CREATE_TABLES runs. Run after CREATE_TABLES, before triggers.
export function migrateDb(db: Database.Database) {
  const cols = db.pragma("table_info(items)") as { name: string }[];
  if (!cols.some((c) => c.name === "user_id")) {
    // Allowed on a populated table because the default is NULL (a SQLite
    // requirement for ADD COLUMN ... REFERENCES with foreign_keys on).
    db.exec("alter table items add column user_id text references users(id)");
  }
  db.exec("create index if not exists items_user_idx on items(user_id, list, archived)");
}
