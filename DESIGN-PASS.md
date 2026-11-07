# Design pass, 2026-11-07

A pass, not a rebuild. The dateline and the review ledger (2026-09-19) stay as they
are; everything here tightens the board around them. Screens: `screens/before/`
and `screens/after/` (1440x900 desktop, 390x844 phone, dark and light).

## Diagnosis (ranked)

1. **The recency edge is broken in light mode.** `ItemCard` interpolates the left
   edge between two RGB literals tuned for the dark ground, so on Nocturne Day every
   untouched card carries a near-black 2px bar: the board's one history signal reads
   as heavy, random borders. It is also the only colour literal in a component.
2. **Boxes in boxes.** Each column is a bordered panel holding a bordered capture
   field holding a placeholder, then bordered cards; the Note column adds a bordered
   field inside its panel; the archive drawer boxes every row and every Restore. The
   five identical "Capture a thought..." fields are the loudest repeated shape on the
   page and they reserve 54px per column at rest.
3. **The stock "AI" label voice survives on desktop.** 10-11px tracked-out caps
   (`DONE · 2`, `DETAILS`, `SUB-CARDS`, `LIST`, `INSIDE`, `OPENS`, search groups,
   board switcher, swipe action), which the phone shell already retired.
4. **Defaults showing.** Browser-blue focus ring on header buttons; `shadow-2xl` on
   every floating thing (FABs, toasts, drawers, drag overlay), which reads as glow on
   the warm paper; header controls in two shapes (pills next to rounded squares).
5. **Phone check at rest.** The 35%-drawn resting tick reads as a smile inside the
   circle at 390px.

## The one idea

**The board is a ledger of attention: quiet paper everywhere, and the only warmth on
a card is how recently your mind was on it.** Amber already means "now" on the
dateline; the card edge carries the same meaning across the board, fading to nothing
as a card goes stale. Every other surface steps back so that signal can be read.

## System

- **Type** (unchanged scale, enforced): 11 caption / 13.5 card + control / 15 column
  title (Fraunces 500) / 36 moment. One label style, `.wm-label`: 11px, 590, sentence
  case, +0.02em, `--text-lo`. No uppercase anywhere on the board.
- **Spacing:** 4px unit. Inside a card 6px; card to card 6px; header to stack 12px;
  column padding 12px; column to column 16px. Group gap is always smaller than the
  gap around it.
- **Colour roles** (both themes, tokens only):
  - ground `--bg-0/--bg-1`, surface `--surface`, ink `--text-hi`, muted `--text-mid/lo`,
    line `--veil/--veil-soft`
  - signal `--now` (amber): the live dot, the fresh card edge, Back to now. Nothing else.
  - past `--past`: time-travel only, plus the details dot.
  - new: `--edge-fresh` / `--edge-stale` (the recency ramp's ends, per theme) and
    `--float` (one matte shadow for anything that floats: hairline + short soft drop).
- **Focus:** one ring for the desktop, 2px `--text-mid` at 2px offset. Amber is not
  spent on focus (same rule the phone shell already follows).

## Changes

- Recency edge: `color-mix()` between `--edge-stale` and `--edge-fresh`; stale cards
  show no edge at all (it equals the card's hairline), fresh cards a warm 2px edge.
  Light and dark tuned separately. Removes the component colour literal.
- Column capture: the boxed field becomes a quiet `+ Add a card` line under the
  header. Same input, same Enter/blur-commits behaviour, always visible (touch-safe);
  it gains its field ground and hairline only on focus.
- Column drag handle: hidden at rest on fine pointers, shown on hover/focus, always
  visible on touch (the existing `.card-actions` pattern).
- `Done · 2` becomes `Done 2` in `.wm-label`; the empty-column line becomes the
  interface voice ("Nothing here yet.") in sans at caption size.
- Every tracked caps label on desktop (card panel, search, board switcher, swipe,
  nest hint) moves to `.wm-label`.
- Card panel: List / Inside / Opens / Repeats share one 48px label column, so every
  field starts on one edge (the repeat row's lone ↻ glyph became a "Repeats" label).
- The column drag handle hangs in the column's left padding, so the title and its
  hint share one left edge; rename/delete use the same touch-visible pattern instead
  of hover-only opacity.
- The swipe-to-archive layer is not painted at rest, so a card fading in no longer
  shows "Archive" through itself.
- `shadow-2xl` replaced everywhere on desktop by `.wm-float` (matte, theme-aware).
- Header: Archive and the theme toggle take the same 28px pill as the board switcher
  and the account chip.
- Global desktop `:focus-visible` ring; the ruler's amber focus outline becomes the
  same ring.
- Note column: the rendered note sits on the column instead of in a second bordered
  box; the field appears when editing.
- Archive drawer (desktop and phone): ledger rows (hairline between, no per-row box), quiet text Restore
  that turns amber on hover, list name as plain caption, dates drop the current year.
- Phone: the check's tick is hidden at rest and draws in from the same 35% start on
  completion; the Now feed's first section sits 12px closer to the ruler.

## Not changed (deliberately)

The dateline, ruler, review ledger, phone rows and sheets, tab bar, palette values,
fonts, card height, column widths, all behaviour.
