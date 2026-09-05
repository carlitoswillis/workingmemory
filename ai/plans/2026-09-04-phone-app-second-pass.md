# Phone app — second pass

Design lead's specification. Three implementers, disjoint files, no questions possible — every value here is final.

---

## 1. Design plan

### 1.1 Tokens (Nocturne; reuse the existing variables)

| Role | Variable | Value | Note |
|---|---|---|---|
| Ground | `--bg-1` | `#0e1124` | every screen, every row |
| Step up (done row, sheet) | `--surface` | `#141a2e` | elevation is luminance, never shadow |
| Hairline | `--veil-soft` | `#1a2037` | the only divider in the app |
| Primary text | `--text-hi` | `#ecebf4` | |
| Secondary text | `--text-mid` | `#a7acc4` | section labels, meta |
| Quiet text | `--text-lo` | **`#7d83a1`** (was `#6f7596`) | 5.0:1 on `--bg-1`; light theme **`#6b697f`** (4.8:1) |
| Now / attention | `--now` | `#e3a866` | full strength **once per screen** |
| Done | `--done` | `#6fb89c` | |

Existing derived tokens stay: `--now-line` (0.18 amber), `--now-wash`, `--now-tint` (0.22 amber, now the search-match highlighter), `--past`, `--past-line`.

Three new variables, all declared by **P2** on `:root` so portaled sheets inherit them:
- `--scrim-deep: rgba(6, 8, 15, 0.78)` (retune, was 0.6) — the board behind a sheet must recede.
- `--dur-fast: 90ms`, `--dur-kb: 160ms` — press feedback, and the sheet tracking the keyboard.

**P2 must also move `--p-title/--p-body/--p-meta/--p-caption/--p-regular/--p-medium/--p-strong` and `--kb`/`--vvh` from `[data-shell="phone"]` to `:root`.** Vaul portals sheets to `<body>`; today every one of those variables resolves to nothing inside a sheet, which is why `.wm-sheet { padding-bottom: var(--kb, 0px) }` has always been 0. That single bug is most of "capture is jarring."

### 1.2 Type

One sans (`--font-grotesk`) carries the product. One serif (`--font-fraunces`) appears exactly twice — the page title on Now and on Lists — and nowhere else, ever.

| Role | Size / line-height / weight |
|---|---|
| Page title (serif) | 26px / 1.1 / **510** (was 500 — closes the ladder) |
| Row title, sheet body | 15px / 1.25 / 510 |
| Section label | 13px / 1.45 / 590, `--text-mid`, sentence case |
| Meta, hint, empty state | 13px / 1.45 / 400, `--text-lo`, upright |
| Caption | 11px / 1.5 / 400 |
| Any input | 16px / 1.4 / 400 |

`font-variant-numeric: tabular-nums` on every rendered number: streaks, section counts, sub-card counts, time-travel counts. No exceptions, no italics anywhere, no letter-spacing above `0.02em`, no `text-transform` anywhere in the phone app.

### 1.3 Layout — the flat ledger

Two vertical rules and no others. **16px** is the label rule (section heads, sheet padding, navigational rows). **60px** is the title rule (16px gutter + a 44px check column), and every *completable* row's text starts there — on Now, on Lists, in search results, and for a sub-card nested three levels deep. A row that can be checked has a check column; a row that only navigates does not, and starts at 16px. That is the whole grammar, and it is information: the gutter tells you whether the thing can be finished.

