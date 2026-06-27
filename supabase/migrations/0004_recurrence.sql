-- Daily-refreshing tasks: a task can repeat 'daily'. It counts as done only if it
-- was completed on the current local date; at the day boundary that expires, so it
-- reappears unchecked. `completed_on` is the date it was last checked off.
alter table public.items add column if not exists recurrence text not null default 'none';
alter table public.items add column if not exists completed_on date;
