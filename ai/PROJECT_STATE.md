# Project State

_Last updated: 2026-07-05. Full build/verification narratives for every completed
item live in this file's git history — this doc keeps the current picture and the
durable lessons, not the play-by-play._

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
(Notion-on-top was considered and rejected — no page-history API, more moving
parts, blocks the multi-user path.)

Origin: the owner keeps an ongoing freeform note (today's priorities, waiting/later,
brain dump, recurring daily/weekly checklists, life areas). This app gives that mess
a real structure without losing its looseness.

## Where things stand
- **Hosted-primary since 2026-07-03**: the owner's board lives at
  https://workingmemory.onrender.com (Render free tier). Durability is
  Litestream → Backblaze B2 (restore-on-boot; restore drill passed 2026-07-03) plus
  a daily launchd pull to the Mac (`backups/pull/`, 09:15, via
  `com.carlitoswillis.wm-backup`). The local `data/wm.db` is frozen pre-cutover
  history; `push-local-db.sh` / `pull-backup.sh` move the file either way at will.
- **Multi-account since 2026-07-04** (open signup at `/signup`): ONE multi-tenant
  SQLite file (`DATA_DIR/owner/wm.db`, read as "main.db"), app-level scoping via
  `items.user_id` on every query (see AGENTS.md). Owner is user #1. Anonymous
  visitors get a landing page at `/`; `/demo` gives throwaway per-cookie boards.
- Data model unchanged throughout: SQLite + trigger-driven history
  (`lib/schema.ts`), time-travel intact. No migration runner — schema applies
  idempotently on DB open.
- Git `main` → github.com/carlitoswillis/workingmemory; pushes auto-deploy
  (Render blueprint), so every deploy doubles as a restore drill. CI: tsc,
  `npm test` (5 plain-node suites), next build.

## Awaiting owner
- **Multi-accounts v1 go-live checklist** (code deployed 2026-07-04): set
  `SESSION_SECRET` on Render (`openssl rand -base64 32`); first login as
  `owner` / `<OWNER_SECRET>` runs the idempotent user-#1 bootstrap; verify board +
  history + time machine; **change the password** (on `/login`); eyeball signup
  with a second account. The launchd pull backup keeps working (bearer auth);
  restoring a pre-accounts backup simply re-bootstraps.
- **Landing page eyeball** (built + deployed 2026-07-04): check `/` at desktop +
  phone widths; click through Try-the-demo → `/demo`, Create account, Sign in.
- **Shared boards eyeball** (Phases 0+1 built 2026-07-07): after deploy, first load
  runs the migration + bootstrap (every account gets a "Personal" board; existing
  cards/columns re-homed onto it — the board should look identical). Then: the board
  switcher (header, next to @username) → create a board, rename it, invite a second
  account by username; sign in as that account and confirm the shared board appears
  and both can add/move/edit/archive; card history shows "· @username"; a non-member
  hitting `/b/<id>` gets a 404; "Leave board" works; the personal board can't be
  left. Two-browser pass is the real test of it. **Deploy note:** additive migration,
  no downtime; a pre-boards backup restores clean (bootstrap re-runs). Real-time
  (Phase 2) is NOT in yet — updates need a manual refresh across sessions.
- **Custom columns eyeball** (built 2026-07-07): the board's columns are now
  user-created. Eyeball on the live board: the "＋ New column" tile (end of the
  grid) → name → Add; hover a column header for rename (✎, or click the title) +
  delete (✕); drag-reorder still works; try deleting a column that holds cards
  (should refuse: "Move or archive this column's cards first") and the last column
  (refuses). Confirm history ("Moved X → Y"), Archive labels, and time-travel still
  read right — incl. scrubbing to a moment in a since-deleted column. Quick-capture
  (c) now files into the Brain Dump column if present, else the last column.
- **Light mode eyeball** (built 2026-07-05): flip the sun/moon toggle (board
  header, landing nav, login/signup top-right) and eyeball BOTH themes across
  board, card panel, time machine scrub + snapshot panel, archive, quick
  capture, note markdown, landing, login/signup. Palette values in
  `globals.css` are first-pass — tune to taste.
- **Plans awaiting green-light** (planned, deliberately not built):
  - Self-serve password recovery via one-time recovery codes —
    `ai/plans/2026-07-04-password-self-serve.md`. Build before (or with) the
    encryption item; the codes become its key-recovery mechanism.
  - Fluid time-travel motion (cards glide on discrete time-machine steps, View
    Transitions API, zero deps) — `ai/plans/2026-07-04-fluid-time-travel-motion.md`.
  - Shared boards + real-time (boards/membership entities, actor-attributed
    history via trigger v2, SSE notify-then-pull; 3 phases) —
    `ai/plans/2026-07-05-shared-boards.md`, written as a teaching doc. Four
    owner questions at the bottom gate the build.