```
NOW                                   LISTS
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ Friday, September 4          │      │ Friday, September 4          │
│ Now                          │      │ Lists                        │
│                              │      │ (Focus) Waiting  Backlog  Br▸│
│ Today                        │      ├──────────────────────────────┤
│ Nothing claimed for today.   │      │ ◯   Study dossier         ⋯ │
│                              │      ├──────────────────────────────┤
│ Due today                  8 │      │ ◯   Formation        2/3  ⋯ │
├──────────────────────────────┤      ├──────────────────────────────┤
│ ◯   Push               3  ⋯ │      │ ◯   Job search            ⋯ │
├──────────────────────────────┤      └──────────────────────────────┘
│ ◯   Pull                  ⋯ │      ▲ 16px          ▲ 60px
├──────────────────────────────┤
│ ◯   Wednesdays: laundry,     │      TAB BAR
│      sweep, mop, clean 2  ⋯ │      ┌──────────────────────────────┐
├──────────────────────────────┤      │  ◷      ≡     ＋     ⌕    ⋯ │
│ Done today               2 › │      │ Now   Lists Capture Find More│
└──────────────────────────────┘      └──────────────────────────────┘
▲16     ▲60                              amber       everything else
                                         + 1.8 stroke  --text-lo, 1.6

CARD PEEK (Formation, 3 sub-cards → 348px)
┌──────────────────────────────┐
│            ────              │
│ Formation                  ⌃ │
│ Focus, 3 sub-cards           │
│ ┌──────────────────────────┐ │  outlined, not filled
│ │          Done            │ │
│ └──────────────────────────┘ │
├──────────────────────────────┤
│ ◯   Finish assessment 3      │  identical to a Now row
├──────────────────────────────┤
│ ◯   Watch this week's sess…  │  no ↳, no indent, no smaller type
├──────────────────────────────┤
│ ◯   Message cohort lead      │
└──────────────────────────────┘
```

Everything flush left. Nothing centred except the glyph inside its own 44px box and the label inside a tab. No card is ever centred in dead space.

### 1.4 Five principles

1. **One row, every depth.** A sub-card renders exactly like a top-level card — same 56px, same 44px check, same 15px/510 title, same hairline. Depth is expressed only by a back affordance at the top-left of the sheet. Never by indentation, never by a `↳`, never by smaller type.
2. **Amber once per screen.** Full-strength `--now` marks where you *are* (the active tab) or where you are *typing* (the caret and a 1px underline). Buttons never fill with it; focus never outlines in it.
3. **Elevation is a luminance step plus a hairline.** No shadow, no glow, no gradient, no blur filter.
4. **Motion answers a finger.** The one exception, and it is earned: a sheet resizes with the keyboard over `--dur-kb`, because the alternative is the jump the owner is complaining about.
5. **One fact per line, sentence case, commas.** No dots, no dashes, no caps, no italics. An empty screen says what to do next.

### 1.5 Self-review against the brief

**What I would have produced for any phone to-do app, and did:** a near-black ground with one warm accent; a five-slot bottom bar with 44px targets; 56px rows with a leading circle-to-tick check; Vaul bottom sheets with a grip handle; a spring overshoot on completion; `svh` heights and safe-area padding. All of that is correct and all of it is generic. It stays, but it is not where the design lives, and I have stopped spending anything extra on it.

**What I changed to make it this app's.** Working Memory's two real subjects are *nesting* and *history*. So: (a) the ledger row is the same object at every depth — most to-do apps indent and shrink a subtask, and indenting is exactly the move that made sub-cards feel second-class and hard to hit; here a sub-card in a sheet is byte-for-byte a Now row, which resolves the owner's third complaint by design rather than by patch. (b) Search stops being a search UI and becomes the same ledger, filtered — one field on a hairline, then rows; a match is a quiet `--now-tint` highlighter, not amber text. (c) Capture stops being a form — no bordered box, no focus ring, just an amber caret on the sheet's own surface, sized to what you have written. (d) Amber is not a brand colour here, it is the *now* pole of a time-travel product whose past is blue, so it is rationed to one full-strength use per screen. **Removed as generic defaults:** all-caps eyebrows (three places), italic-serif empty states, `A · B` meta strings, the solid-amber CTA, the amber focus ring, the fixed 96svh search sheet, `— hint —` em-dash empty copy, `Title` / `Details` labels above self-evident fields.

**The one memorable element: the row.** Every ounce of boldness goes into the fact that the row never changes — a card, a sub-card, a search hit, a thing you did last Tuesday, all the same line. Everything else is quiet: the serif title stays at two words and 26px and never grows, the accent stays rationed, the dividers stay one weight.

---

## 2. Decisions on the critiques

