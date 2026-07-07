# Shared boards with real-time updates — plan, 2026-07-05

Backlog item: "Shared board with real time updates." This is the longest plan in
the repo on purpose — the owner asked for a teaching document, so every decision
explains the alternatives it beat and the general concept behind it. Nothing here
is built; it awaits green-light, and it's big enough that it should land in
phases (§10) with owner checkpoints between them.

---

## 0. What we're building, in one paragraph

Today every account owns exactly one implicit board: "your board" is simply *the
rows in the multi-tenant SQLite file stamped with your `user_id`*. Shared boards
make the board a real, first-class thing: a `boards` row with a name and a
member list, where several accounts can add/edit/move cards on the same columns,
every event in the history log records **who** did it, and when someone else
changes the board while you're looking at it, your screen updates within a
second or two without a manual refresh. Local mode and the anonymous demo are
untouched.

Two big sub-problems, roughly independent, and worth studying separately:

1. **Multi-tenancy shape** (§2–§6): how rows, permissions, and history change
   when a board stops being synonymous with a user.
2. **Real-time transport** (§7–§8): how a server built on request/response
   (Next.js server actions) tells an idle browser "something changed."

---

## 1. The ground we're standing on (read this first)

You can't evaluate the plan without the current architecture in your head:

- **One SQLite file for all accounts** (`DATA_DIR/owner/wm.db`, opened in
  `lib/db.ts#mainDb()`), because Litestream — the thing that makes Render's
  disposable disk survivable — replicates statically configured paths only.
  Anything we design must keep living in this one file.
- **Scoping is the query shape.** `lib/queries.ts` and `app/actions.ts` put
  `user_id IS ?` on every read and `and user_id is ?` on every mutation. There
  is no ORM layer or middleware enforcing isolation — the discipline *is* the
  SQL. The `IS` (not `=`) matters: on local/demo boards `userId` is `null`, and
  in SQL `x = null` is never true while `x IS null` is — so one SQL shape serves
  both the multi-tenant file and the single-user files.
- **History is written by triggers** (`lib/schema.ts#CREATE_TRIGGERS`), never by
  app code. Actions do plain CRUD; the database itself appends to `item_events`.
  This is the product's moat and its most protected invariant.
- **`item_events` has no user_id.** History is scoped *through its item*: every
  read joins `item_events e join items i on i.id = e.item_id` and filters on
  `i.user_id`. Remember this join — shared boards lean on the same move.
- **Sessions are stateless HMAC cookies** (`lib/auth.ts`,
  `v2.<userId>.<exp>.<hmac>`), verified per request in
  `lib/db.ts#getRequestUserId()`. There is no session table; possession of a
  validly signed token *is* the session.
