# Project State

_Last updated: 2026-06-27_

## Product Vision
A "working memory" web app (→ mobile later) — systematize the running note of what's
currently on your mind and what previously was. A board of lists (Today, Focus,
Waiting/Later, Backlog, Brain Dump) where **every item's changes are tracked**, so
you can time-travel through its history.

**Decided it's a product for real users** (2026-06-26), not just a personal tool.
The wedge vs. Trello/Notion/Linear is the part they DON'T do: a queryable,
append-only history of your attention ("what was on my mind 3 weeks ago / what's
been stuck in Waiting"), and eventually **AI over that event stream** (a weekly
review that writes itself). Explicitly NOT trying to out-Trello Trello.

Notion-on-top was considered and rejected: its API doesn't expose page history (the
core feature), it'd be more moving parts not fewer, and it blocks the multi-user
product path. Staying free is satisfied by Supabase + Vercel free tiers.

Origin: the owner keeps an ongoing freeform note (today's priorities, waiting/later,
brain dump, recurring daily/weekly checklists, life areas). This app gives that mess
a real structure without losing its looseness.

## Current Focus
- **LOCAL-FIRST as of 2026-06-27**: pivoted OFF hosted Supabase to a local **SQLite** file
  (`/data/wm.db`, gitignored) — single-user, offline, no auth. Owner wanted their data on
  their own machine. Runs with `npm run dev`. History is still trigger-driven (now SQLite
  triggers in `lib/schema.ts`); time-travel unchanged. This reverses the 2026-06-26
  "product for real users / multi-user" framing — back to a personal tool (multi-user +
  mobile/RLS are deferred, see Product Vision note).
- The hosted Supabase data was fully exported + verified first (`backups/<stamp>/`,
  items=24 / item_events=52 / profiles=1) and re-imported into SQLite. Nothing lost.
- Under **git** (`main`); **committing as we go** (AGENTS.md). The local pivot is built +
  self-verified but **not yet committed** — awaiting owner test.

## Active Tasks
- (nothing in progress — local pivot built 2026-06-27, awaiting owner test before commit)

## Backlog
- [ ] **Multi-select drag** (owner request, 2026-06-26): select multiple cards and drag
      them together into another list / position. Proposed gesture (confirm before
      building): ⌘/Ctrl-click toggles a card into the selection, shift-click selects a
      range, plain click still opens the panel, dragging a selected card moves the whole
      set. dnd-kit has no built-in multi-drag — track a selected-id set, show a count badge
      in the `DragOverlay`, and on drop move ALL selected (new list + spaced positions).
      Not auto-testable here.
- [ ] **Streaks for daily tasks**: "done N days running" + which days, surfaced from the
      event log. (Daily reset shipped; streak display deferred. To record per-day
      completions in history, add `completed_on` to the `log_item_event` trigger.)
- [ ] **AI integration** (the real differentiator — point an LLM at the event stream):
      weekly review that writes itself; auto-triage of brain-dumps; "ask your history".
      Anthropic API (latest Claude). `item_events` is the substrate and the moat.
- [ ] **Fuller optimistic UI**: add + cross-list move still round-trip the server; lift
      to `useOptimistic` for instant feedback everywhere (done/text/details already are).
