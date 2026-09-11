#!/usr/bin/env node
// The card sheet's history contract, driven headlessly.
//
//   node scripts/dev/assert-phone-history.mjs
//   PHONE_HISTORY_PORT=3141 node scripts/dev/assert-phone-history.mjs
//
// WHY THIS EXISTS. Ticking a sub-card inside a card sheet froze the app (backlog A1).
// The mechanism: completing a sub-card runs a server action whose `revalidatePath`
// makes Next's App Router call `history.replaceState` with only its own router tree,
// which wipes any key of ours off the CURRENT entry. The old code kept the phone's
// navigation state THERE — `wmSheet` on the shell, `wmPhoneDepth` on the sheet — so
// the next back gesture read "no sheet, depth 0", closed the sheet, and the sheet's
// unmount cleanup then called `history.go(-n)` for entries the browser had already
// taken. In an installed PWA that leaves the app on a dead entry until relaunch.
//
// The fix moved every phone history entry under one owner (PhoneShell's level stack,
// counted in a ref and never read back out of history.state). This script is the
// regression guard for that, and it asserts the three things the bug broke:
//
//   1. after a sub-card toggle round trip, the sheet is still open and the app has
//      neither pushed a new entry nor given one back — while Next's replaceState HAS
//      fired, so the conditions that used to break it are genuinely present;
//   2. ONE back gesture steps sub-card -> parent (not whole-sheet close), and the app
//      emits no extra history.go() of its own while the browser is doing it;
//   3. a second sub-card toggle still works, and closing the sheet gives back exactly
//      as many entries as were pushed, in exactly one jump (the old close path popped
//      twice).
//
// It drives the real demo board (DEMO_MODE=1 seeds ~3 weeks of history, including one
// Focus card with two sub-cards) on a dev server with its own throwaway DATA_DIR, so
// the repo's data/ is never touched.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VIEWPORT = { width: 375, height: 812 };
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

let fails = 0;
const ok = (label, pass, detail = "") => {
  if (pass) console.log(`✓ ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fails++;
    console.error(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function waitForServer(url, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server never came up at ${url}`);
}