**Accept.** All-caps eyebrow (`.phone-eyebrow`, `ON THE BOARD`, `NOTIFICATIONS`) — banned outright, three places, sentence case everywhere. · Italic serif `.phone-empty` — the app's one italic; kill it. · Middle dots in five components — comma or layout, never punctuation as decoration. · `--text-lo` fails 4.5:1 — retune both themes. · Three competing section-label systems — one system, 13px/590/`--text-mid`. · `.phone-check` / `__undo` / `__more` missing `:active` — the app's most-tapped button has no press feedback. · `sync` replays the completion pop unprompted — motion must answer a finger. · Section counts lag the row by 900ms — the receipt should agree with itself instantly. · Solid amber `--primary` fill — the loudest shape in a quiet app; outline it. · Amber focus border on fields — replace with a 1px `--now-line` underline plus an amber caret. · Capture's dead gap and 50svh floor — height:auto, textarea absorbs slack. · Search's 96svh box — content-driven, capped. · Sub-cards are a lesser row / absent from peek / 4 taps to complete — full `PhoneRow`, in peek when ≤3, 2 taps. · No back affordance from a sub-card — add one. · Archive has no undo — route it through the same 900ms window as completion. · Run-on accessible names in More/Search/Boards — explicit `aria-label` with punctuation. · Empty-list `— hint —` copy — per-list sentences. · Streak digit is a 24px dead strip — fold it inside the body button. · Segment strip clips with no cue — 20px mask fade. · Capture tab's third grey — delete the override. · Active tab signalled by hue alone — add a 1.8 stroke-width. · Cancel competes with Save — ghost variant. · Native `×` in search — replace with a measured 44px button. · The `--vvh` / `position:fixed` keyboard fix — mandated, non-negotiable, P2 + P3.

**Modify.** *Backdrop-filter `brightness(0.55)` on the overlay* → no filter (compositing cost on iOS, and it is an effect); deepen `--scrim-deep` to `rgba(6,8,15,0.78)` instead — alpha over the foreground text dims it just as well. · *Centre the search empty state* → keep it left at the 16px rule; with `height:auto` there is no void left to centre inside, and centred empty copy is the generic default. · *Search head gets a `border-bottom`* → yes, but the input itself becomes borderless on that hairline rather than a bordered box sitting above one. · *`.wm-ph-row` vs `.phone-row` grammar* → flatten sheet rows to the ledger, but navigational rows keep no check column and start at 16px. · *Peek stays 180px* → peek is `180 + 56 × min(kids, 3)` px, because sub-cards in peek is a mandate and 180px cannot hold them. · *`.phone-title` weight comment* → set 510 and fix the comment; do both.

**Reject.** *"Done today" count mismatch* — a seed/timing artefact of one capture, not reproducible in the code path (header and list read the same array); P1 adds a `deriveNowSections` test asserting `header count === rows.length` instead of chasing it. · *Seed a second board* — a fixture change, not a design change; out of scope for this pass. · *Verify long-press on a real device* — true, but it is not a build item; note it in the PR, change nothing. · *Undo gets its own inverse pop* — the asymmetry is deliberate; reversing an action is not a moment to decorate.

---

## 3. Build packages

**Ordering: P2 lands its token block and `useKeyboardInset` contract first.** P1 and P3 reference `--vvh`, `--dur-kb`, `--dur-fast`, `--text-lo` by name only.

**CSS ownership inside `/* phone shell */`.** P1: selectors beginning `.phone-row`, `.phone-section`, `.phone-home`, `.phone-done`, plus `.phone-check`, `.phone-empty`, `.phone-chevron` (row-internal; P2 does not touch them). P2: `.phone-shell`, `[data-shell="phone"]`, `.phone-tabs`, `.phone-tab`, `.phone-topbar`, `.phone-eyebrow`, `.phone-title`, `.phone-seg`, `.phone-pager`, `.phone-page`, `.phone-lists`, `.phone-scroll`, `.phone-content`, and all `:root` variables. New variables from P1/P3 go at the very end of their own block; there are none planned.

### P1 — "rows and the moment"
`PhoneRow.tsx`, `PhoneHome.tsx`, `phone-motion.ts`, `phone-logic.ts` (+ `phone-logic.test.ts`), P1's CSS selectors.

