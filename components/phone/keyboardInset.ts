// The soft-keyboard inset, as pure arithmetic (the hook that feeds it live numbers
// is ./useKeyboardInset.ts). Split out so it can be unit-tested with plain node —
// same convention as components/collapsibleColumn.ts.
//
// iOS does not resize the layout viewport when the keyboard comes up: it shrinks the
// VISUAL viewport and, when the page has scrolled under the keyboard, offsets it.
// `interactive-widget=resizes-content` fixes this on Chrome only, so the JS path is
// the one that works on the phone this app is actually for. The inset is therefore
//
//   innerHeight - (visualViewport.height + visualViewport.offsetTop)
//
// applied as padding-bottom on sheet content so a Save button stays above the keys.

export type ViewportMetrics = {
  innerHeight: number;
  viewportHeight: number;
  offsetTop?: number;
  scale?: number;
};

// Below this, the difference is browser chrome (Safari's collapsing toolbar), not a
// keyboard — padding the sheet for it would jitter the layout on every scroll.
export const MIN_KEYBOARD_PX = 60;

// A keyboard never covers more than this share of the window. Anything larger is a
// pinch-zoom artefact (visualViewport.height also shrinks when the user zooms).
export const MAX_KEYBOARD_RATIO = 0.75;

/**
 * How many pixels the on-screen keyboard is covering, or 0 when it's closed.
 * Always a non-negative integer, so it can be written straight into a px length.
 */
export function keyboardInset(m: ViewportMetrics): number {
  if (!Number.isFinite(m.innerHeight) || !Number.isFinite(m.viewportHeight)) return 0;
  if (m.innerHeight <= 0) return 0;
  // A pinch-zoomed page reports a smaller visual viewport with no keyboard at all.
  if (m.scale != null && m.scale > 1.01) return 0;

  const raw = m.innerHeight - (m.viewportHeight + (m.offsetTop ?? 0));
  if (!Number.isFinite(raw) || raw < MIN_KEYBOARD_PX) return 0;
  return Math.round(Math.min(raw, m.innerHeight * MAX_KEYBOARD_RATIO));
}

/** The CSS length written to `--kb` (and to a sheet's padding-bottom). */
export function keyboardInsetPx(m: ViewportMetrics): string {
  return `${keyboardInset(m)}px`;
}
