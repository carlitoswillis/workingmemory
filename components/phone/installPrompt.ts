// Whether to offer the "add this to your home screen" card (spec §7).
//
// iOS gives web pages no `beforeinstallprompt` and no install API at all, so the
// only thing an app can do is EXPLAIN the Share → Add to Home Screen steps. That
// makes the gating the entire feature: shown to someone who has already installed,
// the card is nonsense; shown again after they've dismissed it, it's nagging.
//
// Pure, so the decision is testable without a browser — see ./installPrompt.test.ts.

export const INSTALL_DISMISSED_KEY = "wm:phone:install-dismissed";

export type InstallState = {
  /** `(display-mode: standalone)` — true inside a home-screen install. */
  standalone: boolean;
  /** Safari's own flag, which is what actually reports true on iOS. */
  iosStandalone?: boolean;
  /** The card was dismissed before. */
  dismissed: boolean;
};

/**
 * Offer the install card only in a browser tab, and only until it's dismissed.
 * Either standalone signal is enough: `display-mode: standalone` is the standard and
 * `navigator.standalone` is the one iOS has reported reliably for longer, so an app
 * already on the home screen never sees the card because one of them was missing.
 */
export function shouldOfferInstall(s: InstallState): boolean {
  if (s.standalone || s.iosStandalone) return false;
  return !s.dismissed;
}

/** Read the live state from the browser. Safe to call during SSR (returns installed). */
export function readInstallState(): InstallState {
  if (typeof window === "undefined") {
    // On the server, assume installed: rendering the card and then hiding it on
    // hydration is a visible flash of advice the reader may not need.
    return { standalone: true, dismissed: false };
  }
  let dismissed = false;
  try {
    dismissed = window.localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    // Private mode / storage disabled: treat it as never dismissed rather than
    // letting a throw take the whole sheet down.
  }
  return {
    standalone: window.matchMedia?.("(display-mode: standalone)").matches ?? false,
    iosStandalone:
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
    dismissed,
  };
}

export function rememberInstallDismissed(): void {
  try {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
  } catch {
    /* nothing to do — the card just comes back next time */
  }
}
