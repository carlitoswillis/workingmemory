# Plan: AI weekly review over the event stream (model-agnostic)

_Created 2026-07-03 · Status: PROPOSED — awaiting owner sign-off before any code._

The backlog's "real differentiator": point an LLM at `item_events` and generate
the weekly review that writes itself. Owner constraint (2026-07-03): **must be
model-agnostic** — not tied to Claude or any single vendor. Owner constraint
(standing): **no always-on background processes**.

## What v1 does (and doesn't)

**Does:** one button, visible only to the owner, that generates a review of the
last 7 days (completed / moved / stuck / new brain-dumps / daily-task streaks,
plus a short "what this week was about" narrative) and saves it where the time
machine can journal it.

**Doesn't (deferred):** scheduling, auto-triage of brain dumps, "ask your
history" chat, styling beyond a plain panel. Ship the loop first.

## Design

### 1. Provider abstraction — how "model-agnostic" is satisfied

A single tiny interface in `lib/ai/provider.ts`:

```ts
interface LlmProvider {
  complete(req: { system: string; prompt: string; maxTokens: number }): Promise<string>;
}
```

Two fetch-based adapters, **zero SDK dependencies** (matches this repo's
lean-deps style — we didn't take an SDK for S3 either):

- **`openai-compatible`** — POST `{base_url}/chat/completions`. This one
  adapter covers OpenAI, OpenRouter (which proxies Claude/Gemini/Llama/...),
  Groq, Mistral, DeepSeek, Together, and **Ollama on localhost ($0, fully
  local — the spiritual successor to the local-first pivot)**.
- **`anthropic`** — POST `api.anthropic.com/v1/messages` (native shape differs
  enough to warrant its own ~40 lines; models like `claude-opus-4-8`).

Selection is pure env config — swap vendors by editing env vars, no code:

```
AI_PROVIDER=openai-compatible | anthropic
AI_BASE_URL=https://openrouter.ai/api/v1   (or http://localhost:11434/v1, etc.)
AI_API_KEY=...
AI_MODEL=anthropic/claude-opus-4-8          (whatever the provider names it)
```

Unset ⇒ the feature is off: no button, `POST` returns 404 (same pattern as
`OWNER_SECRET`). No key ever reaches the client.

### 2. Digest builder — `lib/ai/digest.ts` (pure function)

`buildWeeklyDigest(items, events, from, to)` → compact plaintext: per-item
event timelines, list moves, completions (with recurrence context), created/
archived, current board shape. Pure + deterministic ⇒ unit-testable without
any network (`lib/ai/digest.test.ts` joins `npm test`). Single-user data is
tiny; if it ever isn't, truncate oldest-first with a note in the prompt.

### 3. Generation — server action, owner-gated

"✨ Weekly review" button (owner board only, `DEMO_MODE` demo visitors never
see it) → server action: `isOwnerRequest()` check → build digest → one
`provider.complete()` call → save. Rate-limit like login (it costs money).
Errors surface in the UI; nothing is saved on failure.

### 4. Storage — the daily-note pattern

One pinned sentinel item, `list='review'`, body in `details`. Each generation
**rewrites** it; the details-edit trigger journals every version, so **the time
machine is the archive of all past reviews** — zero new tables, zero schema
change, and reviews are themselves time-traveleable (pleasingly recursive).
Rendered read-only-ish in its own slim column slot next to the Note, markdown
displayed as plain text for now (Richer Details backlog item upgrades it later).

### 5. Prompt (sketch — tuned during build)

System: "You write a weekly review of a personal kanban board from its event
log. Be concrete and personal; name items; call out stuck Waiting items and
streaks; 250–400 words; no invented facts." User: the digest + the previous
review's text (for continuity).

## Steps (≈ half-day)

1. `lib/ai/provider.ts` (+ `provider.test.ts` with a stub `fetch`) — both adapters.
2. `lib/ai/digest.ts` + tests.
3. Server action + review sentinel item + board rendering.
4. Wire button, error states, rate limit.
5. Verify end-to-end locally against **Ollama** (proves the agnostic path with
   $0) and once against a hosted provider; tsc, `npm test`, prod build.
6. Owner sets `AI_*` env vars on Render; docs pass (PROJECT_STATE, README line).

## Open questions for the owner

1. **Default provider to document first?** My suggestion: OpenRouter (one key,
   every major model, pay-per-use) with Ollama as the free/local alternative.
2. **Review cadence framing:** strictly "last 7 days" from the button press, or
   Monday-anchored weeks? (v1 suggestion: trailing 7 days — simplest.)
3. OK that v1 has **no schedule** (button only)? A later phase could add a
   GitHub-Actions weekly cron hitting an authed endpoint — still no daemon.

## Later phases (backlog, not now)

- Scheduled generation (GH Actions cron → authed POST).
- Auto-triage: suggest list placement for Brain Dump items.
- "Ask your history": free-form Q&A over a date-ranged digest.
