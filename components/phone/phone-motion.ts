// Motion tokens for the phone app (spec §6). One place, so a row's check, a page
// snap and a sheet's release all speak the same language.
//
// Springs ONLY where a finger is involved — the check (which the thumb starts) and
// the sheet's gesture handoff. Everything programmatic is a ≤260ms ease-out curve.
//
// Reduced motion: `app/globals.css` already zeroes every animation/transition
// duration with `!important`, which beats inline styles — so CSS-driven motion needs
// no per-component media query and none is added here. What CSS can't reach is the
// JS side: spring parameters and the timers that pace a sequence. So the preference
// is read ONCE here and `M` is exported with the springs swapped for `{duration: 1}`.
// `matchMedia` is guarded for the server render; the tokens are only ever consumed by
// imperative code (timers, class toggles), never by SSR'd markup, so the two passes
// can disagree without a hydration mismatch.

export type MotionToken = {
  type?: "spring";
  duration?: number; // ms
  ease?: string;
  stiffness?: number;
  damping?: number;
};

export type MotionTokens = {
  tapScale: MotionToken;
  check: MotionToken;
  rowCollapse: MotionToken;
  reorder: MotionToken;
  sheetOpen: MotionToken;
  sheetDrag: MotionToken;
  // The one non-finger motion in the app, and it is earned: a sheet resizing to
  // track the software keyboard. The alternative is the jump.
  kbTrack: MotionToken;
  pageSnap: "native";
  milestone: MotionToken;
};

const BASE: MotionTokens = {
  tapScale: { duration: 90, ease: "cubic-bezier(.2,0,.2,1)" }, // :active press
  check: { type: "spring", stiffness: 320, damping: 18 }, // ~140ms, slight overshoot
  rowCollapse: { duration: 180, ease: "cubic-bezier(.4,0,.2,1)" }, // height+opacity out
  reorder: { duration: 220, ease: "cubic-bezier(.15,1,.3,1)" }, // sortable settle
  sheetOpen: { duration: 260, ease: "cubic-bezier(.32,.72,0,1)" },
  sheetDrag: { type: "spring", stiffness: 400, damping: 40 }, // gesture handoff
  kbTrack: { duration: 160, ease: "cubic-bezier(.32,.72,0,1)" }, // sheet ↔ keyboard
  pageSnap: "native", // browser scroll-snap; never JS
  milestone: { duration: 400, ease: "ease-out" }, // 7/30/100 only
};

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const REDUCED = prefersReducedMotion();

export const M: MotionTokens = REDUCED
  ? { ...BASE, check: { duration: 1 }, sheetDrag: { duration: 1 } }
  : BASE;

// A token's wall-clock length, for the JS timers that pace a sequence (the 900ms
// undo window, then the collapse). A spring has no duration of its own — these are
// the settle times the §6 constants were chosen for.
const SPRING_SETTLE: Record<string, number> = { check: 140, sheetDrag: 220 };
export function msOf(name: keyof MotionTokens): number {
  const t = M[name];
  if (t === "native") return 0;
  if (typeof t.duration === "number") return t.duration;
  return SPRING_SETTLE[name] ?? 200;
}

// How long a checked row sits in place with its inline Undo before it collapses
// into "Done today" (spec §3.5).
export const UNDO_MS = 900;

// Best-effort haptic. Never load-bearing: Android gets the Vibration API; iOS gets
// the switch-checkbox trick (Safari 17.4+, regressed in iOS 26.5), which is why the
// whole thing is one try/catch and a silent no-op everywhere else. The probe input is
// created imperatively rather than rendered, so it never lands in React's tree — and
// it carries a 16px font-size so it can never be the reason iOS zooms the page.
let hapticInput: HTMLInputElement | null = null;
export function haptic(): void {
  if (typeof window === "undefined") return;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(8);
      return;
    }
  } catch {
    /* no-op */
  }
  try {
    if (!("switch" in HTMLInputElement.prototype)) return;
    if (!hapticInput) {
      const el = document.createElement("input");
      el.type = "checkbox";
      el.setAttribute("switch", "");
      el.setAttribute("aria-hidden", "true");
      el.tabIndex = -1;
      el.style.cssText =
        "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;font-size:16px;pointer-events:none";
      document.body.appendChild(el);
      hapticInput = el;
    }
    hapticInput.click();
  } catch {
    /* no-op */
  }
}
