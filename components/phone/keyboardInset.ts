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

/** The three custom properties the phone shell publishes on `document.documentElement`. */
export type ViewportVars = {
  /** `--kb` — how much the keyboard is covering. */
  kb: string;
  /** `--vvh` — the height of what the user can actually SEE, keyboard subtracted. */
  vvh: string;
  /** `--vvh-top` — how far the visual viewport has slid down the layout viewport. */
  vvhTop: string;
};

/**
 * Every viewport number the CSS needs, in one pure pass.
 *
 * `--vvh` is the one that fixes the owner's bug. `svh`/`dvh` describe the LAYOUT
 * viewport, which iOS does not shrink for a keyboard, so a `100svh` sheet is taller
 * than the screen the moment you type in it and Safari scrolls the layout viewport to
 * chase the caret. `visualViewport.height` is the only number that knows about the
 * keyboard, so it is the one the shell and every sheet are measured against.
 *
 * Guarded the same way `keyboardInset` is: a pinch-zoomed or nonsense viewport falls
 * back to the window height rather than collapsing the app to a sliver.
 */
export function visualViewportVars(m: ViewportMetrics): ViewportVars {
  const kb = keyboardInset(m);
  const usable =
    Number.isFinite(m.viewportHeight) && m.viewportHeight > 0 && (m.scale == null || m.scale <= 1.01)
      ? Math.min(m.viewportHeight, Number.isFinite(m.innerHeight) && m.innerHeight > 0 ? m.innerHeight : m.viewportHeight)
      : Number.isFinite(m.innerHeight) && m.innerHeight > 0
        ? m.innerHeight
        : 0;
  const top = kb > 0 && Number.isFinite(m.offsetTop ?? 0) ? Math.max(0, Math.round(m.offsetTop ?? 0)) : 0;
  return { kb: `${kb}px`, vvh: `${Math.round(usable)}px`, vvhTop: `${top}px` };
}