## Backlog
- [x] **Light and Dark mode options** — BUILT 2026-07-05 per
      `ai/plans/2026-07-05-light-mode.md`, awaiting owner eyeball (see Awaiting
      owner).
- [ ] **Shared board with real-time updates** — plan written 2026-07-05
      (`ai/plans/2026-07-05-shared-boards.md`, verbose/teaching-style by owner
      request): boards + board_members entities in the same replicated file,
      `BoardContext.boardId` scoping (same `IS ?` NULL trick), actor
      attribution via `items.touched_by` copied into `item_events.actor_id` by
      v2 triggers (drop-then-create versioning), `/b/<id>` routes +
      invite-by-username, realtime = in-process poke bus → SSE → debounced
      `router.refresh()` (notify-then-pull; no WebSockets/CRDTs/brokers —
      single-instance SQLite makes them unnecessary). Phase 0 is an invisible
      scoping refactor. Awaiting green-light on the plan's §13 questions.
- [ ] Self-serve password recovery (recovery codes) — plan written, see above.
- [ ] **Encryption for accounts** (deferred from multi-accounts v1): per-account
      encryption so data is only readable when logged in. Hard tension: SQLCipher
      per-account files conflict with the single-replicated-file durability choice;
      app-level field crypto is the likelier shape. Password-derived keys ⇒
      forgotten password = unrecoverable data (hence: recovery codes first).
      Needs its own plan.
- [ ] Search across items + their history.
- [ ] **AI integration** (the real differentiator — point an LLM at the event
      stream): weekly review that writes itself; auto-triage of brain dumps; "ask
      your history". Plan: `ai/plans/2026-07-03-ai-weekly-review.md`. Owner call
      2026-07-03: build the native Anthropic adapter only (keep the tiny provider
      interface so model-agnostic stays a 40-line add later). `item_events` is the
      substrate and the moat.
- [ ] Weekly-reset + weekday-specific recurring tasks (e.g. "Wednesdays: no car,
      do laundry"). Lower priority than the daily reset that already shipped.
- [ ] Life-area tags (Maintenance / Health / Career / Recreation) as a
      cross-cutting filter over items.
- [ ] **Capture-from-anywhere via email → append to the Note** (owner idea
      2026-06-27; NOT to be built until owner green-lights a plan). Unblocked by
      the hosted deploy — shape is webhook-push, $0: an inbound-email service
      (e.g. Cloudflare Email Routing) POSTs to an authenticated
      `POST /api/capture`, which appends to the daily Note (details-edit trigger
      journals it → time-traveled for free). Send side: any email; iOS Shortcut
      can front it. Auth: shared secret + /login-style rate limit. The old
      IMAP-pull sketch is in this file's git history (pre-2026-07-03).

### Someday / maybe
- [ ] **Postgres/multi-user escalation path** — largely superseded by
      multi-accounts v1 on SQLite; survives only as the "outgrew one SQLite file /
      needs sync + offline" plan. Sketch (Postgres + RLS, Supabase auth, local-first
      sync, per-user migration) is in this file's git history (pre-2026-07-05); the
      2026-06-27 local-pivot commit is the cleanest undo reference.
- [ ] Robust in-depth documentation of the whole system (how + why). Touch last.

## Ops notes (durable gotchas — learned the hard way)
- `LITESTREAM_REPLICA_URL` needs the `s3://` scheme
  (`s3://<bucket>.s3.us-east-005.backblazeb2.com/owner-wm`); without it litestream
  reads it as a local DB path ("database not found in config").
- node:22-slim ships no CA store → the litestream binary fails with
  `x509: certificate signed by unknown authority`; Dockerfile installs
  `ca-certificates` in the runtime stage (commit 5b12c14).
- **Restart immediately after any `/api/import`** (fresh Litestream generation).
  Restarts before that re-replicate the stale pre-import DB as generations that
  look newest — a later restore can resurrect the old board. Fix if it recurs:
  list `owner-wm/generations/<id>/` in B2 and prune the small ones (~2.5KB
  snapshot = empty board; real data ≈ 18KB+), then restart.
- Mac backups use **launchd, not cron** (`~/Library/LaunchAgents/
  com.carlitoswillis.wm-backup.plist`, env in `~/.wm-backup.env` chmod 600, logs
  to `backups/pull/backup.log`) — launchd catches up after sleep, cron silently
  skips. Manual run: `launchctl kickstart gui/501/com.carlitoswillis.wm-backup`.
