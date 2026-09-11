# Phone app: what the rewrite lost, and what is broken (2026-09-10)

Three read-only investigations against the phone app (`components/phone/`) versus
the pre-rewrite shell at `ddf91b0`. The old desktop components are byte-identical
since the phone app landed, so the feature audit is a straight call-site diff.
Nothing here is built yet. Owner confirms scope and order first.

## A. Bugs

### A1. Subtask tap freezes the card sheet (owner report)
Measured headlessly (Playwright, demo mode, iPhone UA, standalone shim).
- Completing a sub-card runs a server action; its `revalidatePath` makes Next's
  App Router call `history.replaceState` with only its own tree. That rewrites the
  current entry and drops `wmSheet` (`PhoneShell.tsx:124`) and `wmPhoneDepth`
  (`PhoneCardSheet.tsx:106,150-153`). Spreading `history.state` on the way in does
  not help; `replaceState` is not a merge.
- Next back gesture: `PhoneShell.tsx:147` sees no `wmSheet`, closes the sheet,
  and the sheet's unmount cleanup (`PhoneCardSheet.tsx:129-131`) calls
  `history.go(-n)` for entries the browser already took. One gesture pops 2-3
  entries. In an installed PWA there is no chrome to recover with, so the app
  is left on a dead entry until relaunch. Explains "close and reopen the app".
- Compounding: a normal close pops twice (`PhoneCardSheet.tsx:170-174` then
  `PhoneShell.tsx:138`). Desktop `Board.tsx:213-226` stores `wmDepth` the same way
  and is wiped the same way; Board is mounted behind the phone shell.
- Second plausible reading of the symptom: a 6-14px downward wobble on a
  sub-card check makes vaul dismiss the sheet (`shouldDrag` true at the peek).
  Fix is `data-vaul-no-drag` on `.phone-check` / `.phone-row__body`
  (`PhoneRow.tsx:311,351`).
- Fix: preserve our keys inside `replaceState` (one effect in PhoneShell);
  skip the unmount `go(-n)` when a popstate caused the unmount; single close
  path; `data-vaul-no-drag` on the check.
- Ruled out with evidence: stuck pending flag (none exists), overlay left
  behind, vaul scroll lock, press state machine (swipe disabled in sheet rows).

### A2. Sheets never got the shell's data
`PhoneDataProvider` (`phone-data.tsx:42`) has zero consumers. `PhoneShell.tsx:176`
wraps in `BoardDataProvider`, a different context. Every sheet (card, capture,
search, boards, note, review, time travel) takes the fallback and refetches the
whole board on open. Consequences:
- Every card sheet first renders "That card isn't on the board any more"
  (`PhoneCardSheet.tsx:176-187`) because `items` is `[]` until the fetch resolves;
  vaul's snap-point setup is mount-only, so it stays misconfigured for the
  sheet's life.
- The card sheet never sees its own writes: `SubRow` gets no refresh callback
  (`PhoneCardSheet.tsx:406,452`), so its items are frozen at open time.
- Fix: render `PhoneDataProvider` in PhoneShell; gate the not-found branch on
  `loading`; pass refresh to SubRow.

### A3. Archived card from Find opens as "not on the board"
`PhoneSearch.tsx:96-104` opens archived hits, but `items` is always `archived = 0`
(`lib/queries.ts:41-44`). No phone code calls `unarchiveItemAction`.

### A4. Smaller confirmed bugs
- Sub-card badge on Now/Lists counts archived children
  (`PhoneHome.tsx:42-51`, `PhoneList.tsx:64-73`); the sheet uses `childrenOf()`
  which filters them. Reuse `childrenOf()`.
- "Add a sub-card" draft survives drilling into a sub-card
  (`PhoneCardSheet.tsx:320`, no reset on `item.id`).
- Swipe-archive's 900ms undo timer is not cleared on unmount
  (`PhoneRow.tsx:255-275`); switching tabs archives silently with no undo.
- `PhoneRow.fire()` creates the promise outside `startTransition`
  (`PhoneRow.tsx:155-161`).

### A5. Plausible, needs a device
- Lists pager `index` is not clamped when `pages` shrinks (`PhoneList.tsx:55-120`).
- `Sheet.tsx:211-226` sets `documentElement.style.overflow=hidden` on field focus
  and only clears it on blur; an abrupt unmount (edge-swipe back) can leave it.

## B. Lost features with no plan language behind them (likely forgotten)
- Archive: browse the full archive, restore a card, view an archived card.
  Old: `ArchiveView.tsx`, `CardPanel.tsx:647-654`.
- Reorder cards in Today. Today is excluded from the Lists pager
  (`phone-logic.ts:213-218`) and Now has no reorder at all.
- Move a card to another board / re-parent. "Move to" chips
  (`PhoneCardSheet.tsx:515-538`) only change `list`; `setParentAction` is never
  called. Old: pop-out drag and the "Inside" picker (`CardPanel.tsx:230-297,667-701`).
- Doorways: chip on the card, "Opens" board picker, promote subtree, demote to
  card, provenance. Zero phone consumers of `useDoorways`.
  Old: `ItemCard.tsx:179-204`, `CardPanel.tsx:703-802,891-906`.
- Card history timeline (`historyAction`, `CardPanel.tsx:884-942`).
- Markdown rendering of details; phone shows a raw textarea always.
- Streak history strip (`CardPanel.tsx:859-874`); only the number survives.
- Reorder sub-cards inside the sheet (`CardPanel.tsx:224-331`).
- Time travel: tap a past card for read-only detail, sub-cards in snapshots
  (`PhoneTimeTravel.tsx:87-89` filters them out), relative-jump chips.
- Column hint text; a Done tray on Lists pages (Now has one, Lists do not);
  sub-card parent breadcrumb in Find results; Capture that stays open for
  rapid multi-add.

## C. Dropped on purpose per the plan (owner to confirm each)
- Hold-to-nest drag gesture (`phone-app.md:66`).
- Multi-select, bulk archive, undo for moves (`phone-app.md:10`).
- Time-travel prev/next steppers (`phone-app.md:32`).

## Built 2026-09-10, second pass
- Column add / rename / delete / reorder (`phone-app.md:10,171`): Lists management sheet built.
- Board create / rename / invite / remove member / leave / delete: Boards management sheet built.
- Restore from archive: built as part of Archive feature in phase 2.
- Diff ledger for time travel: pure `diffBoardSince` reports every change between a past board state and now.

## Server actions with zero phone call sites
setParentAction, archiveItemsAction, unarchiveItemsAction, unarchiveItemAction,
historyAction, addListAction, renameListAction, deleteListAction,
reorderListsAction, reorderItemAction, promoteSubtreeAction, demoteToCardAction,
setLinkedBoardAction, provenanceAction, createBoardFromCardAction,
createBoardAction, renameBoardAction, deleteBoardAction, inviteMemberAction,
removeMemberAction, leaveBoardAction.

## Proposed order
1. A1 + A2 together (same files, same history/data plumbing). Opus. **BUILT.**
2. A3 + archive browse/restore (B). Sonnet. **BUILT.**
3. Today reorder + move-to-board / re-parent (B). Opus for the gesture. **BUILT.**
4. A4, A5 mechanical fixes. Sonnet. **BUILT.**
5. Doorways, history, markdown, streak strip, time-travel detail. Sonnet. **BUILT.**
6. Lists management + Boards management (C, second pass). **BUILT.**
7. Anything else in C the owner wants back.