// ---- the server -------------------------------------------------------------
// `npm run dev:demo`, but on a port we know is free and pointed at a throwaway
// DATA_DIR — the repo's data/ is real and is never written to by a check.
const PORT = Number(process.env.PHONE_HISTORY_PORT ?? (await freePort()));
const BASE = `http://localhost:${PORT}`;
const dataDir = mkdtempSync(path.join(tmpdir(), "wm-phone-history-"));
// `detached` puts npx AND the next-dev child it spawns in one process group, so the
// kill below reaches both. Signalling npx alone leaves the server holding the port.
const server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
  cwd: REPO_ROOT,
  env: { ...process.env, DEMO_MODE: "1", DATA_DIR: dataDir },
  stdio: "ignore",
  detached: true,
});
let stopped = false;
const cleanup = () => {
  if (!stopped && server.pid) {
    stopped = true;
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
};
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

await waitForServer(`${BASE}/api/health`);

// ---- the history ledger ------------------------------------------------------
// Every history call the PAGE makes is counted, split into ours (tagged
// `wmPhoneLevel`) and everyone else's — Next's replaceState is the one that matters,
// because it is the wipe the whole bug grew out of. `__rawBack` is the untouched
// back(), so the gesture this script performs is never confused with one the app
// emitted.
const HISTORY_LEDGER = () => {
  const h = window.history;
  const go = h.go.bind(h);
  const back = h.back.bind(h);
  const push = h.pushState.bind(h);
  const replace = h.replaceState.bind(h);
  window.__hist = { go: [], back: 0, ourPushes: 0, otherPushes: 0, replaces: 0 };
  window.__rawBack = back;
  h.go = (n) => {
    window.__hist.go.push(n);
    return go(n);
  };
  h.back = () => {
    window.__hist.back++;
    return back();
  };
  h.pushState = (state, ...rest) => {
    if (state && typeof state.wmPhoneLevel === "number") window.__hist.ourPushes++;
    else window.__hist.otherPushes++;
    return push(state, ...rest);
  };
  h.replaceState = (state, ...rest) => {
    window.__hist.replaces++;
    return replace(state, ...rest);
  };
};

const ledger = (page) =>
  page.evaluate(() => ({
    ...window.__hist,
    go: [...window.__hist.go],
    length: window.history.length,
    // What the CURRENT entry still carries. Expected to be undefined right after a
    // server action: that absence is the bug's precondition, and the app must not
    // care.
    tag: window.history.state?.wmPhoneLevel ?? null,
  }));

const sheetState = (page) =>
  page.evaluate(() => {
    const sheet = document.querySelector(".wm-sheet--card");
    if (!sheet) return { open: false };
    const title = sheet.querySelector(".wm-ph-title");
    const parent = sheet.querySelector(".wm-ph-parent");
    return {
      open: true,
      title: title?.textContent?.trim() ?? "",
      parent: parent?.textContent?.trim() ?? null,
      kids: sheet.querySelectorAll(".wm-ph-kids .phone-rowwrap").length,
    };
  });

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    userAgent: IPHONE_UA,
  });
  await context.addInitScript(HISTORY_LEDGER);
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));

  await page.goto(`${BASE}/demo`, { waitUntil: "load" });
  await page.waitForSelector(".phone-shell");
  ok("the phone shell is the live tree at 375px", true);

  // ---- find a card with sub-cards -------------------------------------------
  // The seed's one nested card lives in Focus, which is the pager's first page
  // (Today owns the Now screen and is excluded from the pager).
  await page.locator(".phone-tab", { hasText: "Lists" }).click();
  await page.waitForSelector("#phone-page-focus");
  await page.waitForTimeout(500);

  // A Lists page now tucks its done cards into a collapsed "Done" tray, the way Now
  // has always tucked away "Done today". The seed's one nested card ("Shelf view")
  // was completed four days ago, so it lives in that tray — open it, or there is no
  // row here to open. A done card's sheet is the same sheet, so nothing below this
  // changes.
  const doneTray = page.locator("#phone-page-focus .phone-section__toggle");
  if ((await doneTray.count()) > 0 && (await doneTray.getAttribute("aria-expanded")) !== "true") {
    await doneTray.click();
    await page.waitForTimeout(200);
  }

  // The pager keeps every page in one scroll track, so rows are scoped to the page
  // we mean rather than matched across all four.
  const parentRow = page
    .locator("#phone-page-focus .phone-rowwrap")
    .filter({ has: page.locator(".phone-row__sub") })
    .first();
  await parentRow.waitFor();
  const parentTitle = (await parentRow.locator(".phone-row__title").textContent())?.trim() ?? "";
  ok("the board has a card with sub-cards to open", parentTitle.length > 0, parentTitle);

  await parentRow.locator(".phone-row__body").click();
  await page.waitForSelector(".wm-sheet--card");
  await page.waitForTimeout(600); // Vaul's open animation

  const opened = await sheetState(page);
  ok("the card sheet opens on that card", opened.open && opened.title === parentTitle, opened.title);
  ok("its sub-cards are rows in the peek", opened.kids >= 2, `${opened.kids} sub-card rows`);

  const atOpen = await ledger(page);
  ok(
    "opening the sheet pushed exactly one entry",
    atOpen.ourPushes === 1,
    `${atOpen.ourPushes} tagged pushes`,
  );

  // ---- 1. a sub-card toggle survives the server action round trip -----------
  const kidCheck = (i) => page.locator(".wm-ph-kids .phone-check").nth(i);
  const before = await kidCheck(0).getAttribute("aria-checked");
  await kidCheck(0).click();
  await page
    .locator(`.wm-ph-kids .phone-check[aria-checked="${before === "true" ? "false" : "true"}"]`)
    .first()
    .waitFor();
  // The write, the revalidate, and Next's replaceState with it.
  await page.waitForTimeout(2500);

  const afterToggle = await ledger(page);
  const sheetAfterToggle = await sheetState(page);
  // A2: the sheet's rows are the shell's live items, not a snapshot taken at open. If
  // they were frozen, the row's own "fresh server truth" effect would flip the check
  // straight back to what the board said when the sheet went up.
  ok(
    "the sheet sees its own write once the server answers",
    (await kidCheck(0).getAttribute("aria-checked")) !== before,
    `was ${before}, now ${await kidCheck(0).getAttribute("aria-checked")}`,
  );
  ok(
    "the sub-card toggle really did go through Next's replaceState",
    afterToggle.replaces > atOpen.replaces,
    `${afterToggle.replaces - atOpen.replaces} replaceState calls, current entry tag ${afterToggle.tag}`,
  );
  ok(
    "the sheet is still open on the same card after the round trip",
    sheetAfterToggle.open && sheetAfterToggle.title === parentTitle,
    sheetAfterToggle.open ? sheetAfterToggle.title : "sheet gone",
  );
  ok(
    "the round trip neither pushed nor returned a history entry",
    afterToggle.ourPushes === atOpen.ourPushes &&
      afterToggle.go.length === atOpen.go.length &&
      afterToggle.back === atOpen.back &&
      afterToggle.length === atOpen.length,
    `pushes ${afterToggle.ourPushes}, go ${JSON.stringify(afterToggle.go)}, length ${afterToggle.length}`,
  );

  // ---- 2. one back gesture steps sub-card -> parent -------------------------
  await page.locator(".wm-ph-kids .phone-row__body").first().click();
  await page.waitForSelector(".wm-sheet--card .wm-ph-parent");
  const drilled = await sheetState(page);
  const atDrill = await ledger(page);
  ok(
    "drilling into a sub-card pushes one entry and names the parent",
    drilled.parent === parentTitle && atDrill.ourPushes === atOpen.ourPushes + 1,
    `parent "${drilled.parent}", ${atDrill.ourPushes} tagged pushes`,
  );

  await page.evaluate(() => window.__rawBack());
  await page.waitForTimeout(900);
  const backOut = await sheetState(page);
  const atBack = await ledger(page);
  ok(
    "one back gesture steps sub-card -> parent, not whole-sheet close",
    backOut.open && backOut.parent === null && backOut.title === parentTitle,
    backOut.open ? `on "${backOut.title}", breadcrumb ${backOut.parent}` : "sheet closed",
  );
  ok(
    "the app emitted no history.go()/back() of its own for that gesture",
    atBack.go.length === atDrill.go.length && atBack.back === atDrill.back,
    `go ${JSON.stringify(atBack.go)}, back ${atBack.back}`,
  );

  // ---- 3. a second toggle still works --------------------------------------
  const before2 = await kidCheck(1).getAttribute("aria-checked");
  await kidCheck(1).click();
  await page
    .locator(`.wm-ph-kids .phone-check[aria-checked="${before2 === "true" ? "false" : "true"}"]`)
    .first()
    .waitFor();
  await page.waitForTimeout(2500);
  const afterSecond = await sheetState(page);
  ok(
    "a second sub-card toggle works and leaves the sheet open",
    afterSecond.open && afterSecond.title === parentTitle,
    afterSecond.open ? afterSecond.title : "sheet gone",
  );

  // ---- the in-sheet back arrow is the same code path -----------------------
  const beforeArrow = await ledger(page);
  await page.locator(".wm-ph-kids .phone-row__body").first().click();
  await page.waitForSelector(".wm-sheet--card .wm-ph-parent");
  await page.locator(".wm-sheet--card .wm-ph-back").click();
  await page.waitForTimeout(900);
  const afterArrow = await sheetState(page);
  const atArrow = await ledger(page);
  ok(
    "the in-sheet back arrow steps one level, through one history.go(-1)",
    afterArrow.open &&
      afterArrow.parent === null &&
      atArrow.go.length === beforeArrow.go.length + 1 &&
      atArrow.go[atArrow.go.length - 1] === -1,
    `go ${JSON.stringify(atArrow.go)}`,
  );

  // ---- closing gives every entry back, once -------------------------------
  // Escape is Radix's own dismissal, so this is the same road the grip-drag and the
  // overlay tap take: Vaul's onOpenChange -> the exit animation -> the shell's close().
  // (The tab bar is behind a snapped sheet and is deliberately unreachable here.)
  const beforeClose = await ledger(page);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
  const closed = await sheetState(page);
  const atClose = await ledger(page);
  const jumps = atClose.go.slice(beforeClose.go.length);
  ok("closing the sheet closes it", !closed.open);
  // Exactly one level is open at this point (the sheet itself — every drill-in above
  // has been stepped back out), so the close owes the browser exactly one entry. The
  // old code owed it twice: the sheet's own go(-n) AND the shell's back().
  ok(
    "closing gives the sheet's entries back in ONE jump, and never through back()",
    jumps.length === 1 && jumps[0] === -1 && atClose.back === 0,
    `jumps ${JSON.stringify(jumps)}, back() ${atClose.back}`,
  );
  ok(
    "the app is left on the board's own entry, not a dead one",
    atClose.tag === null,
    `current entry tag ${atClose.tag}`,
  );

  // One known, pre-existing warning is filtered: the desktop TimeMachineBar's range
  // `min` is a wall-clock reading (components/TimeMachineBar.tsx:142), so the server's
  // value and the client's differ by the round trip. It belongs to the desktop tree
  // that sits CSS-hidden behind the phone shell and has nothing to do with history.
  const unexpected = pageErrors.filter((e) => !/did not match\. Server/.test(e));
  ok("no page errors", unexpected.length === 0, unexpected.slice(0, 3).join(" | "));
} catch (err) {
  fails++;
  console.error(`✗ the run threw — ${err?.message ?? err}`);
} finally {
  await browser.close();
}

console.log(fails === 0 ? "\nall history assertions hold" : `\n${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
