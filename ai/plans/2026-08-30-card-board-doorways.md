# Card ↔ board doorways — plan, 2026-08-30

_Status: PROPOSED — awaiting owner sign-off before any code._

Backlog item: "Card ↔ board doorways" (owner idea 2026-08-30). A card stays an
ordinary card on its home board — its own done/column/history, drag, archive —
and *opens into* another board. **Pointer, not portal**: the card never mirrors
the linked board's items; items live in exactly one place (the linked board),
and the card is a doorway plus a live count. The motivating cases: a Personal
doorway to the shared Movies! board so watch-list cards stop re-invading the
Personal backlog, and "coding projects" (12 subs, Autojob alone 17 sub-subs)
becoming a real board.

## 0. Shape, in one paragraph

`items.linked_board_id` (nullable, references `boards(id)`). The card renders a
doorway chip — the linked board's name and open-card count, words + the repo's
existing glyph style, no pictographs — and tapping it navigates to `/b/<id>`,
where `getBoardContext` already enforces membership (404s a non-member — the
choke point, unchanged). Setting/clearing the link is a card edit, journaled by
a new trigger, so the time machine and the card's History list see it. The count
is computed at read time from the live DB — never stored, never synced.

## 1. Schema + trigger (additive, self-migrating)

- `migrateDb` (lib/schema.ts): the existing `hasCol` pattern —
  `alter table items add column linked_board_id text references boards(id)`.
  Defaults NULL, so every existing DB/backup/import is untouched. `Item`
  (lib/types.ts) and `rowToItem` (lib/queries.ts) gain the field.
- **One new trigger, `items_log_linked_board_v2`** — a NEW name, so
  `create trigger if not exists` picks it up on every existing DB with no drops
  (the items_log_parent_v2 precedent, schema.ts:179):
  type `'edited'`, field `'linked_board'`, old/new = board ids. History reads
  "Linked to board …" / "Unlinked" (a `describe()` case in CardPanel).
- Time travel: `reconstructItemAt` does NOT learn the field. Past snapshots
  render the card plain — no doorway chrome, no count (see §4). The event still
  appears in the card's History list, which is enough.

## 2. Who can link, who sees what (membership semantics)

- **Installing a doorway requires membership of the *target*.**
  `setLinkedBoardAction(boardId, id, linkedBoardId | null)` verifies via
  `getMembership(mainDb, linkedBoardId, userId)` before writing. Also refused:
  linking a board to itself, linking the daily note (`list='note'`, same
  exclusion nesting uses), a target the caller isn't on (404-shaped "no such
  board" — never confirm existence, per the shared-boards rule).
- **The link is card content, visible to every member of the *home* board.**
  But name + count are only resolved server-side for boards the *viewer* is a
  member of: BoardScreen collects the distinct `linked_board_id`s on the board,
  and for each checks the viewer's membership. A member sees "Movies! · 23
  open"; a non-member sees a neutral "Linked board" chip with no name, no
  count, no navigation (nothing leaked; tapping anyway would just 404). This is
  exactly the Personal-card → shared-Movies! case in reverse: ros1ta sees the
  owner's Personal board never, and if a shared-board card links to a board
  ros1ta isn't on, ros1ta learns nothing.
- **Deleted linked board:** `deleteBoard` (lib/boards.ts) gains one line inside
  its existing transaction —
  `update items set linked_board_id = null where linked_board_id = ?` — so no
  doorway ever dangles (works whether or not foreign_keys is on, and the new
  trigger journals the unlink on each doorway card). Board deletion remains the
  one deliberately destructive verb in the app; this doesn't widen it.
- **Local/demo mode:** boardId is null and `boards` is empty — there is nothing
  to link. The picker renders only when the user has boards (hosted, signed
  in); the column is inert otherwise. Demo boards never see the feature.

## 3. The live count

`getDoorwayMeta(mainDb, viewerId, linkedBoardIds)` (new, pure, in a new
lib/doorways.ts with a node test): for each board the viewer is a member of,
`select count(*) from items where board_id = ? and archived = 0 and done = 0
and parent_id is null` — **open top-level cards**, the number you'd feel walking
in — plus `getBoardName`. Returned as a map BoardScreen threads to
Board → ItemCard/CardPanel alongside `listLabels`. One query per distinct
linked board on the page; a board has few doorways, this is nothing.

