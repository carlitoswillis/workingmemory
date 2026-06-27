# Agent Guidelines (AGENTS.md)

PURPOSE: The authoritative rulebook for AI assistants working on Working Memory.

## Project Context
- **Objective**: A multi-user "working memory" board web app (mobile later) where every
  change is tracked so you can time-travel the board. Product for real users; the moat is
  a queryable history of your attention + AI over it. See `PROJECT_STATE.md`.
- **Stack**: Next.js (App Router) + React 18 + TS + Tailwind; Supabase (Postgres + Auth +
  RLS); @dnd-kit; hosted DB (free tier). Runs locally against the hosted project.

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
- **History is DB-driven**: never log events in app code — Postgres triggers
  (`log_item_event`) write `item_events` on insert/update. App actions do plain CRUD.
- **Isolation is RLS**: every table is row-level-security scoped to `auth.uid()`. Don't
  rely on app code for per-user separation.
- **Migrations**: SQL files in `supabase/migrations/`, applied to the hosted DB via `psql`
  (local Supabase/Docker was abandoned). Add a new numbered file per schema change.
- **Single sources of truth**: columns in `lib/lists.ts`, row shapes in `lib/types.ts`.

## Coding Conventions
- **Explicit over implicit**: avoid hidden logic and clever indirection.
- **Verify before declaring done**: `npx tsc --noEmit`, `npm run build`, and run the unit
  test (`node lib/timetravel.test.ts`). Note: drag interactions can't be auto-tested here
  (no browser) — flag those for owner testing.
- **Match the owner's taste**: low-key, matte (no glow), thin/uniform cards, smooth on
  desktop AND mobile. See the design notes in `ARCHITECTURE.md`.
- **Keep `/ai` current**: update `PROJECT_STATE.md` as work lands.

## Navigation (priority flow)
1. **START HERE**: `PROJECT_STATE.md` — current focus, active task, backlog, completed.
2. **Rules**: this file (`AGENTS.md`).
3. **Design/data**: `ARCHITECTURE.md`.
4. If out of sync, refresh from the code + git log.

## Gotchas
- Dev 404s everything / won't start → stale `.next`: `rm -rf .next && npm run dev`.
- Stale process holding port 3000 → `lsof -ti tcp:3000 | xargs kill -9` before restart.
- dnd-kit + inputs: stop propagation so the keyboard sensor doesn't hijack Enter.
