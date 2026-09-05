// Theme preference: a device-level choice, not account data.
//
// localStorage("wm-theme") holds "light" or "dark" when the person chose one
// explicitly; when the key is absent the app follows the system. The pre-paint
// script in app/layout.tsx (THEME_INIT) applies the same rule before hydration so
// there is no flash; this module is the runtime half. Keep the two in sync.

export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "wm-theme";

/** Which theme to paint for a preference, given what the system currently prefers. */
export function resolveTheme(pref: ThemePref, systemPrefersLight: boolean): Theme {
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  return systemPrefersLight ? "light" : "dark";
}

/** Parse whatever is in storage into a preference; anything unexpected is "system". */
export function parsePref(stored: string | null | undefined): ThemePref {
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function readPref(): ThemePref {
  try {
    return parsePref(localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

export function writePref(pref: ThemePref): void {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // storage unavailable (private mode etc.) — the page still repaints below
  }
}

function systemPrefersLight(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches;
}

/** Paint the resolved theme onto <html>. Light is an attribute; dark is its absence. */
export function applyPref(pref: ThemePref): Theme {
  const theme = resolveTheme(pref, systemPrefersLight());
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  return theme;
}

/**
 * Keep <html> in step with the system while the preference is "system", and with
 * other tabs when they change the stored preference. Returns the unsubscribe.
 */
export function watchTheme(): () => void {
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;
  const onSystem = () => {
    if (readPref() === "system") applyPref("system");
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY || e.key === null) applyPref(readPref());
  };
  mq?.addEventListener("change", onSystem);
  window.addEventListener("storage", onStorage);
  return () => {
    mq?.removeEventListener("change", onSystem);
    window.removeEventListener("storage", onStorage);
  };
}
