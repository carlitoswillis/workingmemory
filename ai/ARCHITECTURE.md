# Architecture

PURPOSE: Technical design and data flow of the Working Memory app.

## Overview
A multi-user board web app (mobile later). Next.js (App Router) serves the UI;
**Supabase** provides Postgres (data), Auth (accounts), and row-level security
(per-user isolation). History is written by **database triggers**, so every client —
this web app, future mobile, any direct API call — records it automatically. The same
`supabase-js` client will back the future mobile apps.

Currently runs locally (`npm run dev`) against a **hosted** Supabase project (the
owner's free tier). Not deployed; not yet under git.

## System Components

### 1. Pages & shell (`app/`)
- `app/page.tsx` — server component; requires a user, loads the board (`getItems`) and
  saved column order (`getListOrder`), applies `orderLists`, renders the header
  (wordmark + email + sign-out) and `<Board>`.
- `app/login/page.tsx` — client; email+password sign in / sign up via the browser client.
- `app/auth/signout/route.ts` — POST → `signOut()` → redirect `/login`.
- `app/layout.tsx` — loads Fraunces + Space Grotesk (next/font), sets CSS-var fonts.
- `app/globals.css` — the Nocturne theme (CSS variables, motion, card-action reveal).

### 2. Board & cards (`components/`)
- `Board.tsx` — client; owns: open-card panel state, time-machine state, and the
  **column order** (optimistic, persisted). Hosts the **board-level `DndContext`** for
  reordering columns (`rectSortingStrategy`). Renders `SortableColumn` per list.
- `Column.tsx` — one list: header (with a drag **grip** when sortable), add-input,
  open cards, and a collapsed "Done" group. Hosts its **own per-column `DndContext`**
  for reordering cards within the list (`verticalListSortingStrategy`). Splits
  open/done by `effectiveDone` (so daily tasks done *today* show as done).
- `SortableColumn.tsx` — wraps `Column` in `useSortable({data:{type:'column'}})`;
  passes drag listeners down as the header grip's `dragHandleProps`.
- `SortableItemCard.tsx` — wraps `ItemCard` in `useSortable({data:{type:'card'}})`;
  whole-card drag (a 6px activation distance keeps clicks working; inputs stop
  propagation).
- `ItemCard.tsx` — the thin resting row: recency-edge ▏ · checkbox · wrapping title
  (click → open panel) · ↻ if daily · dot if it has details. Optimistic done toggle
  (daily-aware).
- `CardPanel.tsx` — slide-over for one card: editable title + details, done toggle,
  move-to-list, **Repeat daily** toggle, archive, timestamps, and the history timeline.
  All editing happens here (cards are display-only) — which also keeps editing out of
  the draggable.
- `TimeMachineBar.tsx` — the 🕰 control; rewind to reconstruct the board as of a past time.

### 3. Auth & data access (`middleware.ts`, `lib/`)
- `middleware.ts` → `lib/supabase/middleware.ts` — refreshes the session every request,
  redirects unauthenticated users to `/login` (except `/login`, `/auth/*`).
- `lib/supabase/server.ts` / `client.ts` — per-request server client (session cookies)
  and the browser client.
- `lib/queries.ts` — reads: `getItems` (by `position`), `getHistory`, `getBoardAt`
  (time-travel reconstruction), `getListOrder` (from `profiles`).
- `app/actions.ts` — server actions (`"use server"`): each calls `requireUser()`, runs
  plain CRUD on the authed client, `revalidatePath("/")`. No event-logging in app code.
  Includes `reorderItemAction`, `saveListOrderAction`, `setRecurrenceAction`,
  `setDailyDoneAction`, plus add/edit/move/done/archive.
- `lib/lists.ts` — the columns (single source of truth) + `orderLists`. `lib/types.ts` —
  DB row shapes. `lib/timetravel.ts` — pure reconstruction. `lib/recurrence.ts` —
  `localToday` + `effectiveDone`.

### 4. Database (`supabase/migrations/`)
- `0001_init.sql` — `items`, `item_events`, triggers, RLS.
- `0002_card_details.sql` — `details` column; trigger logs detail edits.
- `0003_ordering.sql` — `position` default + backfill; **`profiles`** table (per-user
  column order) + RLS.
- `0004_recurrence.sql` — `recurrence` + `completed_on` columns.

## Data Model — append-only, enforced in the database

```
items                              item_events  (the time-travel log)
  id          uuid                   id        bigint identity
  user_id     uuid (auth.users)      item_id   -> items.id (CASCADE)
  text                               user_id   uuid (auth.users)
  details     text                   type      created|edited|moved|completed|reopened|archived
  list        (today|focus|…)        field     text|details|list|done|archived
  done        boolean                old_value
  recurrence  'none'|'daily'         new_value
  completed_on date (daily)          at        timestamptz
  position    double precision
  archived    boolean              profiles
  created_at / updated_at            id uuid (auth.users)  ·  list_order jsonb  ·  updated_at
```

**Why history lives in Postgres, not app code:** `log_item_event()` is an AFTER
INSERT/UPDATE trigger on `items`. On insert → a `created` event; on update → it diffs
OLD vs NEW and appends one event per changed field. `SECURITY DEFINER` lets it write
the otherwise read-only event log. So any client gets history for free and can't forget.
(`completed_on` changes are NOT yet logged — that's the streaks backlog item.)

**Time travel:** `reconstructItemAt` takes an item's CURRENT values and reverts every
event after time T (each event carries the old value) → the state at T. `getBoardAt`
runs it over all the user's items+events through the authed client, so it's **per-user
by construction** (RLS), same as the live board.

**Row-level security:** `items`, `item_events`, and `profiles` all have
`auth.uid() = user_id/id` policies — isolation is enforced by the DB, not trusted to app
code. `user_id` defaults to `auth.uid()` on insert.

## Ordering & recurrence
- **Card order**: `position` (epoch-ms, distinct per item). Reorder computes a midpoint
  between neighbors and writes it (`reorderItemAction`). No event logged for position.
- **Column order**: `profiles.list_order` (jsonb array of list ids), upserted per user
  (`saveListOrderAction`); `orderLists` applies it, appending any unknown/new lists.
- **Daily tasks**: a daily item is "done" iff `completed_on == today` (local). Toggling
  sets/clears `completed_on` (`setDailyDoneAction`); at the day boundary it simply
  expires — no destructive write, no cron. `effectiveDone` drives display + open/done
  split. `today` is computed client-side (local midnight is the boundary).

## Design system — "Nocturne" (de-glowed)
Dusk-indigo palette via CSS vars in `globals.css` (`--bg-0/1`, `--surface`, `--veil`,
`--now` warm amber = attention, `--past` cool = history, `--done`). **Matte, no glow**
(owner preference). Fraunces (display + italic notes) + Space Grotesk (UI). Signature:
each card's left edge warms with recency (`updated_at`). Motion is gentle (card-in rise,
check pop); `prefers-reduced-motion` respected. Card actions reveal on hover only on
hover-capable devices (`@media (hover:hover)`), always visible on touch.

## Data Flow
User action → client component → server action (`requireUser` + Supabase CRUD) →
**DB trigger appends event(s)** → `revalidatePath("/")` → server re-renders the board.
Drag/edit interactions are optimistic locally, then reconciled by the revalidate.

## Conventions & gotchas
- Migrations are applied to the hosted DB directly via `psql` (Supabase CLI/local Docker
  abandoned). `.env.local` holds the hosted project URL + publishable key.
- If dev 404s everything or won't start: stale `.next` cache → `rm -rf .next && npm run dev`.
- dnd-kit + draggable inputs: stop pointer/keydown propagation on inputs so the keyboard
  sensor doesn't hijack Enter (root-fixed by moving editing into `CardPanel`).
- Drag behavior is NOT auto-testable here (no browser) — verify on the owner's machine.

## AI Workspace Substrate
This repo carries the `/ai` cognition layer — state in `PROJECT_STATE.md`, agent
constraints in `AGENTS.md`. Flow: Human Pilot → AI Implementation → run the app.
