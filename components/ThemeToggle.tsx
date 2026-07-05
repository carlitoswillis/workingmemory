"use client";

import { useEffect, useState } from "react";

// Dark (Nocturne, default) ⇄ light ("Nocturne Day") switch. A device-level
// preference, not account data: stored in localStorage("wm-theme") and applied
// as html[data-theme]. The pre-paint half lives in app/layout.tsx (THEME_INIT);
// this button just flips the attribute + storage. Server-renders in the
// dark/null state; the mount effect syncs it to whatever THEME_INIT applied.
export default function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.dataset.theme === "light");
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    if (next) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("wm-theme", next ? "light" : "dark");
    } catch {
      // storage unavailable (private mode etc.) — theme still applies for the page
    }
  }

  return (
    <button
      onClick={toggle}
      title={light ? "Switch to dark" : "Switch to light"}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border border-[var(--veil-soft)] text-[var(--text-mid)] transition-colors hover:border-[var(--text-lo)] hover:text-[var(--text-hi)]"
    >
      {light ? (
        // sun
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4.4" />
          <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7" />
        </svg>
      ) : (
        // moon
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
          <path d="M20.6 14.1A8.6 8.6 0 1 1 9.9 3.4a7 7 0 1 0 10.7 10.7Z" />
        </svg>
      )}
    </button>
  );
}
