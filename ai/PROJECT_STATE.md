# Project State

_Last updated: 2026-07-04_

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
- **HOSTED-PRIMARY as of 2026-07-03**: the owner's board now lives on the hosted
  instance (https://workingmemory.onrender.com, single-owner auth via `/login`);
  the local `data/wm.db` is frozen pre-cutover history, and the Mac's role is
  **backup destination** (daily launchd pull → `backups/pull/`). Durability is
  Litestream → B2 (restore-on-boot, drill passed 2026-07-03). This inverts the
  2026-06-27 local-first pivot's *storage location* but keeps its spirit: still
  single-user, still SQLite, still your own data — verified local copies daily,
  and `push-local-db.sh`/`pull-backup.sh` can move the file either way at will.
  **Multi-account since 2026-07-04** (multiple-accounts v1, see Backlog): open
  signup on the hosted instance, owner is user #1 in the same replicated file;
  still SQLite, still one file, still your own data.
- Data model unchanged: SQLite + trigger-driven history (`lib/schema.ts`),
  time-travel intact. `DEMO_MODE=1` on the hosted instance gives visitors
  throwaway per-cookie boards; the owner cookie routes to the real board.
- Under **git** (`main`, pushed to github.com/carlitoswillis/workingmemory);
  **committing as we go** (AGENTS.md). Pushes auto-deploy the hosted instance
  (Render blueprint) — every deploy doubles as a restore drill.
- **PORTFOLIO DEPLOYMENT (2026-07-02 plan): all phases built and live** — demo
  mode (Phase 1), single-owner auth + export (Phase 1b), Docker/Litestream
  deploy + migration tooling (Phase 2), deployed + cut over 2026-07-03 (see
  Active Tasks). README pass with CI badge done 2026-07-03 — plan complete.

## Active Tasks
- **✅ DEPLOYED + CUT OVER (2026-07-03): `ai/plans/2026-07-03-free-deploy-runbook.md`
  executed** — live at https://workingmemory.onrender.com (owner renamed the
  service from workingmemory-demo on 2026-07-03; the old subdomain 404s) (Render free +
  B2 bucket `wm-owner-carlitoswillis`, endpoint `s3.us-east-005.backblazeb2.com`,
  replica prefix `owner-wm`). Real DB migrated (41 items / 131 events), restore
  drill PASSED (restart wiped the disk, board came back from B2, fresh Litestream
  generation confirmed). Two deploy failures hit + fixed along the way:
  1. `LITESTREAM_REPLICA_URL` pasted without the `s3://` scheme → litestream read
     it as a local DB path ("database not found in config"). Correct form:
     `s3://wm-owner-carlitoswillis.s3.us-east-005.backblazeb2.com/owner-wm`.
  2. `x509: certificate signed by unknown authority` → node:22-slim ships no
     system CA store; the Go litestream binary needs it. Fixed in Dockerfile
     (`ca-certificates` in the runtime stage, commit 5b12c14).
  Cutover gotcha (matches the runbook's "restart right after import" warning):
  restarts BEFORE the post-import restart re-replicated the stale pre-import DB
  as new B2 generations that looked newest, so a restore could resurrect the
  empty board. Fixed by deleting the stale/empty generations from the bucket
  (S3 DELETE via curl --aws-sigv4) so only the real-data generation remained,
  then restarting. If an import ever misbehaves again: check the bucket for
  multiple `owner-wm/generations/<id>/` dirs and prune the small (~2.5KB
  snapshot = empty board) ones; real-data snapshots are ~18KB+.
  Daily Mac backup: runbook §7's crontab was replaced by a **launchd
  LaunchAgent** (`~/Library/LaunchAgents/com.carlitoswillis.wm-backup.plist`,
  daily 09:15, logs to `backups/pull/backup.log`, env in `~/.wm-backup.env`
  chmod 600) because launchd catches up on wake — cron silently skips jobs
  whose time passes while the Mac sleeps. Verified live via `launchctl
  kickstart gui/501/com.carlitoswillis.wm-backup` → ok 41/131.
  REMAINING (owner): freeze pre-cutover local file
  (`cp data/wm.db backups/pre-cutover-$(date +%Y%m%d).db`; hosted board is now
  primary — stop editing local). (The stale `REPLICA_URL_2/_3` `.env.local`
  lines are gone — owner deleted them 2026-07-03.)
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
- [x] **Multiple accounts (v1)** — BUILT 2026-07-04, awaiting owner browser pass +
      deploy. Open signup (`/signup`), username+password accounts on the hosted
      instance; **owner migrates in as user #1** (special-case owner code retired).
      Owner decisions 2026-07-04: skip encryption for v1 (backlog follow-up), open
      signup, owner becomes an account. **No Supabase** — creds were offered but with
      encryption out of scope its main value was managed auth emails; not worth
      reintroducing a hosted dependency (kept in reserve for a future email-based
      password reset; NOT committed anywhere).
      **Architecture: ONE multi-tenant SQLite DB, not per-account files** — Litestream
      only replicates statically-configured paths, so dynamic per-account files would
      silently not survive Render's disposable disk; all accounts live in the existing
      replicated `DATA_DIR/owner/wm.db` ("main.db"), so Litestream/restore/export/
      backup pipelines are untouched. Scoping is app-level: `items.user_id` +
      `user_id IS ?` on every read, `and user_id is ?` guard on every mutation
      (IS matches null, so local/demo boards use the same SQL with userId null).
      `item_events` unchanged — history scopes through its items join; the trigger
      engine is untouched. Sessions: stateless HMAC `v2.<userId>.<exp>.<hmac>` keyed
      by new env `SESSION_SECRET`, httpOnly `wm_session` cookie, scrypt password
      hashes (node:crypto, no new deps). lib/queries.ts is now PURE (takes {db,
      userId} from `getBoardContext()`), which let the isolation tests run in plain
      node. Middleware: session bypass at the edge + per-IP signup bucket (burst 3).
      `/api/export|import` are bearer-`OWNER_SECRET`-ONLY now (the file holds every
      account; no browser session may dump/replace it) — pull/push scripts already
      used bearer, unchanged. Per-account cap `ACCOUNT_MAX_ITEMS` (default 2000).
      **Owner→user#1 bootstrap**: idempotent, in lib/db.ts, runs before triggers
      attach (no spurious history/updated_at); first main-DB open with no users +
      legacy rows creates 'owner' (password = OWNER_SECRET) and re-owns everything.
      Change-password lives on /login; NO password reset (no email in v1 — pages say
      so). Verified: tsc, 5 test suites (new lib/users.test.ts: scrypt, v2 tokens,
      two-user isolation incl. cross-user update no-op), prod build (118kB held),
      bootstrap smoke test on a copy of the REAL 2026-07-04 backup (41/41 items
      re-owned, 135 events intact, idempotent across restart), live checks: owner
      login → real board, second account sees empty board, forged cookie → demo,
      duplicate username rejected, change-password roundtrip, export/import cookie
      → 401 + bearer → 200, login/signup 429s, anon demo unchanged, local mode
      (flag off) unchanged with zero users created.
      **REMAINING (owner)**: set `SESSION_SECRET` on Render (openssl rand -base64
      32), push to deploy (bootstrap runs on first login), sign in as
      `owner`/`<OWNER_SECRET>`, verify board + history + time machine, CHANGE THE
      PASSWORD, then eyeball signup with a second account. Note: the launchd pull
      backup keeps working (bearer), and a restore of a pre-accounts backup simply
      re-bootstraps.
- [ ] **Encryption for accounts** (deferred from multiple-accounts v1): per-account
      encryption so data is only decryptable once logged in — would mean SQLCipher-
      style per-account files (conflicts with the single-replicated-file durability
      choice) or app-level field crypto; needs its own plan. Password-derived keys ⇒
      forgotten password = unrecoverable data.
- [ ] Search across items + their history.
- [ ] **AI integration** (the real differentiator — point an LLM at the event stream):
      weekly review that writes itself; auto-triage of brain-dumps; "ask your history".
      Plan exists (`ai/plans/2026-07-03-ai-weekly-review.md`); owner reversed
      the model-agnostic requirement 2026-07-03 ("fuck it lets just use
      claude") — build the native Anthropic adapter only, skip the
      openai-compatible one (the tiny provider interface can stay so agnostic
      remains a 40-line add later). Deferred: owner chose to tackle a
      different backlog item first. `item_events` is the substrate and the
      moat.
- [x] **Owner test pass on the live board** (one session, now easy since the hosted
      board is primary): scrubber rewind + snapshot drill-down, multi-select drag,
      undo for moves, sub-card reorder, daily note — all BUILT and self-verified
      but marked "awaiting owner test" in Active Tasks since late June.
- [x] **Streaks for daily tasks** — BUILT 2026-07-03, awaiting owner eyeball. New
      `items_log_completed_on` trigger (lib/schema.ts) finally logs daily check-offs
      to history (they were invisible before — not even the time machine saw them);
      existing DBs pick it up automatically on next open (new trigger name + the
      idempotent CREATE_TRIGGERS in openAt), but per-day data only accrues from
      today. `lib/streaks.ts` (pure, tested: value-based replay — check adds the
      day, uncheck removes exactly the cleared day; item's live completed_on seeds
      pre-trigger history) → `getItems()` attaches `completed_days` to daily items
      → card shows `↻ N` when streak ≥ 2 (streak follows the optimistic checkbox),
      panel shows streak line + last-14-days strip. Bonus: time machine now
      reconstructs daily done-ness correctly (completed_on revert + "was it checked
      for t's calendar day"). Verified: tsc, 4 test suites (streaks suite new),
      prod build, trigger smoke-test on a pre-existing DB, live SSR check (3-day
      streak renders). Streak "today" uses browser-local dates end to end.
- [x] **Fuller optimistic UI** — BUILT 2026-07-03, awaiting owner test. Closed the
      two paths that still round-tripped before showing feedback: **add** (a new card
      now appears instantly) and the **CardPanel "move to list" dropdown** (card
      relocates on the board instantly + the select reflects the pick immediately).
      Cross-list *drag* was already optimistic. Implemented by extending the board's
      existing manual-optimistic layer rather than `useOptimistic` (the backlog's
      wording): Board owns `itemsByList` and already mutates it locally for drag/undo/
      multi-select, so `useOptimistic` would fight the `itemsRef` pattern and be a
      riskier refactor for the same result. New Board handlers `addCard` (inserts a
      `temp-*` card, then persists; the items-driven resync swaps in the real row on
      revalidate) and `moveCardToList` (relocates locally, then persists), threaded to
      Column (via SortableColumn) and CardPanel. Column no longer disables its input
      while pending, so you can fire off cards rapidly. Verified: tsc, all 4 suites,
      prod build (First Load JS held ~118kB), `next start` render + no hydration
      errors. The instant-feel itself is browser-only — owner to eyeball (add cards
      fast; move a card via the panel dropdown and watch the board behind it).
- [x] **Richer details (markdown)** — BUILT 2026-07-03, awaiting owner test. Card
      details now render **markdown** at rest (headings, bold/italic, lists, links,
      inline/blocks of code, blockquotes, tables, GFM task-list checkboxes) and drop
      to a raw textarea on click/Edit — editing stays plain text, still
      change-tracked + time-traveled (no storage change; `details` is the same
      string). New reusable `components/Markdown.tsx` (react-markdown + remark-gfm;
      no raw HTML, dangerous URL protocols stripped → XSS-safe; links open new-tab
      w/ noopener) styled by a `.md-body` block in globals.css (no typography
      plugin). Reused read-only in `SnapshotCardPanel` (past details) and is the
      renderer the **AI weekly review** will use for its output later. **Code-split**
      via next/dynamic so react-markdown (~43kB) loads only when a panel opens —
      initial board First Load JS stayed ~118kB (vs 159kB if bundled). Deps added:
      react-markdown@9, remark-gfm@4 (npm audit: 0 new vulns; the 2 flagged are
      pre-existing Next 14 / postcss, fix = Next 16 major, out of scope). Verified:
      tsc, all 4 test suites, prod build, a react-dom/server render check (headings/
      task-lists/safe-links/`javascript:` stripped), dev SSR render. Rendering in the
      live panel is browser-only — owner to eyeball. The daily **Note** (NoteColumn)
      renders markdown too (2026-07-03) — same view/edit pattern, but next/dynamic
      with ssr:true (it's visible on first paint, so SSR the markdown to avoid a
      flash while still code-splitting react-markdown out of the initial JS; verified
      via `next start`, First Load JS held ~118kB). The note's daily/weekly checklists
      now render as real GFM task lists.
- [x] **README pass + CI badge** — DONE 2026-07-03: full rewrite for the
      SQLite/hosted era (live-demo link, origin story, time-machine pitch,
      $0-deploy section, CI badge). Old Supabase-era README is in git history.
- [ ] **Weekly-reset + weekday-specific recurring tasks** (e.g. the note's "Wednesdays:
      no car, do laundry"). Lower priority than the daily reset that already shipped.
- [ ] **Life-area tags** (Maintenance / Health / Career / Recreation) as a cross-cutting
      filter over items.
- [x] **Archive view** — BUILT 2026-07-03, awaiting owner test. Browse + restore
      archived items (archiving was non-destructive but had no UI). Self-contained
      `components/ArchiveView.tsx` (🗄 button in the header → right slide-over,
      matches CardPanel): loads archived items on open via `archivedItemsAction()`
      (→ `getArchivedItems()`, most-recently-archived first), each row shows
      text + details preview + list badge + archived date + a **Restore** button
      (`unarchiveItemAction`, optimistic row-removal; revalidate puts it back on the
      board). **New:** restore is now LOGGED to history — added an
      `items_log_unarchived` trigger (archived 1→0 → `reopened`/`archived` event),
      since the old `items_log_archived` deliberately only logged archiving
      (`and new.archived = 1`), which left un-archiving invisible — off-brand for a
      "nothing is ever lost" app. New trigger name = picked up idempotently on next
      DB open (same mechanism the streaks trigger used); `field='archived'` keeps
      time-travel correct (reconstruction reverts by field+old_value, type-agnostic).
      `describe()` in CardPanel now renders it as "Restored from archive". Verified:
      tsc, 4 test suites, prod build, a trigger+time-travel smoke test (restore event
      written; board correctly hides the item at the archived moment and shows it once
      restored), dev SSR render. Slide-over interaction is browser-only — owner to
      eyeball (archive a card, open 🗄, Restore it).
- [x] **Quick-capture** — BUILT 2026-07-03, awaiting owner test. A keyboard-first
      "dump to Brain Dump" always in reach: a bare `c` or `⌘/Ctrl-K` opens a small
      overlay (`components/QuickCapture.tsx`) anywhere on the board; Enter files the
      text into Brain Dump and clears the field for rapid multi-dump (running "✓ N
      added"), Esc closes. A low-key `＋ Capture` pill (bottom-right) opens the same
      thing for touch/mouse. Blocked while time-traveling (past is read-only) and
      while a text field is focused. No schema change / no new deps — reuses
      `addItemAction(text, "braindump")`, so captures are trigger-logged +
      time-traveled; demo caps still apply. Open/close state lives in `Board.tsx`
      (owns the global keydown listener); the overlay `stopPropagation`s so it never
      collides with the undo/select hotkeys. Verified: tsc, timetravel test, prod
      build, dev-server SSR render. Keyboard/overlay interaction is browser-only —
      owner to eyeball.
- [ ] **Capture-from-anywhere via email → append to the Note** (owner idea, 2026-06-27;
      NOT to be built until owner green-lights a plan). **UNBLOCKED by the 2026-07-03
      deploy** — the design flips from IMAP-pull to webhook-push:
      - **New shape (hosted, $0):** an inbound-email service (e.g. Cloudflare Email
        Routing, free) receives mail at a private address and POSTs it to an
        authenticated `POST /api/capture` route on the hosted instance, which appends
        to the daily Note's `details` (or routes to Brain Dump). The existing
        details-edit trigger journals it — captures are time-traveled for free.
        No daemon, no polling: the hosted server is already always-on (modulo the
        free tier's 15-min spin-down, which inbound webhooks simply wake).
      - **Send side:** email from anywhere; a one-tap iOS Shortcut can front it.
      - **Auth:** shared secret in the webhook URL/header; rate-limit like /login.
      - The old IMAP-pull sketch (`imapflow` + `mailparser`, on-demand only, owner's
        no-background-process constraint) is superseded but preserved in git history
        (this file, pre-2026-07-03) if the hosted path ever goes away.
      - **Pairs with:** Quick-capture (above).

### Someday / maybe (bottom-of-pile, low priority)
- [ ] **Re-introduce multi-user + auth** — LARGELY SUPERSEDED by multiple-accounts v1
      (2026-07-04): accounts + auth + per-user scoping shipped on SQLite, no Postgres
      needed at this scale. This item survives only as the "if it ever outgrows one
      SQLite file / needs sync + offline" escalation path. (reverses the 2026-06-27 local pivot; "someday
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

- [ ] Robust documentation of this project and its deployment etc. in depth in immmense detail how everything works and why. [this should be the last item we touch]

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
