# Plan: AI weekly review over the event stream

_Created 2026-07-03 · **Revised 2026-07-07** (Anthropic-native per owner call; reconciled
with shared boards + custom columns) · **Revised 2026-08-30** (owner calls, twice: the review is a
WM thing that assistant + brain consume via API — and the hosted WM app itself stays
**AI-free**: it's a free-tier Render app with no key, so generation runs on the owner's
Mac via the Claude-CLI/local-model stack the data-heavy apps already use; see §8b, which
supersedes §1/§3's in-app generation) · Status: BUILT 2026-08-30 per §8b — owner
green-lit all five gates at the recommended defaults; merged to main, awaiting owner
eyeball + first real generation (needs the deploy for the POST leg)._

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
3. **Generation moved off the server** (owner call 2026-08-30). WM has no AI integrated
   and runs on Render's free tier; the owner's data-heavy apps (assistant, brain) do their
   LLM work on the Mac — Claude CLI and Ollama, not a metered key in a hosted env. So v1
   has **no in-app Generate button and no `ANTHROPIC_API_KEY` in WM at all**: a script on
   the Mac builds the digest from the verified daily backup snapshot, generates via the
   CLI, and POSTs the finished markdown to WM. §§1, 3, and 8 below describe the earlier
   in-app variant and stay for the record; **§8b is the build shape.**

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

## 8b. Build shape (rewritten 2026-08-30) — generation on the Mac; WM stores + serves

**WM never calls a model.** The flow is pull → generate locally → push, all from the
owner's machine, on the rails that already exist:

1. **Digest input = the daily backup.** `scripts/pull-backup.sh` already lands a
   verified full snapshot in `backups/pull/<stamp>/wm.db` — `item_events`, column-label
   history, `actor_id` and all. The generator runs the pull first (or takes today's
   snapshot), so **no history-exposing endpoint is ever added to the hosted app**, and
   the backups become load-bearing instead of write-only.
2. **`scripts/weekly-review.mjs` (this repo — the digest logic lives next to the
   schema it reads):** opens the snapshot read-only, builds the §2 digest
   (`lib/ai/digest.ts` still gets written, pure and unit-tested — it just runs
   locally), then generates via **`claude -p`** (CLI subscription, no per-token bill)
   with an Ollama fallback (`REVIEW_MODEL=ollama:<model>`) — the assistant's exact
   provider pattern. §1's SDK-vs-fetch question dissolves: the provider is a child
   process, and WM's `package.json` gains zero LLM deps.
3. **`POST /api/review`** — the one new hosted route: accepts markdown (`BRAIN_TOKEN`
   via `brainBearerOk`, size-capped, owner's active board), writes the review sentinel
   (`list='review'`), and the details trigger journals it — the time machine remains
   the archive of every review. Unset token ⇒ the route doesn't exist (the
   `/api/context` pattern).
4. **`GET /api/review`** (same gate): `{ board, generatedAt, markdown }` from the
   sentinel, so the assistant's brief can grow a "This week" row beside its Board
   section and brain phase 4 (parked) can later read the review's text — neither ever
   sees raw `item_events`. A separate route, not folded into `/api/context`, whose
   ~2KB current-items contract is load-bearing for both consumers.
5. **No MCP server in WM.** The brain already runs one (`brain/mcp/server.mjs`) and
   the assistant has its own tool registry; each wraps the GET as a read-only
   `wm_review` tool in its own repo. WM stays an HTTP app; MCP lives at the edges.
6. **Scheduling stays on the Mac** — the assistant's `dailyAt()` + a `getDay() === 0`
   Sunday gate (the `reflect.mjs` pattern) shelling the script, or a weekly launchd
   plist beside the backup's. Scheduled, not always-on; nothing hosted ever schedules
   anything.

The rendering half of §4/§8 survives unchanged: the board shows the review in a slim
`review` slot next to the Note, read-only markdown via `components/Markdown.tsx` — WM
displays the intelligence; it just doesn't manufacture it.

## 9. Open questions for the owner (green-light gates)

_(Rewritten 2026-08-30 for the §8b shape — the old SDK/key/billing gates dissolved with
in-app generation; they're in git history.)_

1. **Generator home?** `scripts/weekly-review.mjs` in this repo (recommended — the
   digest logic stays next to the schema and tests it reads; the assistant merely
   schedules/shells it) vs a module inside the assistant. Default: this repo.
2. **Model path:** `claude -p` via the CLI by default, `REVIEW_MODEL` env to point at
   an Ollama model instead? Default: CLI, Ollama as the offline fallback.
3. **Window:** trailing 7 days from the run (simplest) vs Monday-anchored weeks?
   Default: trailing 7 days.
4. **Scheduling host:** assistant `dailyAt()` Sunday gate, a weekly launchd plist
   beside the backup's, or manual-only for the first few weeks? Default: manual-only
   first — feel the output before automating it.
5. **Routes in v1:** ship `POST` + `GET /api/review` together (one small route file;
   the brief can consume immediately) or POST-only first? Default: both together.

## 10. Later phases (backlog, not now)

- **Scheduled generation** — superseded by §8b (2026-08-30): the assistant's existing
  `dailyAt()` scheduler (or a weekly launchd plist) runs the generator script on
  Sundays. The old GitHub-Actions-cron and Managed-Agents sketches survive only in
  this file's git history.
- **Auto-triage** — suggest a column for each Brain Dump card (one structured-output call).
- **"Ask your history"** — free-form Q&A over a date-ranged digest. This is where **prompt
  caching** earns its keep: cache the digest prefix once, ask many questions cheaply.