Staleness, stated plainly: the count refreshes whenever the *home* board
re-renders. A change on the *linked* board does not poke the home board's SSE
bus (realtime is per-board by design). The count can lag until your next
refresh; that is accepted for v1, not a bug to engineer around.

## 4. Time-machine behavior (explicit)

The doorway card in a past snapshot renders as a plain card: no chip, no count.
The count is a live read — reconstructing "how many open cards did Movies! have
at time t" would mean shipping a second board's whole timeline into the
scrubber, for a number nobody is asking the past for. **Live-only, by design.**
SnapshotCardPanel is untouched. The link/unlink *events* remain visible in the
card's History list and are part of its journaled record.

## 5. Creating the far side

Two verbs in the CardPanel, next to the existing "Inside" picker:

- **"Opens board" picker** — the viewer's boards (`getUserBoards`, already
  fetched for the switcher) + "None". Choosing writes `linked_board_id`.
- **"New board from this card"** — `createBoard(mainDb, userId, item.text)`
  (cap enforced there: MAX_BOARDS_PER_USER) then link it. No redirect — the
  card just becomes a doorway to an empty board. This alone covers the
  "watching" case: new personal board, move in at your leisure.

## 6. Promotion — the hard part, weighed

"Promote this card's sub-cards to the new board." `items` has **no** logging
trigger on `board_id`, and the whole read path assumes a row's board is
forever: `getTimelineData` fetches `where board_id is ?`, so a re-homed row
would vanish from the old board's time machine *retroactively* — the past would
lie, which is the one thing this product promises not to do.

- **(a) Add a board_id trigger + replay support.** The truthful deep fix, and
  the expensive one: timeline queries must fetch rows that *used* to be on the
  board (join events on field='board'), `reconstructItemAt` must revert board
  membership, the visible-board filter must apply it, and `list` ids don't even
  exist across boards (columns are per-board data), so replay must also handle
  a column the board never had. Touches timetravel, queries, both panels, seeds.
  Not a day, and all of it for one rare verb. **Not recommended now**; keep as
  the someday-shape if promotion becomes common.
