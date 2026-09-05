// Run: node components/phone/sheetSnaps.test.ts   (plain node script, same
// convention as components/collapsibleColumn.test.ts)
//
// Snap selection for the card sheet: which of ['180px', 0.92] is active, whether
// that counts as "expanded" (peek renders the title + Done control, full renders
// the detail), and when our own drag-to-dismiss affordance is allowed to fire.

import {
  CARD_SNAP_POINTS,
  canDragToDismiss,
  isExpanded,
  peekHeight,
  snapIndex,
  snapToPx,
} from "./sheetSnaps.ts";

let failures = 0;
function ok(label: string, got: unknown, want: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) {
    failures++;
    console.error(`✗ ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

// --- snapToPx ----------------------------------------------------------------

ok("a fraction resolves against the viewport", snapToPx(0.92, 812), 747);
ok("a px string is taken literally", snapToPx("180px", 812), 180);
ok("the same px snap on a bigger phone is the same size", snapToPx("180px", 932), 180);
ok("garbage is 0, never NaN", snapToPx("auto", 812), 0);

// --- snapIndex / isExpanded --------------------------------------------------

ok("null (not settled yet) reads as the opening snap", snapIndex(null, CARD_SNAP_POINTS), 0);
ok("the peek snap is index 0", snapIndex("180px", CARD_SNAP_POINTS), 0);
ok("the full snap is index 1", snapIndex(0.92, CARD_SNAP_POINTS), 1);
ok("an unknown value falls back to the peek", snapIndex(0.5, CARD_SNAP_POINTS), 0);

ok("peeking is not expanded", isExpanded("180px", CARD_SNAP_POINTS), false);
ok("null is not expanded", isExpanded(null, CARD_SNAP_POINTS), false);
ok("the full snap is expanded", isExpanded(0.92, CARD_SNAP_POINTS), true);

// --- canDragToDismiss --------------------------------------------------------

ok(
  "peek + scrolled to the top: a downward drag closes",
  canDragToDismiss("180px", CARD_SNAP_POINTS, 0),
  true,
);
ok(
  "peek + scrolled down: the drag is the list's, not the sheet's",
  canDragToDismiss("180px", CARD_SNAP_POINTS, 24),
  false,
);
ok(
  "expanded: a downward drag collapses to the peek, it does not close",
  canDragToDismiss(0.92, CARD_SNAP_POINTS, 0),
  false,
);
ok(
  "iOS rubber-band overscroll (negative scrollTop) still counts as the top",
  canDragToDismiss("180px", CARD_SNAP_POINTS, -12),
  true,
);

// --- peekHeight --------------------------------------------------------------

ok("the peek is 180px on a 375×812 phone", peekHeight(CARD_SNAP_POINTS, 812), 180);
ok("the peek is 180px on a 430×932 phone", peekHeight(CARD_SNAP_POINTS, 932), 180);
ok(
  "a window shorter than the peek clamps, so the Done control stays on screen",
  peekHeight(CARD_SNAP_POINTS, 140),
  140,
);

console.log(failures === 0 ? "\nall sheetSnaps tests passed" : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