- **The client is optimistic but server-authoritative.** `Board.tsx` keeps
  `itemsByList` in state, mutates it locally on drag/add/move, fires a server
  action, and re-syncs from the server-rendered `items` prop when
  `revalidatePath` re-renders the page. There is already a reconciliation path
  (it's how `temp-*` cards get swapped for real rows) — real-time will reuse it.
- **One Node process, synchronous DB.** better-sqlite3 is *synchronous*: a
  query blocks the (single) JS thread until it returns. That sounds bad and is
  actually the design's superpower: no two queries ever interleave, so there
  are no read-modify-write races inside a request. Hold onto this; it decides
  several arguments below.
- **Owner constraints**: no always-on background processes; no new hosted
  dependencies; hosted on Render free tier (15-min idle spin-down, one
  instance).

---

## 2. Data model: make the board a first-class entity

### The two candidate shapes

**Option A — "share my board":** keep `items.user_id` as the scope and add a
grants table (`board_shares(owner_id, guest_id)`) meaning "guest may act as
owner." Minimal schema churn — but it's a dead end wearing a shortcut's
clothes. A user has exactly one board forever; "a shared board that belongs to
the couple, not to either person" is inexpressible; every future feature
(leaving a board, multiple boards, transfer of ownership) fights the model.
When your identifier means two things (a person *and* their board), you pay for
it at every fork in the road. This is the classic **entity modeling smell**:
if you can't name the thing users talk about ("our board"), your schema is
missing a noun.

**Option B — boards as an entity (recommended):**

```sql
create table if not exists boards (
  id         text primary key,            -- randomUUID()
  name       text not null check (length(name) > 0),
  list_order text,                        -- JSON, the board's column order (see §6)
  created_by text not null references users(id),
  created_at text not null default (strftime(...))
);

create table if not exists board_members (
  board_id  text not null references boards(id) on delete cascade,
  user_id   text not null references users(id) on delete cascade,
  role      text not null default 'member',   -- 'owner' | 'member'
  joined_at text not null default (strftime(...)),
  primary key (board_id, user_id)             -- one membership per (board, user)
);
```

`items` gains `board_id text references boards(id)` (nullable, because local
and demo files have no boards — same trick as `user_id`).

**Every user gets a personal board.** On signup — and via an idempotent
bootstrap for existing users, §9 — we create a board named "Personal" with the
user as owner, and backfill their items' `board_id`. After this, "your board"
stops being a special case: the personal board is just a board with one member.
Collapsing a special case into the general case is the whole payoff of Option B
— from then on there is one code path to test, not two.

`items.user_id` stays but **changes meaning**: it was "whose board is this row
on," it becomes "who created this row" (creator attribution, useful in UI).
The *scoping* column is now `board_id`. This kind of semantic drift is worth
documenting loudly (AGENTS.md) because the column name no longer says what it
means — the alternative, renaming the column, means rewriting every query and
a table rebuild in SQLite (ALTER TABLE RENAME COLUMN exists but churns every
statement anyway); not worth it.

### Why membership is a table, not an array

You could stuff `members: ["id1","id2"]` JSON into `boards`. Don't: you can't
index into JSON for the hot query ("which boards am I in?"), can't hang
attributes on the edge (role, joined_at), and can't enforce uniqueness. The
**junction table** (also: join table, associative entity) is the relational
idiom for many-to-many, and `primary key (board_id, user_id)` gives you the
"no duplicate membership" rule for free, enforced by the engine rather than by
remembering to check.

---

## 3. Authorization: the request's board, resolved once

### The choke-point pattern

Today `getBoardContext()` returns `{ db, userId }` and every query trusts it.
The single most important property of the current design is that **the safe
path is the only path**: actions don't individually decide scoping, they
inherit it from one function. We keep that. The context grows one field:

```ts
export type BoardContext = { db: Database; userId: string | null; boardId: string | null };
```

Resolution, in order:
1. `DEMO_MODE` off → `{ localDb(), userId: null, boardId: null }`. Local mode
   never grows boards UI; the whole file is the board.
2. Demo visitor → per-cookie file, `boardId: null`. Same.
3. Signed-in account → determine the **requested board** (from the URL, §6),
   default to the user's personal board, and **verify membership in the same
   breath**:

```ts
const member = db.prepare(
  "select role from board_members where board_id = ? and user_id = ?"
).get(boardId, userId);
if (!member) notFound();   // not 403 — don't confirm the board exists (§3b)
```

Every read then filters `board_id IS ?` and every mutation carries
`and board_id is ?` — the **exact same NULL-tolerant shape** the codebase
already uses for `user_id`, so `lib/queries.ts` changes are mechanical:
the `{db, userId}` parameter pair becomes `{db, boardId}` (plus `userId` where
attribution needs it). The pure-function shape survives, so the plain-node
test suites keep working against scratch DBs.

Note what we did **not** do: per-query membership subselects
(`board_id in (select ...)`) sprinkled everywhere. Checking membership once at
context-resolution time and then trusting a plain `board_id = ?` is both faster
(one membership probe per request instead of per query) and safer (one place to
audit). The general lesson: **authorization wants a choke point**; scattering it
is how "we forgot the check on this one endpoint" bugs are born.

### 3b. Two security details worth knowing by name

- **404 over 403.** If a non-member requests `/b/<id>`, answer "no such board,"
  not "you may not see this board." A 403 confirms the id exists — an
  **existence oracle** — which turns guessable/leaked ids into reconnaissance.
- **IDOR** (Insecure Direct Object Reference) is the bug class the
  `and board_id is ?` guard on mutations prevents: knowing a card's uuid must
  never be enough to mutate it. The current code has this discipline for
  `user_id`; the refactor must not drop a single guard while swapping the
  column. The membership isolation test suite (§11) exists to catch exactly a
  missed one.

### Roles: keep v1 to two

`owner` (can rename board, invite, remove members, delete board) and `member`
(everything else: full card CRUD). No read-only `viewer` in v1 — it doubles the
authz test matrix for a persona nobody has asked for. Roles are checked in the
actions that need them (`inviteMemberAction`, `renameBoardAction`, …) via the
`role` already fetched during context resolution.

---

## 4. Attribution: teaching the triggers who's acting

The history log must start answering "**who** moved this card?" — on a shared
board, an unattributed event log loses most of its meaning. This is the
subtlest part of the plan.

### The problem

`item_events` rows are written by SQLite triggers, and a trigger can only see
the row being changed (`new.*`, `old.*`) plus database state. It has no idea
which HTTP request — which *user* — caused the UPDATE. Postgres people solve
this with `set_config('app.user_id', ...)` and `current_setting()` in the
trigger; SQLite has no session variables. Options:

**(a) Write events from app code.** Rejected instantly — it abandons the
architecture's core invariant (AGENTS.md: "never log events in app code").
The whole point of DB-driven history is that it *cannot* be forgotten by a
future code path.

**(b) A per-connection context table.** `create temp table _ctx(actor_id)`;
actions set it before mutating; triggers read
`(select actor_id from _ctx)`. This *does* work here — better-sqlite3 is
synchronous, so between "set actor" and "run update" nothing can interleave —
but it's **stateful and invisible**: forget to set it (or to clear it) in one
action and events get silently mis-attributed to the previous request's user.
The failure mode is quiet data corruption, the worst kind.

**(c) Carry the actor on the row (recommended).** Add
`items.touched_by text references users(id)`. Every mutation already goes
through an UPDATE statement; it now also sets `touched_by = ?` with the acting
user. Triggers copy it into the event:

```sql
insert into item_events (item_id, type, field, old_value, new_value, actor_id, at)
values (new.id, 'moved', 'list', old.list, new.list, new.touched_by, ...);
```

Why (c) beats (b): the actor travels **inside the same atomic statement** as
the change it describes. There is no ordering to get wrong, no cross-request
state, no cleanup. And forgetting `touched_by = ?` in some future action
degrades to `actor_id = null` ("unknown"), not to *wrong* attribution —
when you must pick a failure mode, pick the honest one. Bonus: `touched_by`
doubles as a useful "last touched by" fact on the item itself for UI.

`item_events` gains `actor_id text references users(id)` (nullable; every
pre-existing event and all local/demo events are null → rendered as nothing,
exactly like today).

### The trigger-versioning gotcha (a lesson in idempotent migrations)

The schema applies idempotently on every DB open (`openAt()` runs
`CREATE_TRIGGERS` with `create trigger if not exists`). That idiom has a trap
the repo has met twice already (streaks, unarchive): `if not exists` **never
replaces** an existing trigger, so *changing* a trigger's body does nothing on
existing DBs. Previous features dodged this by only ever *adding* triggers with
new names. This time we must **modify** all seven logging triggers (to write
`actor_id`) — and if we simply added `_v2` triggers alongside the old ones,
every change would be logged **twice**.

So `CREATE_TRIGGERS` becomes explicitly versioned:

```sql
drop trigger if exists items_log_insert;     -- v1 names, superseded
drop trigger if exists items_log_text;
-- ...all seven...
create trigger if not exists items_log_insert_v2 after insert on items begin ... end;
```

Drop-then-create is still idempotent (running it twice converges to the same
state — that's all idempotence means), costs microseconds at open, and makes
the file self-migrating: any pre-shared-boards DB that gets opened — including
a restored old backup, which is a first-class scenario here — upgrades itself.
This is the same philosophy as `migrateDb()`'s `pragma table_info` check for
column adds: **migrations must be safe to run against any historical shape of
the file, any number of times**, because with Litestream restore-on-boot you
genuinely don't control which vintage of the file boots next.

---

## 5. History, time travel, and streaks on a shared board

- **Scoping:** every history read swaps its join filter from `i.user_id is ?`
  to `i.board_id is ?`. `getTimelineData()` ships the board's items + events;
  the pure `reconstructBoardAt()` doesn't know or care how many humans
  generated the events — time travel works on shared boards *with zero changes
  to the reconstruction code*. This is the reward for keeping reconstruction
  pure: its inputs got bigger, not different. **Snapshots render read-only
  regardless of role, as today: the past is immutable for everyone.**
- **UI:** the CardPanel timeline and SnapshotCardPanel gain a small
  "· @username" suffix per event when `actor_id` is present (one
  `users`-join in `getHistory`, or a `Map<id,username>` shipped alongside the
  timeline payload — decide at build time by measuring payload size; the map is
  probably smaller since usernames repeat).
- **Streaks/daily tasks:** `completed_on` is a property of the *item*, so on a
  shared board a daily task has one shared check-off and one shared streak —
  "did *we* water the plants today." That's a coherent semantic, it's what the
  data model already says, and v1 documents it rather than fighting it.
  Per-member streaks would need a `(item, user, day)` table — real work, zero
  demand yet. Classic **YAGNI** cut: note the upgrade path, don't build it.

---

## 6. Routing, the switcher, and column order

- **URL = board identity:** `/` stays "your personal board" (and the landing
  page for anonymous visitors — unchanged branch in `app/page.tsx`);
  `/b/<boardId>` renders any other board you're a member of. Making the board a
  URL rather than a cookie means links are shareable ("look at our board"),
  the back button works, two tabs can show two boards, and the server can
  resolve the board from the request alone. State that describes *what you're
  looking at* belongs in the URL; cookies are for *who you are*. The dynamic
  segment is a plain App Router `app/b/[boardId]/page.tsx` that renders the
  same `BoardScreen` with a `boardId` prop.
- **Switcher:** a low-key dropdown in the board header (near the `@username`
  pill): lists your boards (`board_members join boards`), marks the current
  one, `+ New board`, and per-board a members line. Board management (rename,
  invite by username, remove member, leave, delete) can live in a small panel
  off that dropdown — matching the existing slide-over pattern rather than a
  new settings page.
- **Invites, v1 = by username.** The owner types an exact username; we insert a
  membership row (`insert or ignore` — the composite PK makes duplicate invites
  a no-op). No email exists in this product (deliberately), so there's nothing
  to "send"; the invitee just sees the board in their switcher on next load.
  Invite *links* (a signed `v1.<boardId>.<exp>.<hmac>` token reusing the
  `lib/auth.ts` HMAC pattern, redeemed at `/join/<token>`) are a natural v2 —
  deferred because unguessable-link semantics ("anyone holding this URL gets
  in") deserve their own think.
  **Enumeration caveat:** username-invites are an existence oracle for
  usernames ("no such user" vs "invited"). Acceptable for v1 — usernames are
  semi-public identities here, and signup already reveals collisions — but
  worth naming so it's a decision, not an accident. Rate-limit the invite
  action like login (middleware token bucket) so it can't be used to *scan*
  the username space.
- **Column order moves to the board.** Today's `profiles` row (JSON
  `list_order` keyed by userId) encodes a per-user preference — but on a shared
  board, column order is board furniture: if a member reorders columns,
  everyone should see the new arrangement (the alternative, per-member order on
  a shared board, makes "move it left of Waiting" conversations incoherent).
  So `boards.list_order` holds it; `saveListOrderAction` writes there when
  `boardId` is set, and `profiles` survives only for local/demo files (the
  `'local'` row). Personal boards migrate their existing order in bootstrap
  (§9).

---

## 7. Real time, part 1: choosing a transport (the survey)

The problem: HTTP is request/response — servers answer, they don't call. When
user B moves a card, user A's already-rendered page has no reason to know.
Every "real-time" web technique is a workaround for this, and they form a
ladder of increasing capability and cost:

**1. Polling.** A `setInterval` refetch. Dead simple, stateless,
works through every proxy ever built. Cost: latency = poll interval, and (much
worse here) **it defeats Render's idle spin-down** — a single open tab polling
every 10s keeps the instance awake forever and burns the free plan's hours.
An interval long enough to spare the server (60s+) is too slow to feel "live."
Verdict: wrong as the primary, right as the *fallback* (§8).

**2. Long-polling.** The request *parks* on the server until there's news (or
a ~30s timeout), then the client immediately re-asks. Better latency, but it's
the same held-connection cost as SSE with more moving parts (timeout tuning,
re-request races). It's what you built before SSE existed. Skip.

**3. Server-Sent Events (SSE) — recommended.** One ordinary GET whose response
never finishes: `Content-Type: text/event-stream`, and the server writes
`data: ...\n\n` frames down it whenever it likes. The browser side is the
built-in `EventSource` API, which also gives you **automatic reconnection**
with `Last-Event-ID` replay semantics for free — the part of every homegrown
socket layer that's actually hard. One direction only (server→client), which is
exactly our shape: the client's mutations already have a first-class channel
(server actions are POSTs).
  - Works in a plain Next.js **route handler** — return a `Response` wrapping a
    `ReadableStream`, mark the route `dynamic = "force-dynamic"`, and clean up
    on `request.signal` abort. No custom server, no infra change.
  - Two caveats to know: (i) over **HTTP/1.1** browsers cap ~6 connections per
    origin, so many tabs could starve — but Render terminates TLS with HTTP/2
    to the browser, where streams share one connection, so it's a
    non-issue in practice; (ii) proxies kill idle connections, so the server
    sends a comment frame (`: ping\n\n`) every ~25s as a heartbeat.
  - Free-tier interaction, thought through: a held SSE connection counts as
    activity, so the instance won't spin down *while someone is watching a
    board* — which is precisely when we want it awake; 750 free instance-hours
    per month covers a single always-on instance anyway. When nobody's
    connected the instance sleeps as usual, and when it wakes cold,
    `EventSource` reconnects by itself.
  - Owner's no-background-process rule: satisfied. An SSE handler is
    request-scoped — it's born with a request and dies with the connection.
    Nothing runs when nobody's listening.

**4. WebSockets.** Bidirectional, binary-capable, the "real" answer for games
and collaborative cursors. Rejected here: Next.js route handlers can't do the
HTTP Upgrade handshake (you'd need a custom `server.js`, giving up managed
`next start`), and bidirectionality buys us nothing — our client→server
channel exists. The rule of thumb: **WebSockets when the client streams to the
server** (typing indicators, cursor positions, multiplayer input); **SSE when
the server streams to the client**. We're squarely the latter.

**5. Hosted pub/sub (Pusher, Ably, Supabase Realtime, …).** Exists to solve
fan-out *across many server instances* — when the instance that took the write
isn't the instance holding the reader's connection, you need a broker in the
middle. We have exactly one instance **by architectural commitment** (SQLite is
a single-writer, local-disk database; the file *is* the instance). Adding a
broker would import a hosted dependency (owner constraint) to solve a problem
we structurally cannot have. Honest scaling note: this is the same boundary the
whole app already lives behind — if Working Memory ever needs a second app
server, realtime is the *least* of what changes (see PROJECT_STATE's
"Postgres/multi-user escalation path"), and this design fails loudly toward
that path rather than half-working.

---

## 8. Real time, part 2: the actual design (notify-then-pull)

### The pattern

There are two ways to use any push channel:

- **State transfer:** push the changed data itself down the pipe, patch it into
  client state. Fast, but now there are *two* write paths into the client's
  board (SSE patches + server-rendered props), and they will disagree —
  ordering, missed frames during reconnects, interleaving with the optimistic
  layer. Every collaborative-app war story lives in this gap.
- **Notify-then-pull (chosen):** push only a poke — "board changed, high-water
  mark is now N." The client then refetches through the **same path it already
  trusts** (`router.refresh()` → server re-render → the `items` prop resync
  that `Board.tsx` already performs for its own optimistic swaps). The poke
  carries no state, so a lost poke costs freshness, never correctness, and a
  duplicate poke is a harmless extra refresh. **Idempotent handling of an
  unreliable signal** — this combination is the workhorse of practical
  distributed systems, and it's why we get to skip CRDTs (§8b).

### The pieces

**(1) A change feed cursor we already own.** `item_events.id` is an
`integer primary key autoincrement` — a monotonically increasing sequence over
every change on the file. The board's high-water mark is one indexed query:
`select max(e.id) from item_events e join items i ... where i.board_id = ?`.
The append-only history log turns out to *be* a changefeed; we just never read
it that way before. (Two SQLite footnotes worth learning:
`integer primary key` aliases the internal rowid, which is why it's
monotonic-ish and cheap; and AUTOINCREMENT — which this table has — additionally
forbids id reuse after deletes, at the cost of a bookkeeping table. Cursor
semantics survive either way. Caveat: rowids are *assigned* monotonically but
you should treat the cursor as "refetch beyond this point," never as a total
order oracle.)
  Edge case to handle deliberately: **not every visible change writes an
  `item_events` row** — `position`-only reorders and `boards.list_order`
  writes are untracked by design (they're arrangement, not content). The poke
  bus (below) is therefore fired by *actions*, not derived from the events
  table; max-event-id is the reconnect/fallback cursor only, so a
  reorder-while-disconnected can be missed until the next content change or
  focus refetch. Acceptable v1 wobble; document it.

**(2) An in-process poke bus** (`lib/realtime.ts`): a plain
`EventEmitter`, `emit(boardId)` after any successful mutation, stashed on
`globalThis` exactly like the DB handles (same dev-hot-reload reason). ~20
lines. Server actions call `pokeBoard(boardId)` right after their write —
add it inside `revalidateBoard()`'s call sites so it's one edit per action.

**(3) The SSE route** `app/api/boards/[id]/stream/route.ts`:
auth = session cookie + membership check (the same `getBoardContext()`
resolution — the stream is just another request), then a `ReadableStream` that
(a) immediately sends the current max-event-id so the client can detect having
missed things while disconnected, (b) subscribes to the bus and forwards pokes
as `data: {"h": <maxEventId>}\n\n`, (c) heartbeats every 25s, (d) unsubscribes
on `request.signal` abort. **Unsubscribe-on-abort is the one real leak risk in
this whole design** — every reconnect adds a listener, so the abort handler is
load-bearing; the test suite should cover it (§11).

**(4) The client hook** `useBoardStream(boardId)` in `Board.tsx`:
`new EventSource(...)`, and on any message whose high-water mark exceeds the
last one seen, call `router.refresh()` **debounced ~300ms** (a burst of pokes
from a multi-card drag becomes one refetch). Suppress refreshes while the user
is mid-drag (`activeDrag` ref already exists) and while time-traveling
(snapshot mode ignores live state anyway — but note the corollary: the
"Remembering" bar quietly goes stale while you're in the past, which is
correct). On `EventSource.onerror` do nothing — it reconnects itself.

**(5) The fallback layer:** refetch on window focus/`visibilitychange`
(cheap, catches the laptop-lid case) **which also covers your own other tab**,
plus a slow 60–90s interval *only while the SSE connection reports broken*.
Belt, suspenders, and no polling cost in the healthy path.

Self-pokes (your own action → your own refresh) are deliberately *not*
filtered in v1: `revalidatePath` was already refreshing you; one debounced
extra refresh is invisible. Tagging pokes with a session fingerprint to skip
them is a 10-line v2 nicety.

### 8b. Why not CRDTs / OT (the buzzword paragraph)

CRDTs (Conflict-free Replicated Data Types) and OT (Operational
Transformation) solve **concurrent editing of shared state without a single
authority** — think two cursors in one Google Doc paragraph, or offline
replicas merging later. We have a single authority (the one SQLite writer
serializes every transaction), sub-second sync, field-granular writes, and no
offline mode. Under those conditions **last-write-wins per field** is not a
compromise, it's correct-enough with a twist nobody else has: our conflicts
aren't destructive, because the losing write *is still in the history log*.
"Alice renamed it, Bob renamed it 400ms later, Bob won" — the time machine
shows all of it, and either state is one click away. The event log is a better
answer to "we collided" than merge semantics, at this scale. Position
collisions (two simultaneous drags to the same epoch-ms position) already
tiebreak deterministically (`order by position, created_at`), and the next
drag heals the layout. If simultaneous *text* editing of one card ever becomes
a real use case, that's the CRDT conversation — for a `details` field, scoped,
much later.

---

## 9. Migration & bootstrap (the choreography)

All schema changes are **additive** (new tables, nullable new columns), applied
by extending `migrateDb()`'s pragma-checked ALTERs — no table rebuilds, no
downtime, and a pre-shared-boards backup restores cleanly into the new code
(the bootstrap below re-runs; that property is drill-tested in this repo and
must be preserved).

Bootstrap, extending the `bootstrapLegacyOwner()` pattern (runs in `openAt()`
**before triggers attach**, so backfills don't spray spurious events or bump
`updated_at` — the same reason the demo seeder loads data pre-triggers), one
transaction, main DB only:

1. For every `users` row without a `board_members` row: create their
   "Personal" board (owner role), copy `profiles.list_order` (if any) into
   `boards.list_order`.
2. Backfill `items.board_id` = the personal board of `items.user_id` where
   `board_id` is null (and `user_id` is not).
3. Leave `touched_by`/`actor_id` null everywhere — history before this feature
   simply has no actor, and the UI treats null as "don't show a name."

Idempotent by construction: every step is keyed on "where the new column/row
is missing," so re-running is a no-op — same discipline as the owner→user#1
bootstrap, and testable the same way (run twice against a copy of a real
backup, §11).

Signup (`app/signup/actions.ts`) gains "create personal board" in its existing
transaction. Demo seeder and local mode: untouched (`board_id` stays null;
`IS null` scoping covers them — the NULL trick pays off a third time).

Caps (hosted): `ACCOUNT_MAX_ITEMS` becomes a per-board cap; plus
`MAX_BOARDS_PER_USER` (~10) and `MAX_MEMBERS_PER_BOARD` (~10), enforced in the
create/invite actions — same env-var-with-default style as the demo limits.
`/api/export|import` are untouched: they move the whole file, boards included,
bearer-only as before. Litestream: nothing changed about the file's path, so
nothing changes. This — again — is why §2 insisted all boards live in the one
replicated file.

---

## 10. Phasing (each lands green: tsc, suites, build, then owner eyeball)

- **Phase 0 — the model.** Schema + `migrateDb` + trigger v2 (actor) +
  bootstrap + `BoardContext.boardId` + mechanical `lib/queries.ts` /
  `app/actions.ts` scoping swap + `touched_by` stamping + new test suite. **No
  UI change** — after this ships, the app looks identical, but every user is
  secretly on their personal board. Shipping an invisible refactor first is
  deliberate: it isolates the risky part (scoping) where the blast radius is
  provable by tests, before any feature depends on it. Riskiest-first, behind
  a no-op.
- **Phase 1 — sharing.** Boards CRUD actions + `/b/[boardId]` route + switcher
  + invite-by-username + roles + "· @username" in history timelines. After
  this, two accounts can share a board — with manual refresh.
- **Phase 2 — real time.** Poke bus + SSE route + `useBoardStream` + focus/
  fallback refetch. Two browsers, one board, sub-second propagation.
- **Phase 3 (someday, separate green-lights).** Presence dots, self-poke
  suppression, invite links, viewer role, per-member streaks.

Rough size: Phase 0 is the big one (touches every query — mechanical but must
be exhaustive); Phases 1–2 are each smaller than multiple-accounts v1 was.

## 11. Verification plan

- **`lib/boards.test.ts`** (plain node, scratch DB, like `users.test.ts`):
  non-member reads return empty / mutations no-op (the IDOR suite, per-action);
  member of two boards sees the right rows on each; role checks (member can't
  invite/rename/delete); bootstrap idempotency against a copy of a real backup
  (run twice, diff counts); trigger v2: no double-logging after upgrade of a
  v1-triggered DB, `actor_id` lands, null-actor for local mode; cursor
  high-water-mark math; **duplicate re-invite is a no-op**.
- **`lib/realtime.test.ts`**: bus emit/subscribe/unsubscribe;
  listener-count returns to baseline after simulated aborts (the leak test).
- **Live curl checks** (the repo's standard): SSE endpoint 404s for
  non-members and anon; stream opens for a member and delivers a poke when a
  second session's action writes; heartbeat frames arrive.
- **Owner two-browser pass**: the only honest test of "feels live" — two
  accounts, one board, drag/add/edit/archive/time-travel from both sides;
  plus a phone-width pass on the switcher.

## 12. Explicitly out of scope for v1

Offline/local-first sync for shared boards; per-member streaks; text-level
co-editing (CRDT territory); invite links; viewer role; notifications
(email/push — no email in this product yet by design); board archive/transfer;
multi-instance scaling (see PROJECT_STATE's escalation-path item).

## 12b. Reconciliation with custom columns (added 2026-07-07, at build time)

Green-lit 2026-07-07 with: distinct boards (Option B), username invites, column
order **shared per board**, ship **Phases 0+1 together**. One thing this plan
predates: **columns became a real `lists` table** on 2026-07-07 (keyed
`(id, user_id)`, CRUD in `lib/columns.ts`). Consequences:

- **§6's `boards.list_order` is dropped** — column order already lives in
  `lists.position`. No JSON column needed; "shared per board" falls out of
  scoping the `lists` table by `board_id`.
- **The `lists` table re-keys `(id, user_id)` → `(id, board_id)`** (a user can now
  have two boards that each have a "Today"). Because the table shipped only a day
  earlier, the migration is a small rebuild: `migrateDb` renames the old table,
  creates the board-scoped one, copies unowned rows (local/demo, `board_id` null)
  straight over, and leaves owned rows in `lists_legacy` for the bootstrap to
  re-home onto each user's Personal board (then drops it). Idempotent: once the
  table has a `board_id` column the rebuild is skipped.
- `lib/columns.ts` swaps its `userId` param for `boardId` (same mechanical
  `IS ?` swap as everything else); `ensureLists` seeds a *board's* defaults on
  first render and no longer reads `profiles.list_order`.

Build order (0 then 1, deployed together): schema + `migrateDb` + trigger v2 +
bootstrap + `BoardContext.boardId` + `lib/columns.ts`/`lib/queries.ts`/
`app/actions.ts` scoping swap + `touched_by` stamping + `lib/boards.ts` +
`lib/boards.test.ts` → then `/b/[boardId]` route + switcher + invite-by-username
+ roles + "· @username" history. Actions take an explicit `boardId` arg
(membership verified in `getBoardContext`) — explicit over a "current board"
cookie, and it keeps two tabs / two boards honest.

## 13. Open questions for the owner (green-light gates)

1. **Is "share my whole personal board" enough, or do you want distinct boards
   (recommended)?** The plan assumes Option B (§2) — it's more work in Phase 0
   but the personal board stops being a special case forever.
2. **Sharing model comfort check:** invite-by-exact-username, no emails, member
   list visible to all members — matches the product's no-email stance?
3. **Column order shared per board** (§6) — agreed, or should each member keep
   their own arrangement?
4. **Phase 0 alone is a real deploy** (invisible refactor). OK to ship and soak
   it before Phase 1, or do you want Phases 0+1 as one drop?
