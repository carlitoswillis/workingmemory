// Run: node components/phone/keyboardInset.test.ts   (plain node script, same
// convention as components/collapsibleColumn.test.ts and lib/*.test.ts)
//
// The keyboard-inset arithmetic behind every phone sheet's padding-bottom. The
// cases that matter are the ones that AREN'T a keyboard: Safari's collapsing
// toolbar (a ~50px difference on every scroll) and pinch-zoom (which shrinks
// visualViewport.height by a lot). Both must read as 0, or the sheet's bottom bar
// jitters while you scroll and jumps while you zoom.

import { keyboardInset, keyboardInsetPx, MIN_KEYBOARD_PX } from "./keyboardInset.ts";

let failures = 0;
function ok(label: string, got: unknown, want: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) {
    failures++;
    console.error(`✗ ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

// --- closed keyboard ---------------------------------------------------------

ok("no keyboard: visual viewport equals window", keyboardInset({ innerHeight: 812, viewportHeight: 812 }), 0);
ok(
  "Safari's collapsing toolbar is not a keyboard",
  keyboardInset({ innerHeight: 812, viewportHeight: 812 - (MIN_KEYBOARD_PX - 1) }),
  0,
);
ok(
  "a visual viewport TALLER than the window clamps to 0",
  keyboardInset({ innerHeight: 812, viewportHeight: 900 }),
  0,
);

// --- open keyboard -----------------------------------------------------------

ok(
  "iPhone 12/13/14 keyboard (~336px) is reported in full",
  keyboardInset({ innerHeight: 812, viewportHeight: 476 }),
  336,
);
ok(
  "offsetTop (page scrolled under the keyboard) is subtracted too",
  keyboardInset({ innerHeight: 812, viewportHeight: 476, offsetTop: 40 }),
  296,
);
ok(
  "fractional viewport heights round to a whole pixel",
  keyboardInset({ innerHeight: 812, viewportHeight: 475.4 }),
  337,
);

// --- guards ------------------------------------------------------------------

ok(
  "a pinch-zoomed page reports no keyboard",
  keyboardInset({ innerHeight: 812, viewportHeight: 300, scale: 2 }),
  0,
);
ok(
  "scale ~1 (rounding noise) is still treated as unzoomed",
  keyboardInset({ innerHeight: 812, viewportHeight: 476, scale: 1.0000001 }),
  336,
);
ok(
  "an absurd difference clamps to 75% of the window",
  keyboardInset({ innerHeight: 812, viewportHeight: 10 }),
  609,
);
ok("NaN metrics are 0, never NaN", keyboardInset({ innerHeight: NaN, viewportHeight: 476 }), 0);
ok("a zero-height window is 0", keyboardInset({ innerHeight: 0, viewportHeight: 0 }), 0);

// --- the CSS length ----------------------------------------------------------

ok("px formatting, closed", keyboardInsetPx({ innerHeight: 812, viewportHeight: 812 }), "0px");
ok("px formatting, open", keyboardInsetPx({ innerHeight: 812, viewportHeight: 476 }), "336px");

console.log(failures === 0 ? "\nall keyboardInset tests passed" : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