1. `phone-motion.ts`: add `kbTrack: { duration: 160, ease: "cubic-bezier(.32,.72,0,1)" }` to `MotionTokens` and `BASE`.
2. `phone-logic.ts`: add `animate: boolean` to `RowState`. `rowInitial` → `animate: false`. `toggle`/`undo` → `animate: true`. `sync` → `{ checked: event.checked, phase: "idle", error: null, animate: false }`. Test: a `sync` from `false`→`true` yields `animate === false`; a `toggle` yields `animate === true`.
3. `phone-logic.ts`: export `emptyCopyFor(listId: string): string` → `focus:` "Nothing in Focus right now.", `waiting:` "Nothing waiting. Snooze a card here from its row menu.", `backlog:` "Backlog's empty.", `braindump:` "Nothing dumped yet. Tap Capture to drop a thought.", default "Nothing in this list yet." (P2 consumes it in `PhoneList.tsx`; no em dashes, ever.)
4. `PhoneRow.tsx`: `.phone-check__glyph` gets `is-on` only when `state.checked`, and the pop class `is-pop` only when `state.checked && state.animate`.
5. `PhoneRow.tsx`: move `.phone-row__dot` and `.phone-row__streak` **inside** the `.phone-row__body` button, after the title, as a trailing flex group. The body button then spans from the check zone to `.phone-row__more`; no interior dead strip.
6. `PhoneRow.tsx`: `archive()` routes through the undo window — set a pending phase, render the same `.phone-row__undo` control, fire `archiveItemAction` only after `UNDO_MS` (900), cancel on Undo.
7. `PhoneRow.tsx`: new optional props `onOpen?: (id: string) => void` (defaults to `ui.open({kind:"card", itemId})`) and `dense?: boolean` (no swipe, no `⋯`). P3 renders sub-cards with these. Do not change any other prop's meaning.
8. `PhoneHome.tsx`: derive header counts from a second `deriveNowSections(view, { today, todayListId })` call **without** `held`; keep the `held` pass for row placement. Test both in `phone-logic.test.ts`.
9. `PhoneHome.tsx`: "Due today" empty copy → "Every repeating card is done for today." (one sentence).
10. CSS: add `.phone-check:active, .phone-row__undo:active, .phone-row__more:active { transform: scale(0.985); }`. `.phone-check__glyph.is-pop { animation: phone-check-pop 140ms cubic-bezier(.34,1.56,.64,1); }`; move `transition: color 140ms linear` onto `.phone-check__glyph` and delete `.phone-check__ring { transition: stroke … }`. `.phone-check__tick { stroke-dashoffset: 9 }` at rest (35% pre-drawn). `.phone-row { padding-left: max(16px, env(safe-area-inset-left)); }` and `.phone-row__body { padding-left: 0 }` so titles land on the 60px rule. `.phone-empty`: delete `font-family` and `font-style`, set `font-size: var(--p-meta); color: var(--text-lo)`. `.phone-section { padding: 6px 0 10px }`.

**Acceptance (headless, 375×812):** the title left edge of every `.phone-row__title` computes to 60px; `.phone-empty` computed `font-style === "normal"` and `font-family` contains no serif; tapping the first Due-today check flips `aria-checked` within 100ms **and** "Due today" count decrements in the same frame; `.phone-check` has a non-identity `transform` while `:active`; no element between `.phone-check` and `.phone-row__more` is outside a button; swipe-archive leaves an "Undo" button in the row for ≥800ms; `phone-logic.test.ts` passes.

### P2 — "chrome"
`PhoneTabs.tsx`, `PhoneList.tsx`, `PhoneShell.tsx`, `useKeyboardInset.ts`, `keyboardInset.ts`, P2's CSS selectors and all `:root` variables. Do not change the `PhoneUI` interface.