- **(b) Archive here, recreate there.** One transaction: archive the sub-tree
  on the home board (journaled by the existing archived trigger — the old
  timeline truthfully shows the cards leaving at that moment, and they remain
  browsable in the home board's Archive), then insert fresh rows on the target
  board — text/details/done/recurrence copied, nesting preserved by walking the
  subtree with an old-id → new-id map (Autojob's 17 grand-subs keep their
  shape), landing in the target's `backlog` with relative positions kept. Both
  boards' timelines stay truthful; the cost is honest and small: **per-card
  history restarts at the seam** (the old card's full history stays reachable
  via the home board's archive). Built entirely from existing verbs + one pure
  function. ~2 hours. **Recommended.**
- **(c) Defer promotion; v1 is link + create-empty-board only.** Zero risk,
  but "coding projects" — the motivating case — then migrates by hand.

**Recommendation: ship (b), gated separately (§9 G3)** so v1 can land without
it if you'd rather sit with doorways first.

## 6b. Demotion — the opt-out (owner requirement 2026-08-30)

The owner's call: the whole feature is opt-in AND opt-out — a card converts to
its own board *and converts back to a regular card*. Two exits, one soft, one
full:

- **Unlink (soft opt-out):** the §5 picker's "None" clears `linked_board_id` —
  the card is an ordinary card again and the board lives on, unlinked
  (journaled "Unlinked from board …" when G2 = yes). Already in v1.
- **Demote (full opt-out) — "convert back to a regular card":** promotion (b)
  run in reverse, same machinery, same truth properties. One transaction:
  archive the linked board's active cards *on that board* (its timeline
  truthfully shows them leaving; they stay browsable in its Archive), recreate
  them as sub-cards under the doorway card on the home board (the same
  old-id → new-id subtree walk preserves nesting), then clear the link. The
  emptied board is left alive — deleting it stays a separate, explicit act,
  because `deleteBoard` is the app's one destructive path and demotion must
  never silently invoke it. Promote → demote round-trips losslessly in
  content; per-card history restarts at each seam with the full trail
  reachable in the respective archives.

**Provenance across the seam (owner concern 2026-08-30: "no data lost in
conversion?").** Nothing is deleted — content copies fully, originals are
archived, both timelines stay truthful — but the recreated card's History
panel would start at the conversion. So the schema gains one more nullable
column beside `linked_board_id`: `items.converted_from` (same `hasCol`
migrateDb pattern), set at insert by `promoteSubtree`/`demoteToCard` to the
source card's id. No trigger work — creation events stay trigger-written and
untouched; the panel reads the column live. It renders in History as
"Continued from a card on <board> — view original," linking to the archived
source card's panel, whose own History still holds the full pre-conversion
trail. History is then not just preserved but *followable*, in both
directions of the round trip.

## 7. Owner constraints honored

- **No always-on background processes** — nothing here runs outside a request.
- **Nothing destructive** — the event log stays append-only; promotion (b) only
  archives and creates; the sole delete remains board deletion, which merely
  gains an unlink line.
- **No emoji in UI** — the chip is words + the existing SVG/glyph vocabulary.
- **Plan before building** — this file; no code until the §9 gates are answered.
- Backup/import: the column is additive; old snapshots migrate on next open via
  `migrateDb`; `RESTORE_LOCAL=1` replacement re-migrates the same way.

## 8. Steps (v1 ≈ a day; step 6 is the gated promotion)

1. Schema: `linked_board_id` in migrateDb + `items_log_linked_board_v2`;
   types.ts + rowToItem. (Importer unaffected — trigger created after load.)
2. lib/doorways.ts (pure, node-tested): `setLinkedBoard` with the §2 refusals;
   `getDoorwayMeta`. `deleteBoard` unlink line + a boards.test.ts case.
3. Actions: `setLinkedBoardAction`, `createBoardFromCardAction` (app/actions.ts
   or app/boards/actions.ts — it touches boards, likely the latter).
4. BoardScreen: collect linked ids → `getDoorwayMeta` → thread meta down.
5. UI: ItemCard doorway chip (member: name + open count, navigates; non-member:
   neutral, inert); CardPanel "Opens board" picker + "New board from this
   card"; `describe()` history case. SnapshotCardPanel: no change.
6. (If G3 = yes) `promoteSubtree` in lib/doorways.ts + panel affordance on a
   doorway card that still has sub-cards; (if G6 = yes) its inverse
   `demoteToCard` — same subtree walk, opposite direction — + a "Convert back
   to card" affordance in the doorway card's panel.
7. Verify: tsc, full node suite (new doorways tests), prod build; by hand on a
   scratch hosted DB: link → count → tap-through; ros1ta's non-member view;
   delete the linked board; demo board shows nothing; time machine shows a
   plain card in the past.

## 9. Open questions for the owner (green-light gates)

1. **Shape sign-off:** pointer-not-portal v1 — link + live count +
   create-empty-board-from-card. Yes?
2. **Journal the link?** Recommended: yes, via the new trigger (it's card
   content, and History should say "Linked to board …"). The alternative —
   treating it as unjournaled structure, like columns — saves a trigger but
   hides the change from the record.
3. **Promotion in v1?** Recommended: (b) archive-here / recreate-there, as one
   gated step. Or defer (c). (Full board_id replay (a) is written up above but
   not recommended.)
4. **Non-member rendering:** neutral "Linked board" chip, no name/count
   (recommended) — or hide the doorway entirely from non-members?
5. **Count definition:** open top-level cards — not done, not archived
   (recommended) — or all active cards including done-but-unarchived?
6. **Demotion in v1?** "Convert back to a regular card" is promotion (b)'s
   inverse and shares the `lib/doorways.ts` subtree machinery — cheap to ship
   together (recommended), or as the first fast-follow.
