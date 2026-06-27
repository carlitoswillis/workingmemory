# Working Memory

A board for what's on your mind — **now, and everything it used to be.** Capture
thoughts, sort them across a few lists, check off what's done — and because every
change to every card is recorded, you can **time-travel** the whole board to any past
moment and replay any card's history.

Built to systematize the messy running note most people (me) keep: today's priorities,
what you're focused on, what's parked, and a raw brain-dump inbox. It's a product for
real users — the wedge vs. Trello/Notion/Linear is the thing they don't do: a queryable
memory of your attention (and, soon, AI on top of it).

## Lists

| List | What goes here |
|---|---|
| **Today** | What you're actually doing today |
| **Focus** | Currently on your mind / in progress |
| **Waiting / Later** | Parked — not now, but don't forget |
| **Backlog** | Someday / maybe |
| **Brain Dump** | Capture now, sort later |

## What it does

- **Thin, low-key cards** — a card is one wrapping line (recency-tinted left edge ·
  checkbox · title). Click a card to open a **detail panel** for easy editing: title,
  details/notes, move-to-list, archive, timestamps, and the full history.
- **Time travel** — every edit, move, complete, reopen, and archive is logged. Open the
  🕰 time machine, pick a past date, and the board re-renders as it was then.
- **Drag-and-drop** — reorder cards within a list, and drag the column grips to rearrange
  the board (your column order is saved per account).
- **Daily-refreshing tasks** — mark a card *Repeat daily*; it counts as done only for
  today and quietly resets at your local midnight (nothing is deleted).
- **Per-account & private** — each user only ever sees their own board, enforced in the
  database by row-level security.

## The core idea: nothing is ever lost

Every item is append-only at heart. Editing text, moving lists, completing, reopening,
archiving — each appends a row to an `item_events` log instead of overwriting. **This
logging is done by Postgres triggers**, so every client (this web app, future mobile
apps, any direct API call) records history automatically and can't forget. The board
shows the *current* state; history and time-travel replay the rest. (See
`ai/ARCHITECTURE.md`.)

## Getting started

You need a Supabase project (the free tier is plenty). Then:

```bash
# 1. point the app at your project
cp .env.local.example .env.local      # set NEXT_PUBLIC_SUPABASE_URL + anon/publishable key

# 2. apply the schema (Supabase SQL editor, or psql against your DB)
#    run each file in supabase/migrations/ in order (0001 → 0004)

# 3. run it
npm install
npm run dev                            # → http://localhost:3000
```

Sign up with an email + password and you're on your own board. (If you keep email
confirmation on in Supabase, click the link it sends before signing in.)

> Dev tip: if the app ever 404s everything or won't start, clear the Next cache:
> `rm -rf .next && npm run dev`.

## Stack

- **Next.js (App Router) + React 18 + TypeScript** — server components + server actions
- **Supabase** — Postgres (item + append-only event store, history written by triggers),
  Auth (accounts), and row-level security (per-user isolation). The same `supabase-js`
  client will power the future mobile apps.
- **@dnd-kit** — accessible drag-and-drop (cards + columns, desktop + touch)
- **Tailwind CSS** + **Fraunces / Space Grotesk** — the dark, matte "Nocturne" look

## Status & roadmap

See `ai/PROJECT_STATE.md` for the live log. **Next up: cross-list drag-and-drop** (drag a
card between columns). Then: an **AI weekly review** over your event stream, streaks for
daily tasks, deploy (Vercel), and mobile (React Native, same Supabase + RLS).
