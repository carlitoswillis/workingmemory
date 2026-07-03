# Architecture

PURPOSE: Technical design and data flow of the Working Memory app.

> **⚠️ LOCAL-FIRST PIVOT (2026-06-27).** The app no longer uses Supabase, Auth, or RLS.
> Data lives in a local **SQLite** file (`/data/wm.db`) via `better-sqlite3`; it's
> single-user and offline. The Overview, "Auth & data access", and "Database" sections
> below have been updated. Any remaining mention of Supabase/RLS/`auth.uid()`/`supabase-js`
> elsewhere in this doc is **historical** — the design (trigger-driven history, append-only
> event log, pure time-travel reconstruction) is unchanged; only the storage engine moved.

## Overview
A single-user, local board web app. Next.js (App Router) serves the UI; a local **SQLite**
file (`better-sqlite3`) holds the data. History is written by **database triggers**
(`lib/schema.ts`), so every write records its own history automatically — the app does
plain CRUD. There is no auth and no network; it's your machine, your file.

Runs locally with `npm run dev`. Under git (`main`). The previous hosted-Supabase data was
exported + verified to `backups/<stamp>/` and re-imported into SQLite.

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

### 3. Data access (`lib/`) — no auth layer
- `lib/db.ts` — `getDb()` resolves the SQLite connection for the current request. With
  `DEMO_MODE` off (local use): the single file at `DATA_DIR/wm.db` (default `./data`),
  WAL + foreign keys on, schema applied idempotently, connection reused across dev
  hot-reloads via a global — same behavior as always. With `DEMO_MODE=1` (hosted demo):
  each visitor gets their own `DATA_DIR/demo/<uuid>.db` keyed by an httpOnly cookie
  (minted in `middleware.ts`), seeded on first open from `lib/demo/seed.ts` (rows
  inserted BEFORE triggers attach), TTL-swept after 24h idle (opportunistically, on
  new-board creation — no background process), LRU-capped open connections.
- `middleware.ts` — inert when `DEMO_MODE` is off. On: mints the `wm_visitor` cookie
  (also injected into the current request so the first render has its board) and
  token-bucket rate-limits POSTs per visitor. No SQLite here (edge runtime). Also
  owner-aware (Phase 1b): a valid `wm_owner` session (verified at the edge via
  `lib/auth-edge.ts`) bypasses the visitor cookie + demo write limits, and POST `/login`
  gets its own stricter per-IP bucket (burst 5).
- **Single-owner auth (`lib/auth.ts`, hosted only)** — one `OWNER_SECRET` env var; no
  user tables. Sessions are stateless HMAC tokens (`v1.<expiryMs>.<hmac>`, 90 days,
  constant-time compares everywhere; rotating the secret invalidates all sessions).
  `app/login/` sets/clears the httpOnly `wm_owner` cookie; `isOwnerRequest()` in
  `lib/db.ts` routes a valid session to the owner DB at `DATA_DIR/owner/wm.db` (which
  Litestream will replicate in Phase 2). `GET /api/export` (cookie or
  `Authorization: Bearer <OWNER_SECRET>`) streams a consistent `db.backup()` snapshot —
  never a raw copy of a live WAL-mode file. With `DEMO_MODE` off none of this runs.
- `lib/demo/seed.ts` — pure, deterministic seed generator: an authored SCRIPT of actions
  is replayed to produce item rows + ~3 weeks of event history that are consistent by
  construction (events emitted exactly as the triggers would write them). Tested by
  `lib/demo/seed.test.ts`. `lib/demo/limits.ts` — demo write caps used by actions.
- `lib/schema.ts` — `CREATE_TABLES` + `CREATE_TRIGGERS` (separate exports so the importer
  can load rows before triggers exist). The history triggers live here.
- `lib/queries.ts` — synchronous reads: `getItems` (by `position`; maps 0/1 → booleans via
  `rowToItem`), `getHistory`, `getBoardAt` (time-travel reconstruction), `getListOrder`
  (from the single `profiles` row).
- `app/actions.ts` — server actions (`"use server"`): plain CRUD via `better-sqlite3`
  prepared statements, then `revalidatePath("/")`. No auth gate, no event-logging in app
  code. Includes `addChildAction`, `reorderItemAction`, `saveListOrderAction`,
  `setRecurrenceAction`, `setDailyDoneAction`, plus add/edit/move/done/archive.
- `lib/lists.ts` — the columns (single source of truth) + `orderLists`. `lib/types.ts` —
  row shapes. `lib/timetravel.ts` — pure reconstruction. `lib/recurrence.ts` —
  `localToday` + `effectiveDone`.
- `scripts/import-backup.ts` — one-off: builds `/data/wm.db` from a `backups/<stamp>/`
  folder (tables → rows → triggers, in that order).

### 4. Database — local SQLite (`lib/schema.ts`)
Schema is code, applied on first connection (no migration runner). Tables: `items`,
`item_events` (append-only history), `profiles` (single `'local'` row holding `list_order`).
`items.parent_id` gives sub-cards (self-ref FK, `on delete cascade`). `done`/`archived` are
0/1 integers; timestamps are ISO-8601 text. The old `supabase/migrations/0001`–`0005` SQL
files remain only as a record of how the schema evolved.

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
