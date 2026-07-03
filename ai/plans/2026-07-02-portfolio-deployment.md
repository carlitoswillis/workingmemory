# Plan: Working Memory as portfolio flagship (live demo + polished repo)

_Created 2026-07-02 · Status: PROPOSED — no code changed yet. Owner approval required per phase._

## Goal

Make Working Memory the one flagship portfolio project for SWE recruiters:
a **live hosted demo** anyone can click, plus a **polished public repo**.
The pitch: an event-sourced task board with time travel — systems thinking
(append-only event log, SQLite triggers, client-side board reconstruction)
inside a product a recruiter understands in 30 seconds.

## Why this project (assessed 2026-07-02)

- Only realistic live-demo candidates in the workspace were `expert` and
  `workingmemory`; the rest are desktop apps, firmware, scrapers, or legally
  gray to host publicly.
- Time travel is the differentiator Trello/Notion don't have — memorable in a
  demo, and the underlying event-sourcing story is exactly what a SWE
  interviewer wants to talk about.
- Verified on a sandbox copy (owner tree untouched):
  - Local-SQLite pivot **is committed**; working tree clean except untracked
    `.claude/`. (The "not yet committed" note in PROJECT_STATE.md is stale.)
  - `node lib/timetravel.test.ts` → **10/10 pass** (Node 22).
  - `npx tsc --noEmit` (fresh, no cache) → **clean**.
  - Repo hygiene already good: `.env.local`, `data/`, `backups/` gitignored;
    no secrets or personal data tracked; Supabase migrations tracked only as
    schema history (fine — documents the evolution).
  - Full Linux prod build could NOT be verified in the sandbox (npm registry
    blocked; native binaries in the copy were macOS). Must be confirmed on
    the owner's machine and again on the deploy host.

## Key constraint

`better-sqlite3` is a **native module** → the deploy host must compile/run it.
- ✅ Fly.io, Railway, Render, any VM (Docker) — works, and a persistent volume
  matches the current SQLite architecture with minimal change.
- ❌ Vercel/serverless — not without replacing the data layer. Out of scope.

## Decisions resolved 2026-07-02 (owner)

- **Hosted instance becomes the owner's primary board.** The Mac becomes a
  backup destination, not a second editable copy — no two-way sync (explicitly
  out of scope; revisit only if ever needed, the event log makes it tractable).
