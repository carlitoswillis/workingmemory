// Run: node components/phone/installPrompt.test.ts   (plain node script, same
// convention as components/collapsibleColumn.test.ts)
//
// The install-help card's gating. iOS offers no install API, so the card is only
// ever an explanation of Share → Add to Home Screen — which makes WHEN it appears
// the whole feature. Two ways to get it wrong: showing it to someone already running
// the installed app (advice that makes no sense where they're standing), and showing
// it again after they said no.

import { shouldOfferInstall } from "./installPrompt.ts";

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

ok(
  "a plain browser tab, never dismissed: offer it",
  shouldOfferInstall({ standalone: false, dismissed: false }),
  true,
);
ok(
  "dismissed once: never again",
  shouldOfferInstall({ standalone: false, dismissed: true }),
  false,
);
ok(
  "display-mode: standalone — already installed",
  shouldOfferInstall({ standalone: true, dismissed: false }),
  false,
);
ok(
  "navigator.standalone alone is enough (the signal iOS actually sets)",
  shouldOfferInstall({ standalone: false, iosStandalone: true, dismissed: false }),
  false,
);
ok(
  "installed beats not-dismissed, both ways round",
  shouldOfferInstall({ standalone: true, iosStandalone: true, dismissed: false }),
  false,
);
ok(
  "an explicit false for the iOS flag doesn't override the media query",
  shouldOfferInstall({ standalone: true, iosStandalone: false, dismissed: false }),
  false,
);

console.log(failures === 0 ? "\nall installPrompt tests passed" : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
