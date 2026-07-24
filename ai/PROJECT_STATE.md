# Project State

_Last updated: 2026-07-09. Full build/verification narratives for every completed
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
  An external uptime ping keeps `/api/health` warm (~5 min) — not a nicety: it's
  what stops the cold-start churn that blew the B2 Class C cap (see Ops notes).
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
- [x] **Move cards into other cards and out of cards** — BUILT 2026-07-23, awaiting
      owner eyeball (see Awaiting owner). Drag a card onto another card's ↳ edge, or
      use the panel's "Inside" picker; `lib/nesting.ts` + a parent trigger.
- [x] **Search function** — BUILT 2026-07-23 ("/" or the Search button). Three
      sections in one overlay: the live board (client-side, instant), the archive, and
      the HISTORY log (what a card used to say) — the last two on one debounced server
      action. Opening an archived hit gives you its panel + Restore.
- [x] **Deselecting text box should create the card** — BUILT 2026-07-23: the column
      capture box, the sub-card box, and quick-capture all commit on blur (Esc still
      cancels quick capture).
- [ ] stress testing [nvm maybe] + response time reduction
- [x] **Light and Dark mode options** — BUILT 2026-07-05 per
      `ai/plans/2026-07-05-light-mode.md`, awaiting owner eyeball (see Awaiting
      owner).
- [x] **Shared board with real-time updates** — BUILT 2026-07-07 (Phases 0+1+2), see
      Completed log + Awaiting owner. Plan written 2026-07-05
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
- [x] **Search across items + their history** — BUILT 2026-07-23 together with the
      search overlay (text/details edits + the original capture wording, over
      `item_events`). NOT covered: searching *structural* history (when a card was in
      Waiting, who moved it) — that's a query over `moved` events, worth its own item
      if you ever want it.
- [ ] **AI integration** (the real differentiator — point an LLM at the event
      stream): weekly review that writes itself; auto-triage of brain dumps; "ask
      your history". Plan: `ai/plans/2026-07-03-ai-weekly-review.md`. Owner call
      2026-07-03: build the native Anthropic adapter only (keep the tiny provider
      interface so model-agnostic stays a 40-line add later). `item_events` is the
      substrate and the moat. **Plan revised 2026-07-07** — reconciled with shared
      boards (review is per-`board_id`, digest reads custom columns, and
      `item_events.actor_id` lets a shared-board review attribute actions to members)
      and grounded on the current Claude API (`claude-opus-4-8`, Messages API,
      `output_config.effort`, env-gated off). Awaiting green-light on the plan's §9
      gates: SDK vs fetch, any-member vs owner-only, model default, review window.
