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

export const ISO_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

export const CREATE_TABLES = `
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
  field      text,            -- text | details | list | done | archived
  old_value  text,
  new_value  text,
  at         text not null default (${ISO_NOW})
);

create index if not exists item_events_item_idx on item_events(item_id, at);

-- Single-row settings (replaces the per-user profiles table). list_order is JSON text.
create table if not exists profiles (
  id         text primary key,
  list_order text,
  updated_at text
);
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

create trigger if not exists items_log_archived after update of archived on items
when new.archived is not old.archived and new.archived = 1
begin
  insert into item_events (item_id, type, field, old_value, new_value, at)
  values (new.id, 'archived', 'archived', 'false', 'true', ${ISO_NOW});
end;
`;