- `/api/export` + `/api/import` are **bearer-`OWNER_SECRET`-only** since
  multi-accounts (the file holds every account — no browser session may dump or
  replace it). `GET /api/health` deliberately touches no SQLite (must not defeat
  idle-TTL demo sweeps).
- Demo boards are deliberately NOT replicated; the hosted disk is fully
  disposable (`scripts/start.sh`: `litestream restore -if-db-not-exists` →
  `replicate -exec next start`).

## Completed log (condensed; details in git history of this file)
- **2026-07-07 — Shared boards, Phases 0+1 (model + sharing).** Built per
  `ai/plans/2026-07-05-shared-boards.md` (+ §12b reconciliation). Boards are now a
  first-class entity: `boards` + `board_members` tables, scope moved from `user_id`
  to `board_id` across every query/action (`getBoardContext(boardId)` verifies
  membership once — 404 not 403 — then plain `board_id IS ?`; IDOR-safe). `lib/
  boards.ts` (pure) holds board CRUD + membership/roles; `lib/columns.ts` re-keyed
  `lists` to `(id, board_id)` (migrateDb rebuild + bootstrap re-home). Attribution:
  `items.touched_by` stamped by every action, copied into `item_events.actor_id` by
  drop-then-create **v2 triggers** (no double-logging, self-migrating). Every account
  gets a "Personal" board (signup + idempotent `bootstrapBoards`). Phase 1 UI:
  `/b/[boardId]` route, `BoardSwitcher` (switch/create/rename/invite-by-username/
  remove/leave, owner-gated), "· @username" in card history. Client threads `boardId`
  via a `board-context`. NOT built: Phase 2 real-time (SSE) — next. Verified: tsc, 7
  node suites (new `lib/boards.test.ts`: board isolation, IDOR, roles, invite
  idempotency, actor attribution, no-double-log, lists re-key migration), prod build
  (121kB), and a live local-DB migration (44 items / 5 lists re-keyed, board_id/
  actor_id added, lists_legacy consumed, 8 v2 triggers, board renders clean).
  **Follow-ups noted:** rate-limit the invite action in middleware (username
  enumeration hardening, §6); actor labels in the snapshot panel; board delete.
