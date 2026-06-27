-- Cards within cards: any item can hold child items (sub-cards). A child is a
-- real `items` row with `parent_id` pointing at its parent, so it inherits the
-- whole machinery for free — history (triggers), per-user isolation (RLS),
-- recurrence, the done toggle, and the detail panel.
--
-- Nesting is arbitrarily deep. Cycles can't form because children are only ever
-- created *under* an existing parent (there is no re-parenting), so parent_id
-- always points at an older row.
--
-- `on delete cascade`: hard-deleting a card removes its whole subtree. (The app
-- archives rather than deletes, so this is just a safety net.)
alter table public.items
  add column if not exists parent_id uuid
    references public.items(id) on delete cascade default null;

create index if not exists items_parent_id_idx on public.items (parent_id);
