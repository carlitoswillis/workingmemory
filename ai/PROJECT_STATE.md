# Project State

_Last updated: 2026-07-02_

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
- Under **git** (`main`); **committing as we go** (AGENTS.md). The local pivot and all
  subsequent features are committed.
- **PORTFOLIO DEPLOYMENT in progress (2026-07-02)**: executing
  `ai/plans/2026-07-02-portfolio-deployment.md` — live hosted demo (per-visitor
  ephemeral boards behind a `DEMO_MODE` flag) + single-owner auth (hosted instance
  becomes the owner's primary board) + Fly.io/Docker deploy with Litestream durability
  + repo polish (README, CI, MIT license). Owner approved 2026-07-02.

## Active Tasks
- **➡️ OWNER TODO (2026-07-03): execute `ai/plans/2026-07-03-free-deploy-runbook.md`.**
  Owner chose the fully-free deploy path (Render free tier + Backblaze B2 — no card
  anywhere) and approved the commit (2026-07-03). The commit includes the runbook, a
  real fix in `scripts/start.sh` (`-if-replica-exists` — without it the very first boot
  against an empty bucket crash-loops the container), and `render.yaml` example URLs
  switched from R2 to B2 (B2 needs no credit card and its uploads are free — R2's free
  tier caps writes below Litestream's ~1/s sync). The runbook is ~45 min, all
  owner-side: GitHub push → B2 bucket → Render blueprint → smoke test → cutover via
  `push-local-db.sh` → daily pull cron.
- **Deploy prep + migration tooling (portfolio plan Phase 2, code side)** — BUILT
  2026-07-03. Everything up to the actual hosting signup is ready:
  - `Dockerfile` (node:22-slim multi-stage; better-sqlite3 installs its prebuilt linux
    binary in-image; Litestream v0.3.13 baked in) + `.dockerignore` (data/backups/env
    never enter images) + `scripts/start.sh` entrypoint (`litestream restore
    -if-db-not-exists` then `replicate -exec next start` when `LITESTREAM_REPLICA_URL`
    is set; plain `next start` otherwise — so the disk is fully disposable; demo boards
    are deliberately NOT replicated).
  - `GET /api/health` (no SQLite on purpose — must not defeat idle-TTL sweeps).
  - `fly.toml` (volume at /data, scale-to-zero, health check; ~$2-5/mo, no free tier
    anymore) AND `render.yaml` (free tier, no disk — works because of restore-on-boot;
    15-min spin-down / ~1-min cold start is the tradeoff). Owner picks one.
  - **Migration = `PUT /api/import`** (same auth as export: owner cookie or bearer
    secret; verifies magic bytes + `integrity_check` + expected tables BEFORE swapping;
    `replaceOwnerDb()` in `lib/db.ts` closes the live handle and renames atomically) +
    `scripts/push-local-db.sh` (consistent `db.backup()` snapshot of local `data/wm.db`
    → upload → prints both sides' counts for the cutover check). Dry-run verified
    against a scratch hosted instance with the REAL local DB: 41 items / 131 events
    round-tripped, integrity ok; garbage/non-SQLite uploads rejected 400 with the live
    DB untouched; unauth 401. If Litestream is running, restart the machine after an
    import (fresh generation).
  - `scripts/pull-backup.sh` (Mac-side daily pull → `backups/pull/<stamp>/wm.db`,
    verifies integrity + prints counts, prunes to last 30, never touches the old
    Supabase export dirs; cron line in the header). Tested live.
  - Docker image BUILD + SMOKE-TESTED locally (2026-07-03, arm64): container serves
    /api/health, seeded demo boards, accepted the real-DB migration push (41/131) and
    exported it back out integrity-ok. Litestream itself not yet exercised (needs a
    bucket) — the Phase 2 restore drill still stands.
  - GitHub Actions CI added (`.github/workflows/ci.yml`: tsc, npm test, next build) —
    Phase 3 head start; badge goes in the README pass.
  - REMAINING (needs owner accounts): pick Fly (~$2-5/mo, snappier) vs Render (free,
    ~1-min cold start after 15 idle min), create R2/B2 bucket + litestream secrets,
    deploy, run the restore drill, then cutover via `push-local-db.sh` and set up the
    daily pull cron.
- **Single-owner auth + export (portfolio plan Phase 1b)** — BUILT 2026-07-03,
  self-verified end-to-end. One `OWNER_SECRET` env var guards the owner's real board on
  the hosted instance (no user tables, no per-user schema). `lib/auth.ts` mints stateless
  HMAC session tokens (`v1.<exp>.<hmac>`, 90d, constant-time verify; rotating the secret
  kills all sessions); `lib/auth-edge.ts` is the WebCrypto twin for middleware; both
  covered by `lib/auth.test.ts` (in `npm test`). `/login` (unlinked from the demo UI —
  owner knows the URL) sets the httpOnly `wm_owner` cookie; sign-out on the same page.
  Routing: valid session → `DATA_DIR/owner/wm.db` (`isOwnerRequest()` in `lib/db.ts`,
  demo caps/banner don't apply); else demo path; flag off → local file, untouched.
  Middleware rate-limits POST /login per-IP (burst 5, ~5/min) and exempts the owner from
  demo write limits (verified at the edge so a forged cookie can't skip them). `GET
  /api/export` (session cookie or `Authorization: Bearer <OWNER_SECRET>`) returns a
  consistent `db.backup()` snapshot, timestamped filename — this is what the Phase 2 Mac
  pull-backup script will call; 404 when no secret configured. Verified: tsc, all 3 test
  suites, prod build, live curl checks (anon → seeded demo + visitor cookie; forged owner
  cookie → still demo; valid cookie → bannerless owner board, real server-action write
  landed in `owner/wm.db` with trigger-logged history, absent from all demo DBs; 429 on
  6th rapid login POST; export 401/401/200 with valid SQLite bytes; flag-off: no cookie,
  no banner, export 404). Owner: pick a strong `OWNER_SECRET` at deploy time (Phase 2).
- **Demo mode (portfolio plan Phase 1)** — BUILT 2026-07-02, self-verified end-to-end.
  `DEMO_MODE=1` gives every visitor their own throwaway board: middleware.ts mints an
  httpOnly `wm_visitor` uuid cookie (injected into the first request too, so the first
  paint already has its board) and rate-limits POSTs (token bucket, 30/min burst 60);
  `lib/db.ts#getDb()` resolves the request's DB — flag off → the same single local file
  as always, flag on → `DATA_DIR/demo/<uuid>.db`, seeded on first open with ~3 weeks of
  fabricated, internally-consistent event history (`lib/demo/seed.ts`, event-sourced
  replay inserted before triggers attach, the import-backup pattern). Guardrails: item
  cap 250 / text 500 / details 5k (`lib/demo/limits.ts`), 24h-idle TTL sweep + 400-file
  cap (opportunistic, on new-board creation — NO background process), LRU cap of 50 open
  connections, uuid-sanitized cookie (no path traversal), cookieless clients share one
  fallback board. Demo banner on the board. `npm run dev:demo`; `npm test` runs both
  test files (`lib/demo/seed.test.ts` covers determinism, chronology, event-chain
  consistency, reconstruction at now/past/pre-history, archived-item visibility).
  Verified: tsc, both test suites, prod build, and live curl checks — flag-off identical
  to before (no cookie/banner), per-visitor isolation via a real server-action write,
  429 after burst, trigger-logged history in demo DBs. Owner: eyeball the seeded board +
  scrub the time machine in a browser (`npm run dev:demo`).
- **Fluid time machine + robust past exploration** — BUILT 2026-06-28, awaiting owner test.
  Two parts:
  1. **Scrubber rewind** (`TimeMachineBar.tsx` rewritten): a timeline whose ticks are the real
     moments the board changed. Drag the handle (soft-snaps to the nearest change on release),
     ◀/▶ step change-to-change, relative chips (1h/6h/yesterday/last week), and the old exact
     `datetime-local` demoted to a collapsible "exact time…". Board re-renders **live as you
     drag** — reconstruction is now **client-side**: `timelineDataAction()` ships the whole
     (tiny, single-user) item+event log once on mount, and `pickMoment` runs the pure
     `reconstructBoardAt` locally (no per-tick round-trip). `boardAtAction` kept but unused by
     this path. New `.tm-range` thumb styling in `globals.css`.
  2. **Robust past exploration**: snapshot cards are now **clickable → read-only
     `SnapshotCardPanel`** showing details + reconstructed **sub-cards** (click a child to drill
     in, ↰ back-link). Snapshot columns gained the `↳ done/total` sub-card badge + a details
     dot. Sub-card data was already in the snapshot (`reconstructBoardAt` keeps `parent_id`
     rows); the old render just dropped it. **Past stays strictly read-only** — no edit
     controls, no history timeline (owner chose "details + sub-cards" depth). Verified: tsc,
     `node lib/timetravel.test.ts` (10/10), `npm run build`. Scrub/click/drag need owner
     testing (no browser here).
- **Multi-select drag** — BUILT 2026-06-27, awaiting owner test (drag isn't auto-testable
  here). ⌘/Ctrl-click toggles a card into the selection, Shift-click extends a range within
  a column, plain click still opens the panel; dragging any selected card moves the whole
  set into the target list as a contiguous block (spaced positions, board reading order).
  Count badge in the `DragOverlay`, selected-card ring, dimmed non-active members mid-drag,
  a bottom selection pill, and Esc to clear. New `reorderItemsAction` (one transaction).
  tsc + build + dev-render pass.
- **Undo for moves** — BUILT 2026-06-27, awaiting owner test. ⌘/Ctrl-Z (or an Undo pill)
  reverts the last card move (single or multi). Client-side stack: `onDragStart` captures
  each dragged card's origin (list+position), the drop pushes it, undo restores via
  `reorderItemsAction`. Session-only (clears on reload); typing in a field is ignored so
  native text-undo still works. NOTE: the CardPanel "move to list" dropdown isn't undoable
  yet (only drag moves).
- **Sub-card reorder** — BUILT 2026-06-27, awaiting owner test. The CardPanel "Sub-cards"
  list is now drag-sortable (its own `DndContext` + `SortableItemCard`, optimistic local
  order re-synced from server positions). Persists via `reorderItemAction`. Closes the
  earlier sub-cards v1 gap.
- **Daily note** — BUILT 2026-06-27, awaiting owner test. A single pinned note in its own
  board column (leftmost). It's an `item` with `list='note'`, body stored in `details`, so
  every edit is change-tracked + time-traveled — the **time machine is the journal**.
  Carries over day to day; you clear + rewrite it each day (no "New note" — that was tried
  then removed because it spawned archived copies with no browse UI; the time machine is how
  you revisit past days). `createNoteAction` just creates the one note if missing
  (idempotent); editing reuses `editDetailsAction`. Shown read-only in the time-machine
  snapshot (`SnapshotNoteColumn`). No schema change (reuses items). `list='note'` is a
  sentinel — filtered out of board columns, not a valid drag/move target. (Cleaned up 5
  archived test notes left over from the removed New-note flow.)

## Backlog
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
- [ ] **Capture-from-anywhere via email → append to the Note** (owner idea, 2026-06-27;
      planned, NOT to be built yet). Text/email a thought while away from the machine and
      have it land in the daily Note (could also route to Brain Dump). Stays local-first,
      $0, no deploy, no paid service.
      - **Transport (free):** a throwaway email inbox (e.g. Gmail). Capture by emailing it —
        a one-tap iOS **Shortcut**, the Mail app, or a carrier **SMS→email gateway** (free
        but flaky; recommend the Shortcut).
      - **Ingest:** the local machine *pulls* over IMAP (it reaches out — nothing listens on
        the internet) and appends each new message to the active Note's `details`. The
        existing details-edit trigger logs it, so captures are journaled + time-traveled for
        free. Mark messages `\Seen` so they aren't re-ingested.
      - **OWNER CONSTRAINT: no all-day polling / no always-on daemon.** Pull only on demand:
        a "Pull inbox" button in the app and/or `npm run note:poll`, OR fetch-on-app-open,
        OR IMAP IDLE *only while the app is open* (push while present, nothing in the
        background). Decide which when we build it.
      - **Sketch:** `scripts/note-inbox.ts` using `imapflow` + `mailparser`; reuse `lib/db`;
        creds in `.env.local` (gitignored) loaded via `node --env-file=.env.local …`.
      - **Caveats:** pull means a capture only lands when you run the fetch / open the app;
        carrier SMS→email gateways are unreliable and some are deprecated.
      - **Pairs with:** Quick-capture (above) and Deploy (a hosted endpoint would later allow
        true push via an email/SMS webhook, e.g. Cloudflare Email Routing or Twilio).
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
