-- Card ordering: give every item a sortable position (epoch-ms), backfill existing.
alter table public.items
  alter column position set default (extract(epoch from now()) * 1000);

update public.items
  set position = extract(epoch from created_at) * 1000
  where position = 0;

-- Per-user preferences — currently just the column (list) order of the board.
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  list_order jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_owner_select" on public.profiles;
drop policy if exists "profiles_owner_insert" on public.profiles;
drop policy if exists "profiles_owner_update" on public.profiles;

create policy "profiles_owner_select" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_owner_insert" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_owner_update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
