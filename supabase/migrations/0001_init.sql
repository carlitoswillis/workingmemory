-- Working Memory — per-user board with an append-only history log.
--
-- The key design choice: the time-travel history is written by DATABASE TRIGGERS,
-- not application code. So every client (this web app, future mobile apps, any
-- direct API call) records history automatically and can never forget to.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text       text not null check (length(text) > 0),
  list       text not null,
  done       boolean not null default false,
  position   double precision not null default 0,
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists items_user_idx on public.items (user_id, list, archived);

-- Append-only event log. Never updated or deleted in normal use.
create table if not exists public.item_events (
  id        bigint generated always as identity primary key,
  item_id   uuid not null references public.items(id) on delete cascade,
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type      text not null,   -- created | edited | moved | completed | reopened | archived
  field     text,            -- text | list | done | archived
  old_value text,
  new_value text,
  at        timestamptz not null default now()
);

create index if not exists item_events_item_idx on public.item_events (item_id, at);

-- ---------------------------------------------------------------------------
-- Triggers: bump updated_at, and derive history events from what changed
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists items_touch_updated_at on public.items;
create trigger items_touch_updated_at
  before update on public.items
  for each row execute function public.touch_updated_at();

-- SECURITY DEFINER so the trigger can write item_events regardless of the
-- caller's RLS (clients never insert events directly).
create or replace function public.log_item_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.item_events (item_id, user_id, type, field, old_value, new_value)
    values (new.id, new.user_id, 'created', 'text', null, new.text);
    return new;
  end if;

  if (new.text is distinct from old.text) then
    insert into public.item_events (item_id, user_id, type, field, old_value, new_value)
    values (new.id, new.user_id, 'edited', 'text', old.text, new.text);
  end if;

  if (new.list is distinct from old.list) then
    insert into public.item_events (item_id, user_id, type, field, old_value, new_value)
    values (new.id, new.user_id, 'moved', 'list', old.list, new.list);
  end if;

  if (new.done is distinct from old.done) then
    insert into public.item_events (item_id, user_id, type, field, old_value, new_value)
    values (new.id, new.user_id,
            case when new.done then 'completed' else 'reopened' end,
            'done', old.done::text, new.done::text);
  end if;

  if (new.archived is distinct from old.archived and new.archived) then
    insert into public.item_events (item_id, user_id, type, field, old_value, new_value)
    values (new.id, new.user_id, 'archived', 'archived', old.archived::text, new.archived::text);
  end if;

  return new;
end;
$$;

drop trigger if exists items_log_insert on public.items;
create trigger items_log_insert
  after insert on public.items
  for each row execute function public.log_item_event();

drop trigger if exists items_log_update on public.items;
create trigger items_log_update
  after update on public.items
  for each row execute function public.log_item_event();

-- ---------------------------------------------------------------------------
-- Row-level security: every user only ever sees and touches their own rows
-- ---------------------------------------------------------------------------

alter table public.items enable row level security;
alter table public.item_events enable row level security;

drop policy if exists "items_owner_select" on public.items;
drop policy if exists "items_owner_insert" on public.items;
drop policy if exists "items_owner_update" on public.items;
drop policy if exists "items_owner_delete" on public.items;

create policy "items_owner_select" on public.items
  for select using (auth.uid() = user_id);
create policy "items_owner_insert" on public.items
  for insert with check (auth.uid() = user_id);
create policy "items_owner_update" on public.items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "items_owner_delete" on public.items
  for delete using (auth.uid() = user_id);

-- History is read-only to clients (inserts come from the SECURITY DEFINER trigger);
-- there is deliberately no update/delete policy, so the log is immutable.
drop policy if exists "item_events_owner_select" on public.item_events;
create policy "item_events_owner_select" on public.item_events
  for select using (auth.uid() = user_id);
