# Fluid time travel: cards that move through time, not pop

_Planned 2026-07-04. NOT built — awaiting owner green-light (plan-before-building)._

## Problem / idea
Scrubbing the time machine re-renders the snapshot instantly: cards vanish from
one column and appear in another. The owner wants to explore making them visibly
**move** — is that a good idea, and is it heavy?

## Verdict: good idea, cheap — IF motion is reserved for discrete steps
Motion here isn't decoration; it expresses the product's core claim. A card
gliding from Today back to Waiting says "same item, earlier in its life" —
instant swaps read as "a different board". And the payoff moment is precise:
press ▶ and watch exactly the one card that changed make its move.

The trap is animating **during** the drag. `onChange` fires at pointer rate
(60–120Hz); tweens would pile up, smear, and never settle, while burning layout
work per tick. So the design splits by input:

- **Continuous drag** → stays instant, exactly as today (it already feels
  "live"; the existing `memory-mode` desaturation carries the past-ness).
- **Discrete transitions** → animate: ◀/▶ steps, relative chips, the soft-snap
  on drag release, the exact-time input, entering the time machine, and "Back
  to now". The scrubber already separates these code paths
  (`TimeMachineBar.tsx`: `onChange` vs `onPointerUp`/`stepTo`/chips), so the
  hook point is a flag on `onPick` — no rearchitecting.

## Mechanism: View Transitions API (recommended) — zero deps, zero bundle
The snapshot render path is ideal for it: `SnapshotColumn` cards are plain
keyed buttons (no dnd-kit, no virtualization), ids stable across snapshots.

- Tag every top-level card — live board AND snapshot — with
  `viewTransitionName: it-<item.id>` (unique by construction; sub-cards don't
  render on the board, so ~40–60 names at current scale — well within budget).
- Discrete updates go through one helper:
  ```ts
  function withBoardTransition(update: () => void) {
    if (!document.startViewTransition || prefersReducedMotion) return update();
    document.startViewTransition(() => flushSync(update));
  }
  ```
  The browser FLIPs matched names automatically: moved cards glide between
  columns, cards that didn't exist yet fade out, done-state/size changes morph.
  Enter/exit of the time machine animates for free because live cards carry the
  same names as their snapshot twins.
- Tune in CSS (`::view-transition-group(*) { animation-duration: .3s; ... }`)
  with the existing gentle easing; keep it matte — movement, no flourishes.
- Fallbacks are graceful no-ops: feature-detect (older Firefox/Safari simply
  keep today's instant behavior), `prefers-reduced-motion` skips entirely
  (the global CSS kill-switch already covers the pseudo-elements too).

**Gotchas checked against the code:**
- dnd-kit interplay: view transitions only run when we call
  `startViewTransition`, which never happens mid-card-drag — the names are
  inert during dnd. (Still verify DragOverlay isn't captured oddly.)
- The root snapshot freezes the page ~300ms per transition — fine, the
  time-machine board is read-only anyway; guard against overlapping calls
  (skip if a transition is in flight).
- `memory-mode` filter flip on enter/exit becomes a soft crossfade via the root
  snapshot — a bonus, not a bug.
- React 18/Next 14: use the raw API + `flushSync` (React 19's
  `<ViewTransition>` isn't available here).

**Rejected:** framer-motion `layout` (~35kB gz onto a First Load JS the project
fights to hold at 118kB, for one interaction); hand-rolled FLIP (~150 lines we'd
own — only worth it if View Transitions proves quirky, keep as fallback).

## Phase 2 (optional, may ship first if motion feels wrong)
**Change highlight**: when stepping ◀/▶, the tick IS a known event — briefly
pulse the affected card's left edge amber (`--now`). Dirt cheap, arguably more
legible than motion, and composes with it.

## Effort / risk
- ~60–100 lines + a small CSS block; half a day incl. tuning. No schema, no
  deps, no server changes; touches `Board.tsx`, `TimeMachineBar.tsx` (an
  `animate` flag on `onPick`), `globals.css`.
- Motion is browser-only to verify — owner eyeball required (drag, release,
  step, chips, enter/exit, reduced-motion on, phone).
- Honest caveat to expectations: the drag itself stays instant by design. If
  "fluid while dragging" is the wish, the experiment is throttling animated
  updates to ~150ms cadence during drag — flagged, off by default, likely to
  feel laggier rather than more fluid.
