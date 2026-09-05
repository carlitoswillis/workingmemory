"use client";

import { useEffect, useState } from "react";
import { keyboardInset } from "./keyboardInset.ts";

// The one place the app learns how tall the soft keyboard is (spec §4). Every phone
// sheet pads its bottom bar by this so the Save control never ends up under the keys.
//
// Two consumers, one subscription: `PhoneShell` exposes the number as `PhoneUI.kbInset`
// for React layout, and this hook ALSO mirrors it onto the document element as `--kb`
// so CSS (the `/* phone sheets */` block in globals.css) can use it without prop
// drilling. `--kb` is written at runtime, never declared in a stylesheet, so nothing
// collides with another package's `:root` block.
//
// visualViewport is the only signal that works on iOS; where it's missing (very old
// browsers, SSR) the inset is simply always 0 and the layout is the no-keyboard one.

const KB_VAR = "--kb";

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let raf = 0;
    const read = () => {
      cancelAnimationFrame(raf);
      // Coalesce the burst of resize/scroll events iOS fires while the keyboard
      // animates in — one measurement per frame is plenty.
      raf = requestAnimationFrame(() => {
        setInset(
          keyboardInset({
            innerHeight: window.innerHeight,
            viewportHeight: vv.height,
            offsetTop: vv.offsetTop,
            scale: vv.scale,
          }),
        );
      });
    };

    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
      document.documentElement.style.removeProperty(KB_VAR);
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(KB_VAR, `${inset}px`);
  }, [inset]);

  return inset;
}

export default useKeyboardInset;
