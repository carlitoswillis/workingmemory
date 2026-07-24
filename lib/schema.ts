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

-- Boards (shared boards v1, 2026-07-07). A board is now a first-class thing:
-- rows are scoped to a board_id, not a user_id. Every account gets a personal
-- board (bootstrap in lib/db.ts); more can be created + shared. Only the main
-- hosted DB has rows here — local/demo files leave boards empty and scope by
-- board_id null (the same NULL trick user_id used).
create table if not exists boards (
  id         text primary key,
  name       text not null check (length(name) > 0),
  created_by text not null references users(id),
  created_at text not null default (${ISO_NOW})
);

-- Membership junction (many-to-many users<->boards). primary key gives "one
-- membership per (board, user)" for free. role: 'owner' | 'member'.
create table if not exists board_members (
  board_id  text not null references boards(id) on delete cascade,
  user_id   text not null references users(id) on delete cascade,
  role      text not null default 'member',
  joined_at text not null default (${ISO_NOW}),
  primary key (board_id, user_id)
);

create index if not exists board_members_user_idx on board_members(user_id);

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
  user_id      text references users(id),          -- CREATOR now (scope is board_id)
  board_id     text references boards(id),          -- the scope; null on local/demo
  touched_by   text references users(id),           -- last actor; triggers copy to actor_id
  created_at   text not null default (${ISO_NOW}),
  updated_at   text not null default (${ISO_NOW})
);

create index if not exists items_parent_id_idx on items(parent_id);
create index if not exists items_list_idx on items(list, archived);
-- board_id/user_id indexes live in migrateDb: on an upgrading DB those columns
-- don't exist yet when CREATE_TABLES runs (they're added by migrateDb after).

