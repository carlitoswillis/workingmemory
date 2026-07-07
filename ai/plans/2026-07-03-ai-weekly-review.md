# Plan: AI weekly review over the event stream

_Created 2026-07-03 · **Revised 2026-07-07** (Anthropic-native per owner call; reconciled
with shared boards + custom columns) · Status: PROPOSED — awaiting owner sign-off before
any code._

The backlog's "real differentiator": point an LLM at `item_events` and generate the
weekly review that writes itself. This is where the append-only history stops being a
feature and becomes the moat — nobody else has your board's event log to summarize.

## What changed since the 2026-07-03 draft

Two owner/architecture updates fold in here:

1. **Anthropic-native only** (owner call 2026-07-03, recorded in PROJECT_STATE): drop the
   "model-agnostic, default to OpenRouter" framing from the original §1. Build the native
   Anthropic adapter and nothing else — but keep a tiny provider interface so a second
   adapter stays a ~40-line add if it's ever wanted. No vendor-neutrality tax up front.
2. **Shared boards + custom columns shipped 2026-07-07.** The review is now **per board**
   (scope = `board_id`), the digest reads **user-created columns** (not the old hardcoded
   list), and — the nice part — `item_events.actor_id` means a review of a shared board
   can say **who** did what ("you cleared 4 cards; @alex moved the taxes card to Waiting").

## What v1 does (and doesn't)

**Does:** one button on a board (a member of that board), that generates a review of the
last 7 days — completed / moved / stuck / new brain-dumps / daily-task streaks, plus a
short "what this week was about" narrative — and saves it where the time machine journals
it. On a shared board it attributes actions to members.

**Doesn't (deferred):** scheduling, auto-triage of brain dumps, "ask your history" chat,
rich styling. Ship the loop first; everything else layers on the same digest.

## Design

### 1. Provider shape — thin interface, one real adapter

One tiny interface in `lib/ai/provider.ts`, so the call site never imports a vendor:

```ts
export interface LlmProvider {
  complete(req: { system: string; prompt: string; maxTokens: number }): Promise<string>;
}
```

**One adapter: `lib/ai/anthropic.ts`.** Two ways to call the Messages API — pick at build:

- **Official SDK (`@anthropic-ai/sdk`) — recommended by the current Claude API guidance.**
  `npm i @anthropic-ai/sdk`; `new Anthropic()` reads `ANTHROPIC_API_KEY`; one
  `client.messages.create({ model, max_tokens, system, messages })` call. Gives typed
  errors, retries, and streaming for free.
- **Raw `fetch` to `POST https://api.anthropic.com/v1/messages`** (~40 lines) — honors this
  repo's lean-deps ethos (we took no SDK for S3/Litestream either). Headers:
  `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`.

  Owner picks (see §11 Q1). Default recommendation: **the SDK** — it's one dependency and
  it removes a class of hand-rolled HTTP bugs; the fetch path is the fallback if you'd
  rather stay zero-dep.

**Model + params (verified against the current Claude API reference):**
- Default model **`claude-opus-4-8`** (Anthropic's current flagship; 1M context, $5/$25 per
  1M in/out). This is a short summarization call over a tiny payload, so cost is **cents at
  most** per review. The model is env-configurable (`AI_MODEL`) so you can drop to
  `claude-haiku-4-5` ($1/$5) if you want it cheaper — your lever, not a silent downgrade.
- `max_tokens: ~1200` (a 250–400-word review; non-streaming is fine at this size — streaming
  only matters above ~16k).
- Thinking: leave it **off** for v1 (omit the `thinking` param). A weekly summary isn't a
  reasoning-hard task; if quality wants a nudge, `output_config: { effort: "low" }` is the
  cheap first dial before turning thinking on.
- Prompt caching: not worth it for a **single** weekly call (caching pays off on repeats).
  It becomes valuable for the "ask your history" phase (many questions over one cached
  digest) — noted there, not built now.

**Config is pure env — feature is OFF unless set** (same pattern as `OWNER_SECRET`):

```
ANTHROPIC_API_KEY=sk-ant-...        # unset ⇒ no button, action returns early
AI_MODEL=claude-opus-4-8            # optional override
```

No key ever reaches the client — generation is a server action.

### 2. Digest builder — `lib/ai/digest.ts` (pure, board-scoped, actor-aware)

`buildWeeklyDigest({ items, events, columns, members }, from, to)` → compact plaintext:
per-item event timelines within the window, column moves (using the board's **live column
labels**, and the label map for since-deleted columns — same `listLabels` the UI uses),
completions with recurrence/streak context, created/archived, and the current board shape.
On a shared board, annotate each event with `actor_id → @username` (from `members`), so the
model can attribute actions; on a personal/local board actors are null and it reads as "you".

Pure + deterministic ⇒ unit-testable with no network (`lib/ai/digest.test.ts` joins the
node suite, like `boards.test.ts`). Single-board data is tiny; if it ever isn't, truncate
oldest-first with a note in the prompt. Inputs come from the existing
`getTimelineData(db, boardId)` + `getLists` + `getMemberUsernames` — no new queries.

### 3. Generation — a server action, board-scoped + membership-gated

