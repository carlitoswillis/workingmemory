#!/usr/bin/env node
// The two things the phone app is FOR: write a thought down, and find one again.
// This is the regression guard for both, driven through the real phone shell.
//
//   node scripts/dev/assert-phone-flows.mjs                 # builds + serves itself
//   PHONE_FLOWS_BASE=https://workingmemory.onrender.com \
//     node scripts/dev/assert-phone-flows.mjs               # against a live deploy
//
// WHY THIS EXISTS. The second pass shipped a sheet whose content collapsed to
// nothing the moment the keyboard came up — Capture's textarea in an 8px scroller
// with the Save bar drawn over it, Find's results in a 60px slot under 336px of
// blank sheet. Nothing caught it, because a headless browser has no keyboard and
// `page.setViewportSize()` is NOT one: shrinking the viewport shrinks the LAYOUT
// viewport, so `window.innerHeight` shrinks with it and the app's keyboard inset
// (`innerHeight - visualViewport.height`) stays 0. That is the exact case the bug
// lived in, so the old "keyboard simulation" could never see it.
//
// So the keyboard is simulated the way iOS actually behaves: `window.innerHeight`
// (the LAYOUT viewport) is left alone at 812 and `window.visualViewport` is swapped
// for a stub whose height drops by the keyboard's, firing `resize` — which is the
// only signal useKeyboardInset() and Vaul's own repositionInputs read. Flip it with
// `window.__kbUp(true)`.
//
// What is asserted, keyboard up and keyboard down, at 375x812 with touch:
//   Capture — the writing surface keeps real height, the Save bar is fully on
//     screen and never overlaps the textarea, Save keeps the sheet open with a
//     running count (Done is what closes it), and the card is on the board AND
//     still there after a reload.
//   Find   — the field stays pinned at the top of the sheet, the results list keeps
//     real height, the first row is inside the visible viewport and is what a tap
//     at its centre actually hits, and tapping it opens that card's sheet.
//   Desktop (1280x800) — the column capture box files a card, and "/" search finds
//     it. The phone tree is a sibling of the desktop one, so this is the guard that
//     phone work never reaches across the 768px branch.

import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXTERNAL = process.env.PHONE_FLOWS_BASE ?? null;
const PORT = Number(process.env.PHONE_FLOWS_PORT ?? 3131);
const BASE = EXTERNAL ?? `http://localhost:${PORT}`;

// A realistic iOS keyboard on a 375x812 screen. Any value over MIN_KEYBOARD_PX
// (components/phone/keyboardInset.ts) exercises the same paths.
const KEYBOARD_PX = 336;
const VIEWPORT = { width: 375, height: 812 };

