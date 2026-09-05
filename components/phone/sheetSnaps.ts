// Snap-point arithmetic for the phone sheets (spec §4). Pure, so it can be tested
// with plain node — see ./sheetSnaps.test.ts.
//
// Vaul takes snap points as either a fraction of the viewport (0.92 = 92% tall) or a
// CSS px string ("180px"). The card sheet uses BOTH: a fixed-height peek that has to
// fit the title + a full-width Done control in the thumb zone whatever the phone, and
// a proportional full state. Everything that needs to know "are we peeking or
// expanded?" — the peek/full rendering switch, the drag-to-dismiss guard — goes
// through `isExpanded` rather than comparing snap values by hand.

export type SnapPoint = number | string;

// Card detail: peek, then near-full. Fixed px first so the peek is the same physical
// size on a 375×812 SE and a 430×932 Pro Max (spec §11 acceptance).
export const CARD_SNAP_POINTS: SnapPoint[] = ["180px", 0.92];

// Capture is a single snap — one textarea, a list chooser and a Save bar.
export const CAPTURE_SNAP_POINTS: SnapPoint[] = [0.5];

// Search / Note / Time travel are effectively full-height screens in a sheet.
export const FULL_SNAP_POINTS: SnapPoint[] = [0.96];

// More / list picker.
export const MENU_SNAP_POINTS: SnapPoint[] = [0.45];

/** Resolve one snap point to pixels against a viewport height. */
export function snapToPx(point: SnapPoint, viewportHeight: number): number {
  if (typeof point === "number") return Math.round(point * viewportHeight);
  const px = Number.parseFloat(point);
  return Number.isFinite(px) ? Math.round(px) : 0;
}

/**
 * Which snap point is active. Vaul reports the active point by VALUE (the same
 * number/string from the array), and `null` before the sheet has settled — which we
 * read as the first (smallest) point, the state a sheet opens at.
 */
export function snapIndex(active: SnapPoint | null | undefined, points: SnapPoint[]): number {
  if (active == null) return 0;
  const i = points.findIndex((p) => p === active);
  return i >= 0 ? i : 0;
}

/** True once the sheet is past its peek — the full detail view. */
export function isExpanded(active: SnapPoint | null | undefined, points: SnapPoint[]): boolean {
  return snapIndex(active, points) > 0;
}

/**
 * Drag-to-dismiss is allowed only from the top of an inner scroller (spec §4), and
 * only from the sheet's smallest snap — dragging down while expanded should collapse
 * to the peek, not close. Vaul does the collapse itself; this gates OUR handlers
 * (the peek's own drag affordance) so they never fight it.
 */
export function canDragToDismiss(
  active: SnapPoint | null | undefined,
  points: SnapPoint[],
  scrollTop: number,
): boolean {
  return scrollTop <= 0 && !isExpanded(active, points);
}

/**
 * The height the peek actually gets. Vaul honours a px snap point exactly, so this is
 * mostly a guard for absurd viewports (a landscape phone shorter than the peek) —
 * never let the peek exceed the window, or the Done control lands off-screen.
 */
export function peekHeight(points: SnapPoint[], viewportHeight: number): number {
  const first = points[0];
  if (first == null) return 0;
  return Math.min(snapToPx(first, viewportHeight), viewportHeight);
}