-- Append-only history log. Never updated or deleted in normal use.
create table if not exists item_events (
  id         integer primary key autoincrement,
  item_id    text not null references items(id) on delete cascade,
  type       text not null,   -- created | edited | moved | completed | reopened | archived
  field      text,            -- text | details | list | done | archived | completed_on
  old_value  text,
  new_value  text,
  actor_id   text references users(id),   -- who did it (copied from items.touched_by); null pre-shared-boards
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

-- Board columns ("lists"), user-created. Seeded per board on first render
-- (ensureLists in lib/columns.ts), keeping the DEFAULT_LISTS ids ("today"…) so
-- existing items.list values still resolve. Ordered by position (real, same
-- fractional-insert trick as items). Soft-deleted (archived=1) rather than removed,
-- so a since-deleted column's label still resolves in history/archive/time-travel.
-- No triggers: columns are board STRUCTURE, not change-tracked content.
-- (id, board_id) is the key, not id alone: every board seeds the SAME default ids,
-- so id is only unique WITHIN a board — exactly the scope items reference it at
-- (items.list + the board_id guard). Custom columns get a uuid id. Was (id,user_id)
-- when it first shipped 2026-07-07; migrateDb + bootstrap re-key it to board scope.
create table if not exists lists (
  id         text not null,
  board_id   text references boards(id),
  label      text not null check (length(label) > 0),
  hint       text not null default '',
  position   real not null default 0,
  archived   integer not null default 0,
  created_at text not null default (${ISO_NOW}),
  primary key (id, board_id)
);
`;

// The logging triggers are VERSIONED (_v2 since shared boards, 2026-07-07): they now
// copy items.touched_by into item_events.actor_id ("who did it"). Because
// 'create trigger if not exists' NEVER replaces an existing trigger, a body change
// is invisible to already-created DBs — so we DROP the v1 names first, then create
// the _v2 triggers. Drop-then-create is still idempotent (converges to the same
// state) and self-migrates any pre-shared-boards file on next open. Adding the actor
// as a plain _v2 alongside v1 would double-log every change, hence the drops.
export const CREATE_TRIGGERS = `
drop trigger if exists items_log_insert;
drop trigger if exists items_log_text;
drop trigger if exists items_log_details;
drop trigger if exists items_log_list;
drop trigger if exists items_log_done;
drop trigger if exists items_log_completed_on;
drop trigger if exists items_log_archived;
drop trigger if exists items_log_unarchived;

-- On insert: record the birth of the item.
create trigger if not exists items_log_insert_v2 after insert on items
begin
  insert into item_events (item_id, type, field, old_value, new_value, actor_id, at)
  values (new.id, 'created', 'text', null, new.text, new.touched_by, ${ISO_NOW});
end;

-- Bump updated_at on any change. (recursive_triggers is OFF by default, so this
-- inner UPDATE does not re-fire the log triggers.) Unchanged across versions.
create trigger if not exists items_touch_updated_at after update on items
begin
  update items set updated_at = ${ISO_NOW} where id = new.id;
end;

-- One trigger per change-tracked field, mirroring the old log_item_event() diff.
create trigger if not exists items_log_text_v2 after update of text on items
when new.text is not old.text
begin
  insert into item_events (item_id, type, field, old_value, new_value, actor_id, at)
  values (new.id, 'edited', 'text', old.text, new.text, new.touched_by, ${ISO_NOW});
end;

create trigger if not exists items_log_details_v2 after update of details on items
when new.details is not old.details
begin
  insert into item_events (item_id, type, field, old_value, new_value, actor_id, at)
  values (new.id, 'edited', 'details', old.details, new.details, new.touched_by, ${ISO_NOW});
end;

create trigger if not exists items_log_list_v2 after update of list on items
when new.list is not old.list
begin
  insert into item_events (item_id, type, field, old_value, new_value, actor_id, at)
  values (new.id, 'moved', 'list', old.list, new.list, new.touched_by, ${ISO_NOW});
end;

-- Nesting: a card moved into another card (or back out to the board) changes
-- parent_id. Logged like a list move — type 'moved', field 'parent', values are item
-- ids (null = the board itself) — so the time machine can put a card back where it
-- structurally was (lib/timetravel.ts reverts on old_value) and the card's own history
-- reads "Nested under …" / "Moved out of …". Added 2026-07-23 with move-into-cards;
-- a NEW trigger name, so create-if-not-exists picks it up on every existing DB, no drop.
create trigger if not exists items_log_parent_v2 after update of parent_id on items
when new.parent_id is not old.parent_id
begin
  insert into item_events (item_id, type, field, old_value, new_value, actor_id, at)
  values (new.id, 'moved', 'parent', old.parent_id, new.parent_id, new.touched_by, ${ISO_NOW});
end;

-- done/archived are stored 0/1 but logged as 'true'/'false' text, matching the
-- imported Postgres history (lib/timetravel.ts asBool() handles either form).
create trigger if not exists items_log_done_v2 after update of done on items
when new.done is not old.done
begin
  insert into item_events (item_id, type, field, old_value, new_value, actor_id, at)
  values (
    new.id,
    case when new.done = 1 then 'completed' else 'reopened' end,
    'done',
    case when old.done = 1 then 'true' else 'false' end,
    case when new.done = 1 then 'true' else 'false' end,
    new.touched_by,
    ${ISO_NOW}
  );
end;

-- Daily-task check-offs (completed_on holds the local YYYY-MM-DD it was last
-- checked). Logging them makes per-day completions part of history: streaks are
-- computed from these events, and the time machine can revert them. Uncheck
-- writes null.
create trigger if not exists items_log_completed_on_v2 after update of completed_on on items
when new.completed_on is not old.completed_on
begin
  insert into item_events (item_id, type, field, old_value, new_value, actor_id, at)
  values (
    new.id,
    case when new.completed_on is not null then 'completed' else 'reopened' end,
    'completed_on',
    old.completed_on,
    new.completed_on,
    new.touched_by,
    ${ISO_NOW}
  );
end;

create trigger if not exists items_log_archived_v2 after update of archived on items
when new.archived is not old.archived and new.archived = 1
begin
  insert into item_events (item_id, type, field, old_value, new_value, actor_id, at)
  values (new.id, 'archived', 'archived', 'false', 'true', new.touched_by, ${ISO_NOW});
end;

-- Restore (archived 1 -> 0). field='archived' keeps time-travel reconstruction
-- correct (it reverts by field + old_value, type-agnostic — see lib/timetravel.ts).
create trigger if not exists items_log_unarchived_v2 after update of archived on items
when new.archived is not old.archived and new.archived = 0
begin
  insert into item_events (item_id, type, field, old_value, new_value, actor_id, at)
  values (new.id, 'reopened', 'archived', 'true', 'false', new.touched_by, ${ISO_NOW});
end;
`;

// Additive migration for DBs created before a schema addition: `create table if not
// exists` can't add a column to an existing table, and ALTER TABLE isn't idempotent,
// so check pragma table_info first. Every ADD COLUMN defaults to NULL (a SQLite
// requirement for ADD COLUMN ... REFERENCES with foreign_keys on) and every step is
// keyed on "the column/shape is missing," so re-running is a no-op. Run after
// CREATE_TABLES, before bootstrap + triggers.
export function migrateDb(db: Database.Database) {
  const hasCol = (table: string, name: string) =>
    (db.pragma(`table_info(${table})`) as { name: string }[]).some((c) => c.name === name);

  // multiple-accounts v1
  if (!hasCol("items", "user_id")) {
    db.exec("alter table items add column user_id text references users(id)");
  }
  db.exec("create index if not exists items_user_idx on items(user_id, list, archived)");

  // shared boards v1 (2026-07-07): board scope + actor attribution.
  if (!hasCol("items", "board_id")) {
    db.exec("alter table items add column board_id text references boards(id)");
  }
  if (!hasCol("items", "touched_by")) {
    db.exec("alter table items add column touched_by text references users(id)");
  }
  db.exec("create index if not exists items_board_idx on items(board_id, archived)");
  if (!hasCol("item_events", "actor_id")) {
    db.exec("alter table item_events add column actor_id text references users(id)");
  }

  // The `lists` table shipped 2026-07-07 keyed (id, user_id); shared boards re-key it
  // to (id, board_id). SQLite can't ALTER a primary key, so rebuild: rename the old
  // table, create the board-scoped one, copy UNOWNED rows straight over (local/demo,
  // board_id null), and leave OWNED rows in lists_legacy for the bootstrap to re-home
  // onto each user's Personal board (§9). Skipped once `lists.board_id` exists.
  const listsTable = db.pragma("table_info(lists)") as { name: string }[];
  const listsNeedsRekey =
    listsTable.length > 0 &&
    listsTable.some((c) => c.name === "user_id") &&
    !listsTable.some((c) => c.name === "board_id");
  if (listsNeedsRekey) {
    db.exec(`
      alter table lists rename to lists_legacy;
      create table lists (
        id         text not null,
        board_id   text references boards(id),
        label      text not null check (length(label) > 0),
        hint       text not null default '',
        position   real not null default 0,
        archived   integer not null default 0,
        created_at text not null default (${ISO_NOW}),
        primary key (id, board_id)
      );
      create index if not exists lists_board_idx on lists(board_id, archived, position);
      insert into lists (id, board_id, label, hint, position, archived, created_at)
        select id, null, label, hint, position, archived, created_at
        from lists_legacy where user_id is null;
      delete from lists_legacy where user_id is null;
    `);
    const remaining = (
      db.prepare("select count(*) c from lists_legacy").get() as { c: number }
    ).c;
    if (remaining === 0) db.exec("drop table lists_legacy");
  }
  // Safe now that `lists` is guaranteed board-scoped (fresh table or just rebuilt).
  db.exec("create index if not exists lists_board_idx on lists(board_id, archived, position)");
}
