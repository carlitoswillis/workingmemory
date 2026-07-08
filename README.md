# Working Memory

**A board for what's on your mind — and a time machine for what used to be.**

[![CI](https://github.com/carlitoswillis/workingmemory/actions/workflows/ci.yml/badge.svg)](https://github.com/carlitoswillis/workingmemory/actions/workflows/ci.yml)

**Live demo: [workingmemory.onrender.com](https://workingmemory.onrender.com)** — no
signup; you get your own throwaway board, pre-loaded with three weeks of history so
the time machine has somewhere to go. (Free-tier hosting: first load after an idle
spell takes ~a minute. It's warming up. Think of it as the app remembering.)

## Why this exists

For years I kept one perpetually rewritten note: today's priorities at the top,
things I was waiting on, a brain-dump section at the bottom, recurring checklists
wedged in between. It worked — right up until I asked it a question it couldn't
answer: *what was I actually worried about three weeks ago?* The note only ever
knew **now**. Every rewrite quietly destroyed the previous me.

Todo apps don't fix this. Trello, Notion, Linear — they're all excellent at
*current state* and amnesiac about everything else. Done items vanish, edits
overwrite, and the history of your attention — what occupied you, for how long,
what got stuck — is the exhaust they throw away.

Working Memory keeps the exhaust. It's a small kanban-ish board (Today · Focus ·
Waiting/Later · Backlog · Brain Dump, plus a pinned daily note) where **every
change to every card is recorded in an append-only event log**. The board shows
now; the 🕰 time machine scrubs backward through every moment the board ever
changed and re-renders it as it was — read-only, drill-down and all.

Some one-liners for what that buys you:

- **Your attention, queryable.** "What was on my mind before vacation?" is a
  scrub, not an archaeology dig.
- **The daily note is a journal you never had to keep.** You just rewrite one
  note each morning; the time machine keeps every version.
- **Done doesn't mean gone.** Completing, archiving, editing — nothing is
  destructive, ever. The event log is immutable by construction.
- **The moat is the log.** Eventually: AI over your event stream — a weekly
  review that writes itself. The substrate is already being laid down.

## What it does

- **Thin, low-key cards** — one wrapping line (recency-tinted edge · checkbox ·
  title). Click for a detail panel: notes, move, archive, sub-cards, full history.
- **Time travel** — a scrubber whose ticks are the real moments the board
  changed. Drag it and the board re-renders live; click into past cards, even
  their sub-cards. The past is strictly read-only.
- **Sub-cards** — cards within cards, arbitrary depth, each with its own history.
- **Daily-refreshing tasks** — "repeat daily" cards reset at your local midnight
  without deleting anything (a daily task is only "done" if done *today*).
- **Multi-select drag, undo, cross-list drag** — ⌘-click to select several cards
  and move them as a block; ⌘Z takes it back.
- **Demo mode** — `DEMO_MODE=1` gives every visitor an isolated, rate-limited,
  auto-expiring board seeded with fabricated-but-consistent history.

## How nothing is ever lost

History isn't an app feature that can be forgotten in some code path — it's
**SQLite triggers**. Every insert/update on `items` appends to `item_events` at
the database layer, so any client (this app, a script, future mobile) records
history just by writing. Time travel is a pure function that replays events
backward from now. See [`ai/ARCHITECTURE.md`](ai/ARCHITECTURE.md).

## Run it locally

Zero config, zero accounts, zero cloud. Your data is a SQLite file on your disk.

```bash
npm install
npm run dev        # → http://localhost:3000, data lives in ./data/wm.db
npm run dev:demo   # the hosted-demo experience (per-visitor ephemeral boards)
npm test           # time-travel, demo-seed, auth, streaks, and accounts suites
```

## Accounts (hosted)

The hosted instance has open signup: create a username + password at `/signup`
and you get a persistent board of your own (the demo boards stay throwaway for
anonymous visitors). All accounts live in one replicated SQLite file, scoped
per-user in every query; sessions are stateless HMAC cookies. No email is
collected — which also means **no password reset**, so write it down. Local
mode (`npm run dev`) remains account-free.

## Deploy your own (the $0 stack)

The hosted instance runs the `Dockerfile` on Render's free tier with **no
persistent disk** — by design. [Litestream](https://litestream.io) continuously
replicates the owner's DB to a Backblaze B2 bucket and restores it on every
boot, so the disk is disposable and **every deploy is a restore drill**. Demo
boards are deliberately not replicated (throwaway by design).

- `render.yaml` — free tier blueprint (what the live demo runs)
- `fly.toml` — the ~$3/mo no-cold-start alternative
- `litestream.yml` — Litestream retention config (baked into the image); keeps
  the B2 bucket bounded so restores stay cheap
- `ai/plans/2026-07-03-free-deploy-runbook.md` — the full runbook, including the
  failures you'll hit if you deviate (schemeless replica URLs; slim images
  shipping no CA certs) and the Class C incident write-up below

**One catch worth knowing on the free tier:** the diskless design means every
cold start makes Litestream re-list the bucket and open a fresh generation. On a
service that spins down every 15 idle minutes, that listing churn can blow past
Backblaze's free **Class C** (`s3_list_objects`) allowance. The fix is to stop
the cold starts — an external uptime ping (e.g. UptimeRobot → `/api/health`
every 5 min) keeps the container warm so restore only runs on real deploys.
`litestream.yml`'s explicit retention is the backstop. (Fly.io's persistent disk
sidesteps the whole thing.) The daily Mac backup is *not* involved — it hits
`/api/export`, never the bucket.

Your data stays yours: `GET /api/export` streams a consistent snapshot of the
main DB (operator bearer token only, since it now holds every account),
`PUT /api/import` migrates one in (integrity-checked before swap), and
`scripts/push-local-db.sh` / `scripts/pull-backup.sh` move the file either
direction. A daily launchd job pulls a verified backup to my Mac — the cloud is
the working copy, not the only copy.

## Stack

- **Next.js 14 (App Router) + React 18 + TypeScript** — server components + actions
- **better-sqlite3** — one file per board; history via triggers in `lib/schema.ts`
- **Litestream + Backblaze B2** — streaming replication, restore-on-boot
- **@dnd-kit** — accessible drag-and-drop (cards, columns, multi-select)
- **Tailwind CSS + Fraunces / Space Grotesk** — the matte "Nocturne" look

## Status & roadmap

Live log in [`ai/PROJECT_STATE.md`](ai/PROJECT_STATE.md). Next up: capture-from-
anywhere (email → daily note via webhook), streaks for daily tasks, an archive
view, and the big one — **AI over the event stream**.

MIT © Carlitos Willis