1. `:root`: `--text-lo: #7d83a1`; `html[data-theme="light"] --text-lo: #6b697f`; `--scrim-deep: rgba(6,8,15,0.78)`; add `--dur-fast: 90ms; --dur-kb: 160ms`. Move the whole `--p-*` ladder from `[data-shell="phone"]` to `:root` (leave the shell block referencing them).
2. `keyboardInset.ts`: export `visualViewportVars(m)` returning `{ kb, vvh, vvhTop }` — pure, unit-tested.
3. `useKeyboardInset.ts`: write `--kb`, **`--vvh` (px), `--vvh-top` (px)** onto `document.documentElement` on every `visualViewport` resize/scroll, rAF-coalesced. Delete the duplicate hook inside `PhoneShell.tsx` and import this one. This is the contract P3 builds on.
4. CSS `[data-shell="phone"]` / `.phone-shell`: `position: fixed; inset: 0; overflow: hidden; height: 100dvh;` and `html:has(.wm-sheet) [data-shell="phone"] { height: var(--vvh, 100dvh); }`.
5. `.phone-eyebrow`: delete `text-transform`; `letter-spacing: 0.01em`. `.phone-title { font-weight: var(--p-medium) }`; update the "not five sizes" comment to name the real ladder (11/13/15 + one 26px display).
6. `.phone-seg`: add `mask-image` and `-webkit-mask-image: linear-gradient(to right, transparent 0, black 20px, black calc(100% - 20px), transparent 100%)`.
7. `PhoneTabs.tsx`: delete `phone-tab--capture` from the className (and its CSS rule); bump `PlusGlyph` `strokeWidth` to `2.0`. Add CSS `.phone-tab.is-current .phone-tab__glyph * { stroke-width: 1.8 }`.
8. `PhoneList.tsx`: empty state renders `<p className="phone-empty">{emptyCopyFor(list.id)}</p>` — no em dashes, no `list.hint`.
9. `PhoneList.tsx`: pass `childItems` to every `PhoneRow` (same `childrenByParent` map shape as `PhoneHome`) so a parent shows its `2/3 sub-cards` affordance on Lists too.

**Acceptance:** no computed `text-transform: uppercase` anywhere under the phone shell; `getComputedStyle(document.documentElement).getPropertyValue('--vvh')` is a px value after any sheet opens; shell root computed `position === "fixed"`; contrast of `--text-lo` on `--bg-1` ≥ 4.5:1 in both themes; the active tab's glyph `stroke-width` is 1.8 and inactive 1.6; all five tabs share one inactive colour; `.phone-seg` has a non-`none` `mask-image`.

### P3 — "sheets"
`Sheet.tsx`, `PhoneCapture.tsx`, `PhoneCardSheet.tsx`, `PhoneMore.tsx`, `PhoneSearch.tsx`, `PhoneBoards.tsx`, `PhoneReview.tsx`, `PhoneNote.tsx`, `PhoneTimeTravel.tsx`, the `/* phone sheets */` block.