- [x] **Weekly-reset + weekday-specific recurring tasks** (e.g. "Wednesdays: no car,
      do laundry") — BUILT 2026-07-23 per the owner's ask: a card can repeat on a
      chosen weekday and STAYS done until that weekday comes round again. Awaiting
      owner eyeball.
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
- **B2 Class C (list) blowup = Render cold-start churn, NOT the app or the
  backup script** (diagnosed 2026-07-08). Render free spins down after 15 min
  idle; each cold start begins on a blank disk, so `litestream restore` re-lists
  the bucket AND `replicate` opens a brand-new generation — while the default 1h
  retention check never fires inside the ~15-min process life, so generations
  pile up and every restore lists across all of them (~6k `s3_list_objects`/day
  observed). Both fixes are in place as of 2026-07-09: (1) THE cure — an external
  uptime ping keeps `/api/health` warm every ~5 min, under the 15-min idle window,
  so cold starts stop and retention actually runs; (2) `litestream.yml` (baked at
  `/etc/litestream.yml`, wired via `start.sh -config`) sets explicit retention/sync
  intervals — the old positional `db url` invocation had NO way to. If the churn
  ever returns, check the uptime monitor first. Once warm, steady-state
  Class C ≈ the hourly retention check only. The daily launchd pull-backup is
  NOT involved (it hits `/api/export`, never touches B2). If B2 caps you: raise
  the Class C daily cap a few cents — a $0 cap silently stops replication.
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


## completed (to be condensed) (all done)
- **2026-07-23 batch eyeball** (built, NOT yet committed or deployed — see Completed
  log for what each one is). On the board:
  - **Nesting**: drag a card and watch the other cards grow a "↳" strip on their right
    edge; drop on it → the card moves inside, the board badge (↳ 0/1) appears, ⌘Z
    undoes it. Then open a card → the "Inside" picker: move it under another card, and
    back to "— on the board —" (it lands in whatever the List dropdown says). Check the
    refusals surface (a card can't go inside its own sub-card), that history reads
    "Nested in …" / "Moved out of … onto the board", and that a snapshot in the time
    machine shows the OLD structure at that moment. **Multi-select nest** (⌘-click a
    few, drag one onto a strip) is the other drag path to try. Phone: the strip is
    44px, so a long-press drag should be able to hit it — worth a check.
  - **Search**: "/" or the Search button (bottom right, next to Capture). Type part of
    a card's title or details; ↑↓ + Enter opens it. Sub-card hits say which card
    they're in. Then check the two deeper sections (they appear after ~250ms, from 2
    characters on): **Archived** — open one and the panel offers Restore instead of
    Archive; **In history** — search a word you've since edited out of a card or out
    of the daily note, and it should come back labelled "used to say" / "as first
    captured" with the date. The Archive drawer also has its own filter box.
  - **Blur commits a draft**: type in a column's capture box and click elsewhere — the
    card should be created, not lost. Same for the sub-card box, and for quick-capture
    when you click outside it (Esc still discards).
  - **Weekly cards**: open a card → the ↻ row is now a picker (Doesn't repeat / Every
    day / Every ⟨weekday⟩). Set one to Every Wednesday, check it off, confirm it reads
    "Done this week" and stays done tomorrow; the strip shows the last 8 weeks and the
    streak counts weeks. Existing daily cards must behave exactly as before.
  - Not verifiable here: every drag interaction (no browser in this environment — the
    Chrome extension couldn't reach the local dev server either).
- **B2 Class C fix — ops half. DONE 2026-07-09; site confirmed back up.** All four
  steps landed: the B2 Class C daily cap was raised off $0 (replication resumed),
  the keep-alive HTTP monitor now hits `/api/health` every ~5 min (the root cure —
  it holds the service above Render's 15-min idle window, so cold starts stop and
  the retention check actually fires), and `1d64182` (the `litestream.yml`
  retention config) is deployed. Still worth a glance after ~a day of warm
  running: B2 Reports `s3_list_objects` should collapse to double digits, and the
  Render logs should show one restore per deploy rather than one per ~15 min. Full
  detail: `ai/plans/2026-07-03-free-deploy-runbook.md` §8 + incident log.
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
  no downtime; a pre-boards backup restores clean (bootstrap re-runs). Real-time is
  now in (Phase 2): with two browsers on the same board, one person's add/move/edit/
  archive should appear on the other within ~1s with no manual refresh; a card mid-drag
  or a time-machine scrub shouldn't get yanked; closing a tab shouldn't leak (the
  server unsubscribes on abort).
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


## Completed log (condensed; details in git history of this file)
- **2026-07-23 — Cards inside cards (nesting), board search, blur-commits-a-draft,
  weekly recurring cards.** Four backlog items in one batch; all verified with tsc,
  11 node suites (3 new), and a prod build (board 125kB First Load, from 118kB).
  - *Nesting* — sub-cards existed but could only be BORN inside a parent; the missing
    verb was re-parenting. `lib/nesting.ts` (pure, `board_id IS ?` scoped) refuses
    loops (walks the parent chain), the daily note, archived parents, and cross-board
    ids; the subtree rides along by reference. A nested card inherits its parent's
    column, so popping it out lands somewhere real. History stays DB-driven: a new
    `items_log_parent_v2` trigger logs `moved`/`parent` (values are item ids, null =
    the board), and `lib/timetravel.ts` reverts it, so a snapshot shows the structure
    as it WAS. UI: a 44px "↳" drop strip on each card while another card is dragging
    (a custom collision detector gives nest strips priority ONLY when the pointer is
    inside one — plain reordering is untouched), plus an "Inside" picker in the panel
    (optgroups per column, indented by depth, excludes the card's own subtree). The
    undo stack now holds closures instead of position lists, so ⌘Z undoes a nest too.
  - *Search* — "/" (or the button next to Capture) opens one overlay over three
    layers. **The board**: `lib/search.ts` is pure, AND-of-terms over title + details,
    title hits above details hits, most-recently-touched first, matched against the
    cards the client ALREADY has — instant, no round-trip, no index. **The archive**
    and **the history log**: one debounced (250ms, ≥2 chars) `deepSearchAction`.
    History is the differentiator — `searchHistory` (lib/queries.ts) narrows
    `item_events` in SQL (text/details edits + the 'created' wording, escaped LIKE per
    term, board-scoped through the items join) and `searchEvents` ranks it newest-first
    with a 2-hits-per-card cap, showing the OLD side ("used to say" / "as first
    captured"). Picking any hit opens the card: Board keeps a small `found` list for
    rows that aren't on the live board, fetched via `getItemAction`, and the panel
    swaps Archive for **Restore** on an archived card. The Archive drawer also got a
    filter box using the same matcher. The daily note is excluded from the live
    section only (it has no panel) — its text is still searchable through history.
  - *Blur commits* — the column capture box, the panel's sub-card box, and
    quick-capture (click-away) now create the card instead of dropping the draft;
    Esc on quick-capture still cancels.
  - *Weekly cards* — `items.recurrence` gained a third form, `weekly:<0-6>` (0 =
    Sunday), so no migration: done-ness stays DERIVED from `completed_on` — the card
    counts as done while that date sits inside the current period (today for daily,
    weekday→next-weekday for weekly), which is why the reset needs no scheduled job
    and the time machine can ask "was it done then?" by passing a past date.
    `lib/recurrence.ts` owns the parsing/period math, `lib/streaks.ts` gained
    `weeklyStreak`/`streakFor`/`daysWithLiveCheck`. The panel's ↻ toggle became a
    picker; the strip shows 8 weeks for a weekly card and the streak counts weeks.
- **2026-07-09 — B2 Class C incident closed.** Cap raised off $0, keep-alive
  monitor on `/api/health` live, `1d64182` deployed; site confirmed back up.
  The keep-alive is the load-bearing piece — the retention config only helps once
  the process lives long enough to run a retention check.
- **2026-07-09 — App mark: favicon, apple-touch icon, web manifest.** Three
  stacked bars (top = `--now` amber, two beneath = `--past` blue, each shorter and
  fainter): the Today column seen from the side, an item receding into its own
  history. Geometry, not a pictograph, per the no-emoji taste. Nothing in the
  toolchain can rasterize (no sharp/rsvg/ImageMagick), so `scripts/gen-icons.mjs`
  (`npm run icons`) does it dependency-free — rounded-rect coverage from a signed
  distance field, PNG/ICO assembled with `node:zlib`. It defines the geometry once
  and emits BOTH `app/icon.svg` and the PNGs, so vector and bitmaps can't drift.
  Outputs: `app/icon.svg` + `app/favicon.ico` (16/32/48), full-bleed
  `app/apple-icon.png` (Apple masks its own squircle and rejects transparency),
  and `public/icon-{192,512}.png` + `icon-maskable-512.png` (content inset to the
  centre 80% safe zone). `app/manifest.ts` → `/manifest.webmanifest`;
  `short_name` is "Memory" because Android clips ~12 chars; `theme_color` is a
  single dark value, not a light/dark media pair, since `THEME_INIT` only reads an
  explicit stored "light" (the app is dark regardless of device preference).
  **Middleware matcher widened** to skip the icons + manifest — they're fetched on
  nearly every cold load and in `DEMO_MODE` each fetch would otherwise mint a
  visitor cookie. Verified: tsc, prod build, and live curls against a DEMO_MODE
  instance (all 7 asset routes 200 with right content-types and zero `Set-Cookie`,
  while `/` still mints).
- **2026-07-08 — Litestream retention config; diagnosed the B2 Class C blowup.**
  Backblaze hit its free Class C (`s3_list_objects`) cap — ~6,034/day vs 2,500
  allowed — and started refusing calls (stalling replication). Diagnosed as
  Render free-tier cold-start churn, NOT the app or the daily backup script (that
  hits `/api/export`, never the bucket): the diskless free tier makes every
  ~15-min cold start re-list the bucket to restore AND open a fresh Litestream
  generation, while the default hourly retention check never fires in the short
  process life, so generations pile up and every restore lists across all of them.
  Fix shipped (commit `1d64182`; deployed 2026-07-09): added
  `litestream.yml` (explicit `retention 24h` / `retention-check-interval 1h` /
  `snapshot 24h` / `sync-interval 10s`) baked into the image (`Dockerfile`) and
  wired via `scripts/start.sh -config` — the old positional `db url` invocation
  had no way to set retention. The real cure is operational (keep the service warm
  with an uptime ping so cold starts stop; the config is belt-and-suspenders).
  No new env vars. Decision log (weighed: keep-alive vs. retention-only vs. Fly)
  in `ai/plans/2026-07-03-free-deploy-runbook.md`.
- **2026-07-07 — Board deletion (✕ button in switcher).** Added support for deleting a board
  (owner action) or leaving a board (member action) directly from the switcher dropdown list.
  Added `deleteBoard` pure db method (cleans up lists, items, and item_events inside a transaction)
  and its corresponding Next.js server action `deleteBoardAction`. Rendered a hoverable "✕" button next to
  each board item in `BoardSwitcher` (hidden when the user has only 1 board total). Verified via typecheck,
  successful production build, unit tests in `lib/boards.test.ts`, and full test suite execution.
- **2026-07-07 — Shared boards, Phase 2 (real-time).** Notify-then-pull over SSE, no
  new deps, per plan §7–§8. In-process poke bus (`lib/realtime.ts`, an EventEmitter on
  globalThis); every mutation calls `pokeBoard(bid)` (folded into `revalidateBoard`,
  plus board rename/invite/remove). SSE route `app/api/boards/[boardId]/stream` —
  membership-gated (404 for anon/non-member), sends the board high-water mark
  (`max(item_events.id)`, `getBoardHighWater`) on connect + each poke, heartbeats every
  25s, unsubscribes on abort (the one leak risk — covered by a test). Client hook in
  `Board.tsx`: `EventSource` → debounced (300ms) `router.refresh()` into the existing
  resync; suppressed while dragging or time-traveling; first frame is the baseline (no
  refresh on connect), a higher mark after reconnect catches changes missed while away;
  fallbacks = refetch on focus/visibility + a 90s interval only while the stream is
  broken. Single instance by architectural commitment ⇒ no broker/WebSockets/CRDTs.
  Request-scoped ⇒ no always-on process. Verified: tsc, 8 node suites (new
  `lib/realtime.test.ts`: delivery, board isolation, no-listener-leak across 100
  connect/disconnect cycles), prod build (`/api/boards/[boardId]/stream` registered,
  118kB board), and live curls against a DEMO_MODE instance (unauth→404,
  valid-session-non-member→404, member→200 `text/event-stream` initial `data:{"h":0}`).
  Owner two-browser "feels live" pass still pending.
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
  enumeration hardening, §6); actor labels in the snapshot panel.
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