- **2026-07-07 — Custom columns (make/name your own).** The board's columns were a
  hardcoded const; they're now user-created data. New `lists` table keyed by
  `(id, user_id)` (defaults share ids across users, so id alone can't be the PK),
  CRUD + seeding in `lib/columns.ts`, seeded lazily per board in `BoardScreen`
  (`ensureLists`, idempotent, honoring a pre-columns board's `profiles.list_order`).
  `DEFAULT_LISTS` (ids `today`…`braindump`) still seed every new board so existing
  `items.list` values resolve; the old `list_order` plumbing (`getListOrder`,
  `saveListOrderAction`, `orderLists`/`isListId`/`listLabel`) is retired — order now
  lives in `lists.position`, labels come from a passed `listLabels` map, and item
  mutations validate their target with `listExists`. Columns are soft-deleted
  (`archived=1`), refused while holding a visible card or if last, so history /
  archive / time-travel labels survive and no card is orphaned (a since-deleted
  column still renders in a snapshot that had cards in it). New `components/
  AddColumn.tsx` + rename/delete affordances in `Column.tsx`; quick-capture targets
  Brain Dump if present else the last column. No triggers (columns are structure,
  not change-tracked). Verified: tsc, 6 node suites (new `lib/columns.test.ts` +
  per-user column isolation in `users.test.ts`), prod build (119kB held), live
  render seeding the 5 defaults into the real local DB.
- **2026-07-05 — Light mode ("Nocturne Day") + emoji removal.** Every remaining
  hardcoded color was tokenized (new `--scrim/--scrim-deep/--field/--wash/
  --now-wash/--now-line/--now-tint/--past-wash/--past-line` tokens — components
  may ONLY use `var(--*)`), a warm-paper light token set lives under
  `html[data-theme="light"]`, and `components/ThemeToggle.tsx` (inline-SVG
  sun/moon, board header + landing + login/signup) flips it. Device preference:
  `localStorage["wm-theme"]`, applied pre-paint by an inline script in
  `app/layout.tsx` (no flash; `suppressHydrationWarning` on `<html>`). Dark
  stays the default. Owner also asked to drop the site's emoji: 🕰 and 🗄
  removed (copy/labels carry the meaning), ◀/▶ scrubber steps → ‹/›
  (apple devices can render the former emoji-style); monochrome glyphs
  (✓ ✎ ✕ ↳ ↻ ↰) kept as typography. Verified: tsc, 5 suites, prod build
  (118kB held), live prod-server curls (theme script + toggle SSR'd, light
  block in compiled CSS, zero emoji in output).
- **2026-07-04 — Landing page at `/`, demo → `/demo`.** Nocturne-styled front
  door for anonymous hosted visitors (hero = one card's real event trail); board
  extracted to `app/BoardScreen.tsx`, served at `/` for signed-in + local and at
  `/demo` for demo cookies. Server actions revalidate both routes
  (`revalidateBoard()`). Landing visitors no longer spawn throwaway demo DBs.
- **2026-07-04 — Multiple accounts v1.** Open signup, username+password (scrypt),
  stateless HMAC `v2` sessions (`wm_session`, `SESSION_SECRET`), per-account item
  cap. One multi-tenant SQLite file — Litestream/restore/export/backup pipelines
  untouched; `lib/queries.ts` made pure (`{db, userId}` from `getBoardContext()`).
  Idempotent owner→user#1 bootstrap runs before triggers attach. No Supabase
  (kept in reserve for a future email reset only). Change-password on `/login`.
- **2026-07-03 — Deployed + cut over to Render** per
  `ai/plans/2026-07-03-free-deploy-runbook.md`: B2 bucket
  `wm-owner-carlitoswillis`, real DB migrated (41 items / 131 events), restore
  drill passed. Deploy tooling: multi-stage Dockerfile with Litestream baked in,
  `render.yaml` + `fly.toml`, `PUT /api/import` with integrity checks +
  `push-local-db.sh`, `pull-backup.sh`, GitHub Actions CI, README rewrite + badge.
- **2026-07-03 — Feature batch** (each verified: tsc, suites, prod build; First
  Load JS held ~118kB): **Streaks** for daily tasks (`items_log_completed_on`
  trigger + pure `lib/streaks.ts`; time machine reconstructs daily done-ness);
  **fuller optimistic UI** (instant add + panel move-to-list, extending the
  board's manual-optimistic layer — `useOptimistic` rejected as a riskier
  refactor); **markdown details** (`components/Markdown.tsx`, react-markdown +
  remark-gfm, XSS-safe, code-split via next/dynamic; Note column renders it too);
  **archive view** (🗄 slide-over, restore now history-logged via new
  `items_log_unarchived` trigger); **quick-capture** (`c` / ⌘K overlay → Brain
  Dump, blocked while time-traveling).
- **2026-07-02/03 — Portfolio deployment plan phases 1/1b**: demo mode
  (`DEMO_MODE=1`, per-visitor throwaway DBs seeded with ~3 weeks of consistent
  fabricated history, rate limits, TTL sweep with NO background process) and
  single-owner auth + `/api/export` (HMAC `v1` owner cookie — since retired in
  favor of accounts).
- **2026-06-28 — Fluid time machine + past exploration**: scrubber timeline whose
  ticks are real change moments, live client-side reconstruction while dragging
  (`timelineDataAction` ships the event log once); snapshot cards clickable →
  read-only `SnapshotCardPanel` with sub-card drill-down. Past stays strictly
  read-only.
- **2026-06-27 — Interaction batch**: multi-select drag (⌘-click / Shift-range,
  block move, Esc clears), undo for moves (⌘Z, session-only, drag moves only —
  the panel dropdown is still not undoable), sub-card reorder in the panel,
  daily Note column (a pinned `list='note'` item; the time machine is the
  journal). Owner test pass on all of these done.
- **2026-06-27 — Local-first pivot**: entire data layer moved from hosted
  Supabase to better-sqlite3 (`lib/schema.ts` tables + ported history triggers,
  `lib/db.ts` idempotent open), auth deleted, data round-tripped intact
  (24 items / 52 events then). Reversed on *location* by the 2026-07-03 hosted
  cutover but its spirit (SQLite, one file, your own data) still holds.
- **Pre-pivot (Supabase era, 2026-06-26/27)**: scaffold (Next.js App Router + TS
  + Tailwind), Postgres schema + history triggers + RLS, email auth, global
  time-travel (`lib/timetravel.ts` + tests), card detail panel, dnd-kit
  drag/reorder/cross-list, daily-refreshing tasks (`recurrence` +
  `completed_on`), per-card details, "Nocturne" visual identity (then de-glowed
  to matte per owner taste), thin-card redesign, optimistic interactions.