- [ ] **Richer details**: markdown rendering / checklists / links in the per-card details
      (today it's plain text, already change-tracked + time-traveled).
- [ ] **Deploy**: Vercel (free Hobby) against the hosted Supabase project.
- [ ] **Mobile apps** (React Native / Expo) — reuse the same `supabase-js` client + RLS.
- [ ] **Weekly-reset + weekday-specific recurring tasks** (e.g. the note's "Wednesdays:
      no car, do laundry"). Lower priority than the daily reset that already shipped.
- [ ] **Life-area tags** (Maintenance / Health / Career / Recreation) as a cross-cutting
      filter over items.
- [ ] **Archive view** — browse / restore archived items (archiving keeps full history;
      no UI to see them yet).
- [ ] Quick-capture: a keyboard-first "dump to Brain Dump" always in reach.
- [ ] Search across items + their history.
- [ ] Optional **Notion sync/export** for power users — your DB stays the source of
      truth; Notion is just a mirror. (A feature, never the backend.)
- [ ] Decide standalone vs. folding into AIA2ndBrain (kept standalone — the change-
      tracked board is a distinct product from the PARA note-filer).

### Someday / maybe (bottom-of-pile, low priority)
- [ ] **Re-introduce multi-user + auth** (reverses the 2026-06-27 local pivot; "someday
      maybe" vibes — only if this becomes a shared product). Sketch of what it would take:
      - **Storage**: SQLite is single-file/single-user. Going multi-user means a real
        server DB again — most likely back to **Postgres** (self-hosted or Supabase). The
        schema + triggers in `lib/schema.ts` port back to Postgres (that's where they came
        from); keep them DB-side so history stays automatic.
      - **Per-user isolation**: re-add a `user_id` on every row and **row-level security**
        (or app-level scoping if not on Postgres/Supabase). We deliberately dropped both;
        they'd come back together.
      - **Auth**: re-add a login gate (Supabase Auth, or another provider) + session
        middleware + `requireUser()` in actions + login/sign-out UI. All of that was
        removed — git history (the local-pivot commit) is the reference for what to restore.
      - **Sync/offline**: decide whether local-first stays (local SQLite as a cache that
        syncs to the server) or we go server-only. Local-first + sync is the hard part.
      - **Data**: migrate each user's local `wm.db` up into the shared DB on first login.
      - Reuses the original 2026-06-26 multi-user thinking (Supabase + RLS + mobile via the
        same client) — see the Product Vision note. This is the inverse of the work logged
        in Completed ("Local-first pivot"), so that commit is the cleanest undo reference.

## Completed
- [x] **Local-first pivot: SQLite + no auth** (2026-06-27). Moved the entire data layer
      off hosted Supabase onto a local **better-sqlite3** file (`/data/wm.db`). New
      `lib/schema.ts` (tables + ported history triggers, exported separately so imports
      don't fire them) + `lib/db.ts` (singleton connection, WAL, FKs on). Rewrote
      `lib/queries.ts` + `app/actions.ts` onto SQLite (booleans ↔ 0/1, `randomUUID` ids).
      Deleted all of Supabase/auth: `middleware.ts`, `lib/supabase/`, `app/login`,
      `app/auth`, sign-out form; dropped `@supabase/*`, added `better-sqlite3` +
      `serverComponentsExternalPackages`. Dropped `user_id` from types; `profiles` →
      single `'local'` row. Existing data exported, verified, and re-imported via
      `scripts/import-backup.ts` (items=24 / item_events=52 / profiles=1, history intact).
      Verified: tsc, `node lib/timetravel.test.ts`, trigger smoke-test (all 7 event types),
      `npm run build`, and a live `npm run dev` 200 rendering real imported cards.
- [x] **Cards within cards (sub-cards)** (2026-06-27): a child is a real item with a
      `parent_id` FK (inherits history, recurrence, done, panel). Arbitrary depth (no
      re-parenting ⇒ no cycles). Managed in CardPanel ("Sub-cards": add-input + child rows
      that open their own panel, ↰ back-link); board cards show a `↳ done/total` badge;
      board + time-machine snapshot filter to `parent_id IS NULL`. Gaps: siblings not
      drag-reorderable; archiving a parent leaves children hidden (not cascade-archived);
      `parent_id` not history-logged. (Originally `0005_subcards.sql` on Postgres; the
      column is now part of the SQLite schema in `lib/schema.ts`.)
- [x] Scaffold: Next.js App Router + TS + Tailwind. (Briefly tried local SQLite —
      `node:sqlite`/better-sqlite3 — then pivoted to multi-user, then back to local 2026-06-27.)
- [x] **Schema + triggers + RLS** (`0001_init.sql`): `items` + `item_events`; history
      written by Postgres triggers (`log_item_event`, `SECURITY DEFINER`); `updated_at`
      touch trigger; row-level security so each user only sees their own rows; the events
      table is immutable to clients (SELECT-only policy).
- [x] **Auth**: `@supabase/ssr` server + browser clients; session-refresh middleware
      gating the app behind `/login`; email+password login/signup; sign-out route.
- [x] Data layer on the authed Supabase client (`lib/queries.ts`, `app/actions.ts`) —
      CRUD only; triggers handle history, RLS handles isolation.
- [x] **Hosted Supabase + migrations via psql**: owner created the free project; local
      Docker was abandoned after it filled the disk. Migrations 0001–0004 applied with
      `psql` directly against the hosted DB.
- [x] **Global time-travel** (`🕰 Time machine`): pick a past date/time → the whole board
      is reconstructed read-only as of then by reverting post-T events. Per-user via RLS.
      Pure `lib/timetravel.ts` (`reconstructBoardAt`/`reconstructItemAt`) + unit tests
      (`lib/timetravel.test.ts`, run with `node`). Time-travel mode cools/desaturates.
- [x] **Per-card details/notes** (`0002`): `details` column; change-tracked (trigger
      field `details`) and time-traveled.
- [x] **Card detail side panel** (`CardPanel`): click a card → slide-over with editable
      title + details, done toggle, move-to-list, archive, timestamps, and the full
      history timeline. Replaced inline editors and the old `HistoryPanel`. Also fixed
      the "Enter fades the card" dnd bug by moving editing OUT of the draggable.
- [x] **Drag-and-drop (dnd-kit)**: reorder cards within a list (`SortableItemCard`,
      per-column `DndContext`) and reorder columns (`SortableColumn`, board-level, grip on
      the header). Column order persisted per-user in a new **`profiles` table** (RLS);
      card order via a `position` column (`0003`, epoch-ms, backfilled).
- [x] **Cross-list drag** (drag a card between columns): unified all cards under one
      board-level `DndContext`; `onDragOver` moves a card between per-list arrays mid-drag
      (a ref avoids stale state), `onDragEnd` persists new `list` + `position`; a
      `DragOverlay` shows the floating preview. Column vs. card drag branch on
      `active.data.type`. Owner-tested working.
- [x] **Daily-refreshing tasks** (`0004`): `recurrence` + `completed_on`; a daily task is
      "done" only if checked off today, so it resets at local midnight with no destructive
      writes. `lib/recurrence.ts` (`localToday`, `effectiveDone`); ↻ badge on cards;
      "Repeat daily" toggle in the panel.
- [x] **"Nocturne" visual identity, then de-glowed**: dusk-indigo palette, Fraunces +
      Space Grotesk, recency-tracking left edge, time-machine cools the board. De-glowed
      to matte per owner taste.
- [x] **Thin card redesign + title wrap**: cards are a single low-key row (recency edge ·
      checkbox · wrapping title · ↻/notes dot); editing/actions live in the panel.
- [x] **Optimistic interactions**: done-toggle, text, details update instantly.
- [x] `ai/` docs + README (this pass).