let fails = 0;
const ok = (label, pass, detail = "") => {
  if (pass) console.log(`✓ ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fails++;
    console.error(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

async function waitForServer(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`server never came up at ${url}`);
}

// ---- the server ------------------------------------------------------------
// DEMO_MODE=1 is what makes /demo real: every visitor gets a seeded throwaway
// board, so this runs against a fresh, known board with no fixture to maintain.
let server = null;
let dataDir = null;
if (!EXTERNAL) {
  if (!existsSync(path.join(REPO_ROOT, ".next", "BUILD_ID"))) {
    const b = spawnSync("npx", ["next", "build"], { cwd: REPO_ROOT, stdio: "inherit" });
    if (b.status !== 0) throw new Error("next build failed");
  }
  dataDir = mkdtempSync(path.join(tmpdir(), "wm-phone-flows-"));
  server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: REPO_ROOT,
    env: { ...process.env, DEMO_MODE: "1", DATA_DIR: dataDir },
    stdio: "ignore",
  });
}
const cleanup = () => {
  if (server && !server.killed) server.kill("SIGTERM");
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
};
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

await waitForServer(`${BASE}/api/health`);

// iOS, in one init script. The layout viewport (window.innerHeight) does NOT move
// when the keyboard opens; only the visual viewport shrinks. Everything downstream
// — the app's --kb/--vvh and Vaul's own drawer repositioning — reads exactly this.
const IOS_KEYBOARD_SHIM = (kb) => {
  const listeners = { resize: [], scroll: [] };
  let up = false;
  const fake = {
    get width() {
      return window.innerWidth;
    },
    get height() {
      return up ? window.innerHeight - kb : window.innerHeight;
    },
    get offsetTop() {
      return 0;
    },
    get offsetLeft() {
      return 0;
    },
    get pageTop() {
      return 0;
    },
    get pageLeft() {
      return 0;
    },
    get scale() {
      return 1;
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      const a = listeners[type];
      if (!a) return;
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    dispatchEvent() {
      return true;
    },
  };
  Object.defineProperty(window, "visualViewport", { get: () => fake, configurable: true });
  window.__kbUp = (v) => {
    up = !!v;
    for (const fn of [...(listeners.resize ?? [])]) fn({ target: fake });
    for (const fn of [...(listeners.scroll ?? [])]) fn({ target: fake });
  };
};

// Geometry of one open sheet, in layout-viewport coordinates, plus the numbers the
// keyboard math is built out of.
const readSheet = (page) =>
  page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        top: +r.top.toFixed(1),
        bottom: +r.bottom.toFixed(1),
        height: +r.height.toFixed(1),
        paddingBottom: parseFloat(cs.paddingBottom) || 0,
      };
    };
    const root = getComputedStyle(document.documentElement);
    return {
      innerHeight: window.innerHeight,
      visibleHeight: window.visualViewport.height,
      kb: parseFloat(root.getPropertyValue("--kb")) || 0,
      vvh: parseFloat(root.getPropertyValue("--vvh")) || 0,
      sheet: box(".wm-sheet"),
      head: box(".wm-sheet__head"),
      scroll: box(".wm-sheet__scroll"),
      bar: box(".wm-sheet__bar"),
      field: box(".wm-sheet .wm-ph-field"),
      // How much of the scroller's content it can actually show. A sheet sized to
      // its content is allowed to be short; a sheet with more rows than fit is not.
      scroller: (() => {
        const el = document.querySelector(".wm-sheet__scroll");
        if (!el) return null;
        return { client: el.clientHeight, content: el.scrollHeight };
      })(),
    };
  });

// A sheet's scroller is honest when it shows everything it has, or — when it has
// more than fits — at least a usable window of it. `wm-sheet--search` is sized to
// its results on purpose, so "two hits, a short sheet" must stay legal while "many
// hits, a 60px slot" must not.
const USABLE_SCROLLER_PX = 150;
const scrollerIsHonest = (s) => !!s && s.client + 1 >= Math.min(s.content, USABLE_SCROLLER_PX);

const browser = await chromium.launch();

// ── phone ────────────────────────────────────────────────────────────────────
// Each half runs inside a `try`: when a sheet collapses, its own bar ends up over its
// own controls and every click after that throws "intercepts pointer events". That is
// a real finding, but a stack trace buries the assertions that named the cause — so it
// is reported as one more failed line and the run carries on.
try {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(IOS_KEYBOARD_SHIM, KEYBOARD_PX);
  // Short, because a failure here is usually a control something is sitting on top
  // of, and Playwright's default is 30s of retrying before it says so.
  context.setDefaultTimeout(15_000);
  const page = await context.newPage();
  const pageErrors = [];
  const httpErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));
  page.on("response", (r) => {
    if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });

  await page.goto(`${BASE}/demo`, { waitUntil: "load" });
  await page.waitForSelector(".phone-shell");
  ok("the phone shell is the live tree at 375px", true);

  const MARK = `flowcheck-${Date.now().toString(36)}`;

  // ---- Capture -------------------------------------------------------------
  await page.locator(".phone-tab", { hasText: "Capture" }).click();
  await page.waitForSelector(".wm-sheet--capture");
  await page.waitForTimeout(700); // Vaul's open animation, then autofocus
  ok(
    "capture autofocuses its textarea",
    await page.evaluate(() => document.activeElement?.tagName === "TEXTAREA"),
  );

  // The real order on a phone: the field autofocuses, so the keyboard is already up
  // BEFORE the first keystroke — and it stays up while the sheet grows with what you
  // write. Raising it after typing hides a whole class of bug, so raise it first.
  await page.evaluate(() => window.__kbUp(true));
  await page.waitForTimeout(600);

  // Measure BEFORE touching anything. A collapsed sheet stacks its bar over its own
  // controls, so every click below would time out on "intercepts pointer events" and
  // the run would die with a stack trace instead of naming what is wrong.
  const cap = await readSheet(page);
  ok("capture: the keyboard inset is live", cap.kb >= 300, `--kb ${cap.kb}px`);
  ok(
    "capture: the sheet does not reserve the keyboard a second time",
    cap.sheet.paddingBottom < 60,
    `padding-bottom ${cap.sheet.paddingBottom}px`,
  );
  ok(
    "capture: the sheet sits inside the visible viewport",
    cap.sheet.bottom <= cap.visibleHeight + 1 && cap.sheet.top >= -1,
    `${cap.sheet.top}–${cap.sheet.bottom} of ${cap.visibleHeight}`,
  );
  ok(
    "capture: the writing surface keeps real height",
    cap.scroll.height >= 80,
    `scroller ${cap.scroll.height}px`,
  );
  ok(
    "capture: the Save bar is on screen and below the textarea",
    cap.bar.bottom <= cap.visibleHeight + 1 && cap.bar.top >= cap.field.bottom - 1,
    `bar ${cap.bar.top}–${cap.bar.bottom}, field ends ${cap.field.bottom}`,
  );
  const saveHit = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".wm-sheet--capture .wm-sheet__bar button")].pop();
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el.contains(hit) || el === hit;
  });
  ok("capture: a tap on Save lands on Save", saveHit);

  await page.locator('.wm-sheet--capture .wm-ph-chip:text-is("Today")').click();
  await page.locator(".wm-sheet--capture textarea").fill(`${MARK}\nsecond line`);
  await page.waitForTimeout(300);
  await page.locator('.wm-sheet--capture .wm-sheet__bar button:text-is("Save")').click();
  await page.evaluate(() => window.__kbUp(false));
  await page.waitForTimeout(2500);
  // Capture stays open after a Save now, so several thoughts in a row cost one open
  // instead of one each. Save leaves the sheet up with a running count of what it has
  // taken; Done — the label the ghost button wears once something has been saved — is
  // what dismisses it.
  const stillOpen = (await page.locator(".wm-sheet--capture").count()) === 1;
  const caption = stillOpen
    ? ((await page.locator(".wm-sheet--capture .wm-sheet__head .wm-ph-caption").textContent()) ?? "")
        .trim()
    : "";
  ok(
    "capture: Save keeps the sheet open, and says where the thought went",
    stillOpen && caption === "Saved to Today",
    `${stillOpen ? "open" : "closed"}, caption "${caption}"`,
  );
  await page.locator('.wm-sheet--capture .wm-sheet__bar button:text-is("Done")').click();
  await page.waitForTimeout(900);
  ok("capture: Done closes the sheet", (await page.locator(".wm-sheet").count()) === 0);

  const onBoard = () =>
    page.$$eval(".phone-row", (els, m) => els.some((e) => e.textContent.includes(m)), MARK);
  ok("capture: the card is on the board", await onBoard());
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".phone-shell");
  await page.waitForTimeout(500);
  ok("capture: the card survives a reload", await onBoard());

  // ---- Find ----------------------------------------------------------------
  await page.locator(".phone-tab", { hasText: "Find" }).click();
  await page.waitForSelector(".wm-sheet--search");
  await page.waitForTimeout(700);
  ok(
    "find autofocuses its field",
    await page.evaluate(() => document.activeElement?.tagName === "INPUT"),
  );
  // Same order as Capture: keyboard first, then the query. This is the sequence the
  // sheet used to be frozen by — it opened as a field and a hint line, the keyboard
  // pinned it at that height, and every result after that landed in a ~110px box.
  await page.evaluate(() => window.__kbUp(true));
  await page.waitForTimeout(600);
  await page.locator(".wm-sheet--search input").fill(MARK);
  await page.waitForTimeout(900);

  const find = await readSheet(page);
  ok(
    "find: the sheet does not reserve the keyboard a second time",
    find.sheet.paddingBottom < 60,
    `padding-bottom ${find.sheet.paddingBottom}px`,
  );
  ok(
    "find: the field you are typing in is on screen, at the top of the sheet",
    find.field.top >= -1 &&
      find.field.bottom <= find.visibleHeight + 1 &&
      find.field.top - find.sheet.top < 24,
    `field ${find.field.top}–${find.field.bottom}, sheet from ${find.sheet.top}`,
  );
  ok(
    "find: the results list shows what it holds",
    scrollerIsHonest(find.scroller),
    `${find.scroller?.client}px of ${find.scroller?.content}px`,
  );

  const rowCount = await page.locator(".wm-sheet--search .wm-ph-row").count();
  ok("find: the card is a result", rowCount >= 1, `${rowCount} rows`);
  const rowState = await page.evaluate(() => {
    const el = document.querySelector(".wm-sheet--search .wm-ph-row");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      top: +r.top.toFixed(1),
      bottom: +r.bottom.toFixed(1),
      visible: window.visualViewport.height,
      tappable: !!hit && (el.contains(hit) || el === hit),
    };
  });
  ok(
    "find: the first result is inside the visible viewport",
    rowState && rowState.top >= 0 && rowState.bottom <= rowState.visible + 1,
    rowState ? `${rowState.top}–${rowState.bottom} of ${rowState.visible}` : "no row",
  );
  ok("find: a tap on a result lands on the result", !!rowState?.tappable);

  // A query with more hits than fit. The search sheet is content-sized on purpose,
  // so the one-result case above cannot tell a short sheet from a collapsed one —
  // this is the case that can: many rows, keyboard up, and the list must still get
  // a real window of the screen rather than a 60px slot.
  await page.locator(".wm-sheet--search input").fill("e");
  await page.waitForTimeout(900);
  const many = await readSheet(page);
  const manyRows = await page.locator(".wm-sheet--search .wm-ph-row").count();
  ok("find: a broad query returns many hits", manyRows >= 5, `${manyRows} rows`);
  ok(
    "find: a full results list gets a usable window, keyboard up",
    scrollerIsHonest(many.scroller),
    `${many.scroller?.client}px of ${many.scroller?.content}px`,
  );
  ok(
    "find: the field stays pinned above a full results list",
    many.field.top >= -1 && many.field.top - many.sheet.top < 24,
    `field ${many.field.top}, sheet from ${many.sheet.top}`,
  );

  await page.locator(".wm-sheet--search input").fill(MARK);
  await page.waitForTimeout(900);
  // Tapping a result blurs the field, so the keyboard goes down on the way into the
  // card — which is what a phone actually does.
  await page.evaluate(() => window.__kbUp(false));
  await page.waitForTimeout(300);
  await page.locator(".wm-sheet--search .wm-ph-row").first().click();
  await page.waitForTimeout(1200);
  ok(
    "find: picking a result opens that card's sheet",
    (await page.locator(".wm-sheet--card").count()) === 1,
  );
  ok(
    "find: the card sheet is the card that was picked",
    (await page.locator(".wm-sheet--card").innerText()).includes(MARK),
  );

  // The card is the one sheet WITH snap points, so it is anchored by a different
  // rule (`.wm-sheet--snapped`: box = the whole window, Vaul translates it down to
  // the active snap) and keeps Vaul's own keyboard handling. Guard the peek: its head
  // and its Done control have to be in the thumb zone, not off the bottom edge.
  const card = await readSheet(page);
  ok(
    "card sheet: the peek sits in the thumb zone",
    card.head.top > card.visibleHeight * 0.5 && card.head.top < card.visibleHeight - 60,
    `head at ${card.head.top} of ${card.visibleHeight}`,
  );

  // ---- Time travel: "What changed" ------------------------------------------
  // The diff ledger (lib/timetravel.ts#diffBoardSince) between a scrubbed moment
  // and now, behind a two-way toggle beside the existing scrubber/jump chips.
  // Tick a card first rather than trust the demo seed's own timing: the seed's
  // one event inside the last hour is a CREATE sitting right where "1h ago"
  // snaps to it, which (correctly) reads as "already existed at T" — zero
  // change. Ticking something older guarantees a change strictly after T
  // regardless of exactly where the jump lands.
  // Find left the card sheet's peek open, sitting right over the tab bar — a tap on
  // "Now" would land on the sheet, not the tab, until it's dismissed.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  await page.locator(".phone-tab", { hasText: "Now" }).click();
  await page.waitForTimeout(400);
  // A named seed card (days old), not the MARK card this run just created — ticking
  // MARK would make its own "added" the change, and an added-within-the-window card
  // has no past self to open, which the row-tap assertion below needs to exist for.
  const seedRow = page.locator(".phone-row", { hasText: "quarterly estimated taxes" });
  await seedRow.waitFor();
  await seedRow.locator(".phone-check").click();
  await page.waitForTimeout(1500); // the write + the row's own collapse animation

  await page.locator(".phone-tab", { hasText: "More" }).click();
  await page.waitForSelector(".wm-sheet--ledger");
  await page.locator(".wm-ph-row", { hasText: "Time travel" }).click();
  await page.waitForSelector(".wm-sheet--time");
  await page.waitForTimeout(500);

  await page.locator('.wm-ph-diffseg__btn:text-is("What changed")').click();
  await page.waitForTimeout(200);
  ok(
    "time travel: 'What changed' while live shows the hint to scrub or jump",
    (await page
      .locator(".wm-sheet--time .wm-ph-hint")
      .filter({ hasText: "Move the scrubber" })
      .count()) === 1,
  );

  await page.locator('.wm-ph-chip:text-is("1h ago")').click();
  await page.waitForTimeout(400);

  const diffRows = page.locator(".wm-sheet--time .wm-ph-row--ledger");
  const diffRowCount = await diffRows.count();
  ok(
    "time travel diff: jumping back shows at least one ledger row",
    diffRowCount >= 1,
    `${diffRowCount} rows`,
  );
  const summaryText =
    ((await page.locator(".wm-sheet--time .wm-ph-diff-summary").textContent()) ?? "").trim();
  ok(
    "time travel diff: the summary names a kind",
    /\d+ (done|added|archived|reopened|restored|moved|reworded|details edited|nested|un-nested|recurrence changed)/.test(
      summaryText,
    ),
    summaryText,
  );

  // The row we know has a T to open (a days-old seed card, unlike a card the
  // window itself created) — first() would be fine on most runs, but not when the
  // seed's own near-the-hour event also lands in the window and sorts ahead of
  // "done" as an "added" line with no past self.
  const openableRow = diffRows.filter({ hasText: "quarterly estimated taxes" });
  await openableRow.waitFor();
  await openableRow.click();
  await page.waitForTimeout(600);
  ok(
    "time travel diff: tapping a ledger row opens the past card",
    (await page.locator(".wm-ph-snapcard").count()) === 1,
  );

  await page.evaluate(() => window.history.back());
  await page.waitForTimeout(600);
  ok(
    "time travel diff: one back returns to the ledger, not the whole sheet",
    (await page.locator(".wm-ph-snapcard").count()) === 0 &&
      (await page.locator(".wm-sheet--time").count()) === 1 &&
      (await diffRows.count()) >= 1,
  );

  ok("no page errors on the phone path", pageErrors.length === 0, pageErrors.join(" | "));
  ok("no 4xx/5xx on the phone path", httpErrors.length === 0, httpErrors.join(" | "));
  await context.close();
} catch (e) {
  ok("the phone flow runs end to end", false, String(e.message ?? e).split("\n")[0]);
}

// ── desktop, same board, same actions ────────────────────────────────────────
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  context.setDefaultTimeout(15_000);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message)));
  await page.goto(`${BASE}/demo`, { waitUntil: "load" });
  await page.waitForSelector('[data-shell="desktop"]');
  await page.waitForTimeout(600);

  const MARK = `deskcheck-${Date.now().toString(36)}`;
  const capture = page
    .locator('[data-shell="desktop"] input[placeholder="Capture a thought…"]')
    .first();
  await capture.click();
  await capture.fill(MARK);
  await capture.press("Enter");
  await page.waitForTimeout(1500);
  ok("desktop: a column capture files the card", (await page.getByText(MARK).count()) > 0);

  await page.locator("body").click({ position: { x: 4, y: 400 } });
  await page.keyboard.press("/");
  await page.waitForTimeout(400);
  const overlay = page.locator('input[placeholder="Find a card by its title or details…"]');
  ok("desktop: \"/\" opens search", (await overlay.count()) === 1);
  await page.keyboard.type(MARK);
  await page.waitForTimeout(1000);
  const hits = await page.$$eval(
    "button",
    (els, m) => els.filter((e) => e.textContent.includes(m)).length,
    MARK,
  );
  ok("desktop: search finds the card", hits > 0, `${hits} hits`);

  // ---- the card panel's history (backlog A4) --------------------------------
  // The panel used to mirror its depth onto `history.state` as `wmDepth` — and a
  // server action's `revalidatePath` makes Next's App Router call
  // `history.replaceState` with only its own router tree, which wipes that key off the
  // current entry. So: open a card, tick it done, press back, and the handler read
  // "depth 0" from an entry it no longer recognised, closed the panel AND spent the
  // entry the panel stood on. A second back walked off the board entirely. The depth
  // lives in a ref now, on the same level stack PhoneShell uses
  // (components/useLevelStack.ts), so the toggle cannot touch it.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  const urlBefore = page.url();
  await page
    .locator('[data-shell="desktop"] button', { hasText: MARK })
    .first()
    .click();
  await page.waitForSelector('[data-panel="card"]');
  await page.waitForTimeout(400);
  ok("desktop: a card opens its panel", (await page.locator('[data-panel="card"]').count()) === 1);

  // The server action, from inside the panel. This is the write whose revalidate
  // fires the replaceState the old code's depth used to disappear into.
  await page.locator('[data-panel="card"] button:text-is("Mark done")').click();
  await page.locator('[data-panel="card"] button:text-is("Done")').waitFor();
  await page.waitForTimeout(2000);
  ok(
    "desktop: the panel's Done toggle survives its own round trip",
    (await page.locator('[data-panel="card"]').count()) === 1,
  );

  // A marker on the live document: if the back gesture NAVIGATED rather than popping
  // one of our pushState entries, the page reloads and this is gone.
  await page.evaluate(() => {
    window.__deskAlive = true;
  });
  await page.evaluate(() => window.history.back());
  await page.waitForTimeout(1200);
  ok(
    "desktop: one back closes the card panel",
    (await page.locator('[data-panel="card"]').count()) === 0,
  );
  const stillHere = await page.evaluate(() => ({
    alive: window.__deskAlive === true,
    board: !!document.querySelector('[data-shell="desktop"]'),
    url: location.href,
  }));
  ok(
    "desktop: that back stayed on the board — no reload, no navigation",
    stillHere.alive && stillHere.board && stillHere.url === urlBefore,
    `alive ${stillHere.alive}, board ${stillHere.board}, ${stillHere.url}`,
  );
  ok("desktop: the card is still on the board after the panel closed", (await page.getByText(MARK).count()) > 0);

  // ---- and the step the old scheme actually lost ----------------------------
  // The check above is the contract, but it cannot fail on the old code: a
  // replaceState wipes the tag off the entry you are STANDING on, and the handler
  // reads the entry you LAND on. The wipe only bites once you step FORWARD off a
  // wiped entry — which is the ordinary way anyone uses this panel. Toggle done on a
  // card (its entry loses the tag), drill into one of its sub-cards, press back: the
  // old handler read the parent's vanished tag as "depth 0" and closed the whole
  // panel instead of stepping to the parent, leaving the board standing on an entry
  // nobody would give back. This is the desktop twin of the phone's
  // "one back gesture steps sub-card -> parent" in assert-phone-history.mjs.
  // What the panel's back arrow currently says — "Back to board" at the top level,
  // "Back to <parent>" inside a sub-card, and null when there is no panel at all.
  // Read through evaluate rather than a locator on purpose: when this regresses the
  // panel is GONE, and a locator would spend 15s retrying and then report a timeout
  // instead of the assertion that names the cause.
  const backLabel = () =>
    page.evaluate(
      () => document.querySelector('[data-panel="card"] button')?.getAttribute("aria-label") ?? null,
    );

  const nested = page
    .locator('[data-shell="desktop"] .card-in')
    .filter({ has: page.locator('span[title$="sub-cards done"]') })
    .first();
  await nested.waitFor();
  const nestedTitle = (await nested.locator("button").nth(1).textContent())?.trim() ?? "";
  ok("desktop: the board has a card with sub-cards", nestedTitle.length > 0, nestedTitle);
  await nested.locator("button").nth(1).click();
  await page.waitForSelector('[data-panel="card"] [data-subcards]');
  await page.waitForTimeout(400);

  // The server action, on the PARENT's entry — the one the drill-in then steps off.
  const doneLabel = (await page.locator("[data-done-toggle]").textContent())?.trim() ?? "";
  await page.locator("[data-done-toggle]").click();
  await page.waitForFunction(
    (was) => document.querySelector("[data-done-toggle]")?.textContent?.trim() !== was,
    doneLabel,
  );
  await page.waitForTimeout(2000); // the write, the revalidate, and Next's replaceState

  const kid = page.locator('[data-panel="card"] [data-subcards] .card-in').first();
  await kid.locator("button").nth(1).click();
  await page.waitForTimeout(900);
  ok(
    "desktop: the panel drills into a sub-card",
    (await backLabel()) === `Back to ${nestedTitle}`,
    `back arrow says "${await backLabel()}"`,
  );

  await page.evaluate(() => window.history.back());
  await page.waitForTimeout(1200);
  const stepped = {
    open: (await page.locator('[data-panel="card"]').count()) === 1,
    back: await backLabel(),
  };
  ok(
    "desktop: after a server action, one back steps sub-card -> parent, not whole-panel close",
    stepped.open && stepped.back === "Back to board",
    stepped.open ? `back arrow says "${stepped.back}"` : "panel closed",
  );
  await page.evaluate(() => window.history.back());
  await page.waitForTimeout(1200);
  const closedOut = await page.evaluate(() => ({
    alive: window.__deskAlive === true,
    panel: !!document.querySelector('[data-panel="card"]'),
    url: location.href,
  }));
  ok(
    "desktop: a second back closes the panel and still does not leave the board",
    !closedOut.panel && closedOut.alive && closedOut.url === urlBefore,
    `panel ${closedOut.panel}, alive ${closedOut.alive}, ${closedOut.url}`,
  );

  ok("no page errors on the desktop path", pageErrors.length === 0, pageErrors.join(" | "));
  await context.close();
} catch (e) {
  ok("the desktop flow runs end to end", false, String(e.message ?? e).split("\n")[0]);
}

await browser.close();
cleanup();
console.log(fails === 0 ? "\nall phone + desktop flows pass" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