1. `Sheet.tsx`: add `onFieldFocus`/`onFieldBlur` helpers exported for reuse — on focus, `requestAnimationFrame(() => window.scrollTo(0, 0))` and `document.documentElement.style.overflow = "hidden"`; on blur, clear the property. `.wm-sheet` gets `max-height: min(96svh, var(--vvh, 96svh))` and `transition: max-height var(--dur-kb) cubic-bezier(.32,.72,0,1)`. `scroll-padding-top: 8px` on `.wm-sheet__scroll`.
2. Buttons: `.wm-ph-btn--primary { border-color: var(--now-line); background: transparent; color: var(--now); }`. Add `.wm-ph-btn--ghost { border-color: transparent; background: transparent; color: var(--text-mid); }` and use it for Capture's Cancel (replacing `--auto`, keeping `width:auto`).
3. Fields: `.wm-ph-field { border: 0; border-bottom: 1px solid var(--veil-soft); border-radius: 0; background: transparent; padding: 10px 0; caret-color: var(--now); }` and `.wm-ph-field:focus { border-bottom-color: var(--now-line); outline: none; }`. `textarea.wm-ph-field { min-height: 96px }`.
4. `PhoneCapture.tsx`: `.wm-sheet--capture { height: auto; min-height: 0; max-height: min(92svh, var(--vvh, 92svh)); }`; `.wm-sheet--capture .wm-sheet__scroll { display: flex; flex-direction: column; }`; `.wm-sheet--capture .wm-ph-field { flex: 1 1 96px; }`. Chip row keeps `margin-top: 12px`; bar follows immediately. Keep `onOpenComplete` autofocus; add the focus/blur handlers from (1).
5. `PhoneSearch.tsx`: drop `heightSvh`; add `className="wm-sheet--search"` with `.wm-sheet--search { height: auto; max-height: min(92svh, var(--vvh, 92svh)); }` and `.wm-sheet--search .wm-sheet__head { border-bottom: 1px solid var(--veil-soft); padding: 6px 16px 0; }`. Input stays the first element, outside the scroller. Add `::-webkit-search-cancel-button { -webkit-appearance: none }` and a real 44×44 `.wm-ph-tap` clear button (`aria-label="Clear search"`), shown only when `q`.
6. `PhoneSearch.tsx`: section head → `<p className="wm-ph-sect">On the board</p>` / `Archived`, with `.wm-ph-sect { font-size: var(--p-meta); font-weight: var(--p-strong); letter-spacing: .02em; color: var(--text-mid); padding: 14px 16px 6px; }`. No inline `textTransform`/`letterSpacing`. Result rows use the ledger: `.wm-ph-row--ledger { min-height: 56px; border-radius: 0; border-bottom: 1px solid var(--veil-soft); padding: 8px 16px; }`. Archived suffix → `", archived"`. `aria-label={`${title}, in ${listLabel}${archived ? ", archived" : ""}`}` with inner spans `aria-hidden`. `Highlight`'s `<mark>` → `{ background: "var(--now-tint)", color: "var(--text-hi)", borderRadius: "3px" }`.
7. `PhoneCardSheet.tsx`: meta line → `{listLabel}` + `", "` + `{n} sub-cards` + `", "` + `{streak} in a row`. No `·`, anywhere in the file.
8. `PhoneCardSheet.tsx`: peek snap = `` `${180 + 56 * Math.min(kids.length, 3)}px` ``. Render sub-cards in peek when `kids.length <= 3`, and always when expanded, as `<PhoneRow item={k} dense onOpen={onOpenChild} today={today} />`. Delete the `↳` span and the text-only button.
9. `PhoneCardSheet.tsx`: back affordance — when `stack.current.length > 1`, render `<button className="wm-ph-back" aria-label={`Back to ${parentTitle}`}>` at the top-left of `.wm-sheet__head` calling `window.history.go(-1)`; above the title render the parent's name at 13px `--text-lo`. `.wm-ph-back { min-width: 44px; min-height: 44px; color: var(--text-mid); }` with the SVG chevron (no `‹` character).
10. `PhoneCardSheet.tsx`: delete the `Title` and `Details` caption labels. `Sub-cards` becomes a section head in the `.wm-ph-sect` grammar with a tabular count.
11. `PhoneMore.tsx` / `PhoneBoards.tsx`: `.wm-ph-row` for destinations → `border-radius: 0; border-bottom: 1px solid var(--veil-soft); padding: 10px 16px;` no inter-row gap. Replace every `›` / `>` text glyph with the SVG chevron path `M5.5 3.5L10.5 8l-5 4.5` at `stroke-width 1.6`. Explicit `aria-label` per row: `` `${label}. ${hint}` `` / `` `${b.name}, current board` ``, inner spans `aria-hidden`.
12. `PushSettings.tsx` is P3's for one line only: drop `uppercase tracking-[0.08em]` from the Notifications `<h2>`.
13. `PhoneNote.tsx` → "Carries over, changes remembered". `PhoneReview.tsx` → "Updated Sep 2" (drop the duplicated subtitle). `PhoneTimeTravel.tsx` → list name and count as two spans with an 8px gap, no dot.

**Acceptance:** no `·` character in any `components/phone/*.tsx`; no computed `text-transform: uppercase` in any sheet; search sheet height with two results < 60% of viewport height and the input's top edge stays within 8px of the sheet top after `page.setViewportSize(375, 430)` with the field still `document.activeElement`; capture sheet has zero gap > 24px between the chip row and the bar; card peek at 3 sub-cards exposes three `role="checkbox"` elements each ≥44×44 with titles at the same x as a Now row; no `.wm-ph-btn` has `--now` as its computed `background-color`; every `.wm-ph-row` has an `aria-label` containing a comma or a period.

---

## 4. What not to do

1. Do not add a shadow, a glow, a gradient, a blur, or a confetti — elevation is a luminance step and a hairline, full stop.
2. Do not write `·`, `—` as a separator, ALL CAPS, italics, or an appended `→` anywhere in the phone app.
3. Do not fill anything with full-strength `--now`; one full-strength amber per screen, and it belongs to the active tab or the caret.
4. Do not indent, shrink, re-glyph, or otherwise diminish a sub-card — it is the same row as its parent.
5. Do not touch the desktop board, `SwipeToArchive.tsx`, `ItemCard.tsx`, `Column.tsx`, `Board.tsx`, the `PhoneUI` interface, or another package's files or CSS selectors; never push.
6. Do not add a feature — no new sheet, no toast, no confirmation dialog, no second nav, no setting — to fix any finding above.