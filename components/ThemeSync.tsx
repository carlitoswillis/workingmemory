"use client";

import { useEffect } from "react";
import { applyPref, readPref, watchTheme } from "@/lib/theme";

// Runtime half of the theme rule (the pre-paint half is THEME_INIT in
// app/layout.tsx): re-apply on mount in case storage changed since paint, then
// follow the system while the preference is "system" and other tabs otherwise.
export default function ThemeSync() {
  useEffect(() => {
    applyPref(readPref());
    return watchTheme();
  }, []);
  return null;
}
