"use client";

import { useEffect, useState } from "react";
import { keyboardInset, visualViewportVars } from "./keyboardInset.ts";

// The one place the app learns how big the visible viewport actually is (spec §4).
// It is the fix for the owner's bug, and it is the whole contract the sheets build on.
//
// iOS does not resize the layout viewport for the keyboard: it shrinks the VISUAL
// viewport and, if the page can scroll, slides the layout viewport up to chase the
// caret — which is exactly why "the whole app is floated up, I can't see the entry
// box but can see some results". `svh`/`dvh` cannot see any of that. So this hook
// mirrors three numbers onto `document.documentElement`, and the shell and every
// sheet are measured against them instead:
//
//   --kb       how much the keyboard covers (the sheet's `bottom`, so the box sits
//              ON the keys rather than behind them)
//   --vvh      the height of what you can SEE (the shell's height while a sheet is up,
//              and every sheet's max-height)
//   --vvh-top  how far the visual viewport has slid down the layout viewport
//
// documentElement, not the shell element: Vaul portals every sheet to <body>, so a
// variable set on the shell div is invisible to the sheet floating above it. While
// these lived on the shell every sheet read --kb as 0 and the bug was hidden; moving
// them here is what made the numbers real, and what exposed the sheet rules that were
// spending them twice. Each of --kb and --vvh is spent in exactly ONE place now (the
// `.wm-sheet` rule in app/globals.css), and <Sheet> turns Vaul's own repositionInputs
// off for every sheet these describe, so nothing else writes height or bottom on
// those drawers. A snapped sheet (the card) is the exception, and Vaul keeps the
// keyboard there — see the prop in ./Sheet.tsx.
//
// visualViewport is the only signal that works on iOS; where it's missing (very old
// browsers, SSR) the inset is 0 and the layout is the no-keyboard one.

const KB_VAR = "--kb";
const VVH_VAR = "--vvh";
const VVH_TOP_VAR = "--vvh-top";

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const root = document.documentElement;
    let raf = 0;
    const read = () => {
      cancelAnimationFrame(raf);
      // Coalesce the burst of resize/scroll events iOS fires while the keyboard
      // animates in — one measurement per frame is plenty, and writing the vars
      // inside the frame keeps the sheet's height on the same tick as the paint.
      raf = requestAnimationFrame(() => {
        const m = {
          innerHeight: window.innerHeight,
          viewportHeight: vv.height,
          offsetTop: vv.offsetTop,
          scale: vv.scale,
        };
        const vars = visualViewportVars(m);
        root.style.setProperty(KB_VAR, vars.kb);
        root.style.setProperty(VVH_VAR, vars.vvh);
        root.style.setProperty(VVH_TOP_VAR, vars.vvhTop);
        setInset(keyboardInset(m));
      });
    };

    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    window.addEventListener("orientationchange", read);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
      window.removeEventListener("orientationchange", read);
      root.style.removeProperty(KB_VAR);
      root.style.removeProperty(VVH_VAR);
      root.style.removeProperty(VVH_TOP_VAR);
    };
  }, []);

  return inset;
}

export default useKeyboardInset;
