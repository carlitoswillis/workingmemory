# Agent Guidelines (AGENTS.md)

PURPOSE: The authoritative rulebook for AI assistants working on Working Memory.

## Project Context
- **Objective**: A single-user, local "working memory" board web app where every change is
  tracked so you can time-travel the board. Personal tool; the value is a queryable,
  append-only history of your attention + (later) AI over it. See `PROJECT_STATE.md`.
- **Stack** (LOCAL-FIRST as of 2026-06-27): Next.js (App Router) + React 18 + TS + Tailwind;
  **better-sqlite3** local file at `/data/wm.db`; @dnd-kit. No auth, no network, no Supabase
  — it was removed when the data moved local (see PROJECT_STATE "Local-first pivot"). The
  old hosted Supabase data was exported to `backups/<stamp>/` and re-imported.

## Version control — COMMIT AS YOU GO (adopted 2026-06-26)
- **Commit each logical change as you finish it.** Don't let a large uncommitted diff pile
  up. One coherent change = one commit (e.g. "add cross-list drag", "fix Enter bug").
- Write clear, present-tense messages describing the *what/why*. End commit messages with
  the Co-Authored-By trailer.
- **Stay on `main`** (owner's convention for this solo repo) unless asked otherwise.
- **Commit only when the owner approves a change** — typically after they've tested it.
  Don't commit work the owner is still evaluating.
- Do not commit build artifacts (`.next/`, `tsconfig.tsbuildinfo`) — keep them gitignored.
- Never `git push` or open PRs unless explicitly asked.

## Architecture Constraints
- **History is DB-driven**: never log events in app code — **SQLite triggers** in
  `lib/schema.ts` write `item_events` on insert/update. App actions do plain CRUD.
- **Boards are the scope** — shared boards v1, 2026-07-07 (supersedes the user_id scoping
  of multiple-accounts v1): on the hosted instance (`DEMO_MODE=1`) all accounts share ONE
  multi-tenant SQLite file (`DATA_DIR/owner/wm.db` — legacy path, read it as "main.db")
  with **app-level scoping by `board_id`**: `board_id IS ?` in EVERY read and
  `and board_id is ?` on EVERY mutation (no RLS — the guard is the query shape; never
  write a query without it). Membership is verified ONCE per request in
  `getBoardContext(boardId)` (a 404, not 403, for a non-member), so downstream queries
  trust a plain `board_id = ?`. `items.user_id` now means CREATOR; `items.touched_by` is
  the last actor, copied by the v2 triggers into `item_events.actor_id` ("who did it").
  Every mutation stamps `touched_by`. Actions take an explicit `boardId` arg (the client
  provides it via `useBoardId()`); this is IDOR-safe — knowing a card id can't mutate it
  from another board. Local mode (flag off) + demo stay auth-free, boardId null, IS null
  matches the whole file. Sessions are stateless HMAC cookies (`wm_session`,
  `SESSION_SECRET`); `OWNER_SECRET` is the ops bearer for /api/export|import. `item_events`
  scopes through its items join (events carry no board_id). Boards + membership:
  `lib/boards.ts`; every account gets a "Personal" board (signup + idempotent bootstrap).
- **Schema**: defined in `lib/schema.ts` (`CREATE_TABLES` + `CREATE_TRIGGERS`, kept separate
  so the importer can load data before triggers exist). `lib/db.ts` applies it idempotently
  on first connection — no migration runner. (The Postgres-era `supabase/migrations/`
  dir was deleted 2026-07-03; git history keeps it.)
- **booleans ↔ 0/1**: SQLite stores `done`/`archived` as integers; `lib/queries.ts` maps
  rows to the boolean `Item` shape. Bind `done ? 1 : 0` in writes (better-sqlite3 rejects JS
  booleans).
- **Cards nest** (since 2026-07-23): `items.parent_id` was write-once (sub-cards were
  born inside a parent); re-parenting lives in `lib/nesting.ts` — it refuses loops (walk
  the parent chain), the note, archived parents, and other boards' ids, and a nested
  card inherits its parent's list. `items_log_parent_v2` logs it (`moved`/`parent`,
  values are item ids) so time-travel reconstructs past structure — never log it in app
  code. Sub-cards still never render as board cards.
- **Repeating cards are derived, not scheduled** (weekly added 2026-07-23):
  `recurrence` is `none | daily | weekly:<0-6>` and done-ness comes from whether
  `completed_on` falls in the current period (`lib/recurrence.ts#effectiveDone`). No
  midnight job, and the same function answers "was it done at time T". Never store a
  reset.
- **Columns are user data** (since 2026-07-07): a `lists` table keyed by `(id,
  user_id)`, CRUD in `lib/columns.ts`, seeded per board on first render from
  `DEFAULT_LISTS` (`lib/lists.ts`) with their stable ids (`today`…`braindump`) so
  existing `items.list` values resolve. Delete is a soft-delete (`archived=1`) and is
  refused while a column holds a visible card or is the last one — so time-travel /
  history labels survive and no card is ever orphaned. Every item mutation validates
  its target list with `listExists` (not a static const). Row shapes: `lib/types.ts`.

## Coding Conventions
- **Explicit over implicit**: avoid hidden logic and clever indirection.
- **Verify before declaring done**: `npx tsc --noEmit`, `npm run build`, and `npm test`
  (11 plain-node suites). Note: drag interactions can't be auto-tested here
  (no browser) — flag those for owner testing.
- **Match the owner's taste**: low-key, matte (no glow), thin/uniform cards, smooth on
  desktop AND mobile. See the design notes in `ARCHITECTURE.md`.
- **No emoji in the UI** (owner call 2026-07-05): no pictographic emoji anywhere on the
  site — use words or small inline SVGs. Monochrome typographic glyphs (✓ ✎ ✕ ↳ ↻ ‹ ›)
  are fine; avoid codepoints that render emoji-style on Apple devices (e.g. ◀ ▶).
- **All color through theme tokens**: components must use `var(--*)` from
  `app/globals.css` — never literal colors. Both the dark (default) and
  `html[data-theme="light"]` blocks must define every token.
- **Keep `/ai` current**: update `PROJECT_STATE.md` as work lands.

## Navigation (priority flow)
1. **START HERE**: `PROJECT_STATE.md` — current focus, active task, backlog, completed.
2. **Rules**: this file (`AGENTS.md`).
3. **Design/data**: `ARCHITECTURE.md`.
4. If out of sync, refresh from the code + git log.

## Gotchas
- Dev 404s everything / won't start → stale `.next`: `rm -rf .next && npm run dev`.
- Running `npm run build` while `next dev` is up corrupts the dev server's manifests
  (every route 500s with "Cannot read properties of undefined (reading 'call')") —
  they share `.next`. Stop dev first, or `rm -rf .next` and restart after building.
- Stale process holding port 3000 → `lsof -ti tcp:3000 | xargs kill -9` before restart.
- dnd-kit + inputs: stop propagation so the keyboard sensor doesn't hijack Enter.