`generateReviewAction(boardId)` in `app/ai/actions.ts`:
1. `getBoardContext(boardId)` — already verifies membership (404s a non-member); no key set
   ⇒ return early (the button isn't even rendered).
2. Build the digest from the board's `getTimelineData` + columns + members.
3. One `provider.complete()` call. Errors surface in the UI; **nothing is saved on failure.**
4. Save (see §4). Rate-limit like login (it costs real money) — add an `ai:<userId>` bucket
   to the existing `middleware.ts` token bucket, or a per-board cooldown in the action.

Who can press it: **any member of the board** (they can already read all its data). The API
bill accrues to the single configured key (yours) — fine for a personal/small-team tool;
flagged in §11 Q2 in case you want to restrict it to the board **owner**.

### 4. Storage — the daily-note pattern, per board

One pinned sentinel item per board: `list='review'`, body in `details`, scoped by
`board_id`. Each generation **rewrites** it; the details-edit trigger journals every version
(now with `actor_id` = whoever generated it), so **the time machine is the archive of all
past reviews** — zero new tables, zero schema change, and reviews are themselves
time-traveleable (pleasingly recursive). It renders read-only-ish in a slim column slot next
to the Note, markdown via the existing `components/Markdown.tsx`. `getItems`/`groupItems`
already special-case sentinel lists (`note`) — `review` gets the same treatment (excluded
from the draggable columns).

### 5. Prompt (sketch — tuned during build)

System (frozen, cache-friendly): "You write a weekly review of a personal kanban board from
its change log. Be concrete and personal; name specific items; call out cards stuck in
Waiting and daily-task streaks; on a shared board attribute actions to the named people;
250–400 words; markdown; **no invented facts** — only what the log shows." User: the digest
+ the previous review's text (for week-over-week continuity).

## 6. Reconciliation with shared boards + custom columns (what the 2026-07-03 draft missed)

- **Scope is `board_id`, not the user.** Everything above threads the board id: the action
  takes it (like every other action now), the digest reads the board's events, the review
  sentinel is board-scoped. Local/demo (board_id null) still work — the digest just has no
  actors and reads in the first person.
- **Columns are data.** The digest resolves list ids through the board's `lists` table
  (live + soft-deleted labels), not a hardcoded const — so a review names your real columns
  ("moved to Reading") and survives a renamed/deleted column.
- **Attribution is free.** `item_events.actor_id` already lands (v2 triggers, shipped). The
  digest maps it to usernames; no schema work.
- **Demo boards never see it.** The button is gated on `ANTHROPIC_KEY` **and** a real
  membership; demo visitors have neither.

## 7. Owner constraints honored

- **No always-on background process.** v1 is button-triggered — no scheduler, no daemon.
  (A later phase can add a GitHub-Actions weekly cron that POSTs to an authed endpoint —
  still no long-running process on the box.)
- **No surprise hosted dependency.** The only new dep is the Anthropic client (or zero, on
  the fetch path). Unset key ⇒ the whole feature is inert.
- **Data safety.** Reviews are additive (a new sentinel item + journaled edits); nothing
  existing is touched; the digest is read-only over the event log.

## 8. Steps (≈ half-day)

1. `lib/ai/provider.ts` + `lib/ai/anthropic.ts` (+ `provider.test.ts` with a stub adapter —
   no network in tests).
2. `lib/ai/digest.ts` + `lib/ai/digest.test.ts` (pure; assert actor attribution + column
   labels + window bounds).
3. `app/ai/actions.ts` — `generateReviewAction(boardId)`; review sentinel create/rewrite;
   membership + key gate; rate limit.
4. Board rendering: a `review` slot next to the Note; a "Generate weekly review" button
   (rendered only when the key is set); error + loading states.
5. Verify: `tsc`, node suite (new digest + provider tests), prod build; one real end-to-end
   generation against a live key on a scratch board; confirm nothing saves on a forced error.
6. Docs: PROJECT_STATE completed entry + README env line (`ANTHROPIC_API_KEY`, `AI_MODEL`).

## 9. Open questions for the owner (green-light gates)

1. **SDK or fetch?** `@anthropic-ai/sdk` (recommended — typed errors/retries/streaming, one
   dep) vs a ~40-line zero-dep `fetch` adapter (matches the repo's no-SDK ethos). Default: SDK.
2. **Who can generate — any board member, or board owner only?** The bill accrues to one key
   (yours). Default: any member, rate-limited; restrict to owner if cost worries you.
3. **Model default `claude-opus-4-8`, env-overridable to `claude-haiku-4-5` for cost?**
   (This is a cheap call either way; opus is the quality default.)
4. **Window:** trailing 7 days from the button press (simplest) vs Monday-anchored weeks?
   Default: trailing 7 days.

## 10. Later phases (backlog, not now)

- **Scheduled generation** — a GitHub-Actions weekly cron → authed `POST /api/review` (still
  no daemon). Or, if Managed Agents ever enters the picture, a scheduled deployment — but
  that's a hosted dependency the owner has so far declined.
- **Auto-triage** — suggest a column for each Brain Dump card (one structured-output call).
- **"Ask your history"** — free-form Q&A over a date-ranged digest. This is where **prompt
  caching** earns its keep: cache the digest prefix once, ask many questions cheaply.
