-- Add a free-form details/notes field per card, and track its edits in history.

alter table public.items add column if not exists details text not null default '';

-- Recreate the history trigger to also log details edits.
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

  if (new.details is distinct from old.details) then
    insert into public.item_events (item_id, user_id, type, field, old_value, new_value)
    values (new.id, new.user_id, 'edited', 'details', old.details, new.details);
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