- **Single-owner auth is approved** (this satisfies the AGENTS.md "explicit
  owner decision" clause): one env-var secret (password or passkey), a
  `/login` route, session cookie. Owner session → the real board on the
  persistent volume; everyone else → ephemeral demo boards. **No user tables,
  no per-user scoping in the schema, no Supabase.**
- **Durability = two layers**:
  1. **Litestream** sidecar in the container, streaming the owner DB to an
     object-storage bucket (Cloudflare R2 free tier). Survives total host
     loss; restore is one command.
  2. **Local pull-backup**: cron/launchd script on the Mac hits an
     authenticated `/api/export` endpoint and stores timestamped snapshots in
     `backups/` (same convention as the 2026-06-27 Supabase export).

## Open decisions (owner must call these before Phase 1)

1. **Demo strategy** — options:
   - **(Recommended) Per-visitor ephemeral board**: a `DEMO_MODE` env flag;
     each visitor gets their own throwaway SQLite DB keyed by a random cookie,
     seeded with a realistic board + weeks of fabricated event history so the
     time-machine scrubber has something to show immediately. TTL cleanup
     (e.g. delete DBs idle > 24h). No accounts, no login wall, nothing between
     a recruiter and the demo. This is *isolation*, not user scoping — the
     owner's local single-user mode stays untouched; demo code paths are
     gated behind the flag.
   - Shared public sandbox board, auto-reset hourly: simplest, but visitors
     see each other's edits — messy first impression. Not recommended.
   - Revive Supabase + demo account: most work, contradicts the local-first
     pivot, adds a login wall. Not recommended.
2. **Stale docs**: fix the outdated "not yet committed" note in
   PROJECT_STATE.md as part of Phase 0? (Trivial, recommended.)
3. **`.claude/`**: gitignore it or delete it before the repo goes public.
4. **License**: public repo needs one (MIT recommended for portfolio).
5. **Repo visibility**: is the GitHub repo public already, or does it need to
   be created/flipped?

## Phases

### Phase 0 — Preflight on owner's machine (~30 min)
- [ ] `npm run build` + `node lib/timetravel.test.ts` pass locally (confirms
      what the sandbox couldn't).
- [ ] Owner tests the two "awaiting owner test" features (time-machine
      scrubber, multi-select drag) — they're committed, so this is
      acceptance, not a commit gate.
- [ ] Update PROJECT_STATE.md: remove stale "not yet committed" note; record
      this plan.
- [ ] Resolve `.claude/` (gitignore or delete).
- [ ] Add LICENSE.

### Phase 1 — Demo mode (~0.5–1 day) _[first code change — needs approval]_
- [ ] `DEMO_MODE` env flag. When off, app behaves exactly as today.
- [ ] Per-visitor DB: random ID in an httpOnly cookie → `data/demo/<id>.db`,
      created on first request by the existing idempotent schema bootstrap in
      `lib/db.ts` (no new migration machinery).
- [ ] Seed script: realistic board (all five lists populated) + fabricated
      `item_events` history spanning ~3 weeks, inserted **with triggers
      disabled/bypassed the same way the backup importer does** — history
      must look organic so scrubbing is instantly compelling.
- [ ] Guardrails: cap items per board, cap DB file size, TTL sweep of idle
      demo DBs, basic rate limit on writes. A small "demo — resets after
      24h idle" banner.
- [ ] Tests: seed determinism + reconstruction over seeded history; existing
      tests keep passing with flag off.

### Phase 1b — Single-owner auth + export (~0.5 day)
- [ ] `/login` route + session cookie checked against `OWNER_SECRET` env var
      (constant-time compare; httpOnly, secure, long-lived session). Rate-limit
      login attempts.
- [ ] Routing rule: valid owner session → owner DB (`/data/owner/wm.db`);
      no session → demo path from Phase 1. Local dev with the flag off is
      untouched — no login, same behavior as today.
- [ ] `GET /api/export` (owner-auth only): consistent snapshot via
      better-sqlite3 `db.backup()` (never copy a live `.db` file — WAL).
      Returns the SQLite file; timestamped filename.
- [ ] Migration: one-time import of the current local `data/wm.db` into the
      hosted owner DB at cutover (Phase 2), after which hosted is primary.

### Phase 2 — Deploy + durability (~0.5–1 day)
- [ ] Dockerfile (node:22-slim, `npm ci`, build, run `next start`;
      better-sqlite3 compiles in-image). `.dockerignore` mirrors gitignore +
      `data/`, `backups/`, `ai/`.
- [ ] Fly.io (or Railway — owner's call, both fine): 1 small instance,
      volume mounted at `/data` for demo DBs, `DEMO_MODE=1`.
- [ ] Health check route; verify cold start acceptable on the smallest tier.
- [ ] Custom subdomain if owner has a domain (e.g. `wm.<domain>`), else the
      platform URL is fine.
- [ ] **Litestream**: add to the image, replicate `/data/owner/wm.db` →
      Cloudflare R2 bucket. On boot, `litestream restore -if-db-not-exists`
      so a fresh volume self-heals from the bucket. Verify a full
      delete-volume → restore drill once before cutover.
- [ ] **Local pull-backup**: launchd/cron script on the Mac calling
      `/api/export` daily → `backups/<stamp>/wm.db`, keep last N. (Script can
      live in `scripts/`; secret read from the Mac keychain or a local env
      file, never committed.)
- [ ] **Cutover**: import local `data/wm.db` into the hosted owner DB, verify
      counts match (items/events), confirm Litestream is replicating, then
      hosted is primary. Keep the local file as a frozen pre-cutover backup.
- [ ] Smoke test from a clean browser: land → seeded board → scrub time
      machine → drag cards → open card history. That's the recruiter path.
      Then the owner path: login → real board → export endpoint works.

### Phase 3 — Repo polish (~0.5 day)
- [ ] README restructure for a recruiter skim: 1-paragraph pitch → **GIF of
      the time-machine scrubber** (the money shot; record after deploy) →
      live demo link → "how time travel works" architecture section (event
      log, triggers, `reconstructBoardAt`) → local quickstart.
- [ ] GitHub Actions CI: `tsc --noEmit`, `node lib/timetravel.test.ts`,
      `next build` on push. Green badge in README.
- [ ] Screenshots (board + card history panel) alongside the GIF.
- [ ] Repo metadata: description, topics, pinned on profile.

### Phase 4 — Supporting cast (~1–2 hrs, no hosting)
- [ ] `expert` and `ableton-library` as pinned repos with skim-ready READMEs
      (ableton's is already strong; expert's is close). No deploys.
- [ ] Optional later: 60–90s screen recording for ableton-library (desktop
      app — video is its only demo path).

### Phase 5 — Final verification
- [ ] Fresh-clone test on a clean machine/container: README quickstart works
      exactly as written.
- [ ] Incognito walk of the live demo following only the README.
- [ ] Ask one person to try the demo link cold and narrate what they see.

## Risks

- **Demo DB growth/abuse**: mitigated by caps + TTL sweep (Phase 1); volume
  is small and disposable.
- **Native module on deploy host**: build in Docker, not on the host — the
  Dockerfile is the fix.
- **Seeded history looks fake**: hand-tune the seed script's timestamps
  (bursts, gaps, evenings) — worth the extra 30 minutes.
- **Owner secret leaks**: single secret guards the real board — use a strong
  one, rate-limit `/login`, rotate if ever unsure. Blast radius is one
  board, and Litestream + local snapshots make it recoverable.
- **Silent backup failure**: verify restores, not just backups — the Phase 2
  restore drill, and occasionally open a pulled local snapshot.
- **Scope creep**: this plan deliberately excludes **multi-user** auth,
  two-way local↔hosted sync, mobile, and the AI-review features — product
  roadmap, not portfolio blockers. (Single-owner auth is IN scope per the
  2026-07-02 decision.)

## Effort

~3–4 focused days end-to-end: Phase 0 (30 min) → 1 (0.5–1d) → 1b (0.5d) →
2 (0.5–1d) → 3 (0.5d) → 4 (1–2h) → 5 (1h).
