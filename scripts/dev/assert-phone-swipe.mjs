#!/usr/bin/env node
// The phone app's horizontal gestures, driven through a real browser with real
// (trusted) touch input.
//
//   node scripts/dev/assert-phone-swipe.mjs                 # builds + serves itself
//   PHONE_SWIPE_BASE=https://workingmemory.onrender.com \
//     node scripts/dev/assert-phone-swipe.mjs               # against a live deploy
//
// WHY THIS EXISTS. The Lists pager was built as native scroll-snap and then could
// not be swiped AT ALL, for a whole release, because `touch-action` is intersected
// down the hit-test chain: the track said `pan-x`, each page said `pan-y`, and a
// touch inside a page was therefore allowed neither. Nothing caught it, because the
// markup, the scroll-snap and the IntersectionObserver were all correct — the CSS
// quietly withdrew the browser's permission to act on them.
//
// So these assertions are dispatched through CDP (`Input.dispatchTouchEvent`), not
// as synthetic DOM TouchEvents. Chromium honours `touch-action` for trusted input
// only; a hand-built `new TouchEvent(...)` would sail straight past the exact bug
// this file exists to catch.
//
// What is asserted at 375x812 with touch:
//   · the pager and its pages permit BOTH axes, and a row narrows to `pan-y`;
//   · an off-row swipe steps to the next list, and back;
//   · a swipe that starts ON a card is the row's — it reveals the row's actions and
//     leaves the pager exactly where it was;
//   · the hint line under the segments is a handle that owns its own band (the row
//     below it is clickable, and Chromium's touch adjustment will steal a flush one);
//   · rightward off the first list, and leftward on Now, cross between the screens.

import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXTERNAL = process.env.PHONE_SWIPE_BASE ?? null;
const PORT = Number(process.env.PHONE_SWIPE_PORT ?? 3133);
const BASE = EXTERNAL ?? `http://localhost:${PORT}`;
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

// DEMO_MODE=1 is what makes /demo real: every visitor gets a seeded throwaway board,
// so this runs against a fresh, known board with no fixture to maintain.
let server = null;
let dataDir = null;
if (!EXTERNAL) {
  if (!existsSync(path.join(REPO_ROOT, ".next", "BUILD_ID"))) {
    const b = spawnSync("npx", ["next", "build"], { cwd: REPO_ROOT, stdio: "inherit" });
    if (b.status !== 0) throw new Error("next build failed");
  }
  dataDir = mkdtempSync(path.join(tmpdir(), "wm-phone-swipe-"));
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

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true });
  context.setDefaultTimeout(15_000);
  const page = await context.newPage();
  page.on("pageerror", (e) => ok(`no page error (${e.message})`, false));
  const cdp = await context.newCDPSession(page);

  // One drag, as the compositor sees it. Steps matter: the app's directional lock
  // reads the first ~10px of travel, so a single jump to the end tells it nothing.
  async function drag(x, y, dx, steps = 12) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: Math.round(x + (dx * i) / steps), y }],
      });
      await new Promise((r) => setTimeout(r, 16));
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(700);
  }

  const state = () =>
    page.evaluate(() => ({
      title: document.querySelector(".phone-title")?.textContent?.trim() ?? null,
      seg: document.querySelector(".phone-seg__btn.is-current")?.textContent?.trim() ?? null,
      revealed: !!document.querySelector(".phone-row__actions"),
    }));

  // A point on the live page that no row owns — what the pager may be swiped from.
  const offRowPoint = () =>
    page.evaluate(() => {
      const track = document.querySelector(".phone-pager");
      if (!track) return null;
      const i = Math.round(track.scrollLeft / track.clientWidth);
      const pageEl = track.querySelectorAll(".phone-page")[i];
      if (!pageEl) return null;
      const r = pageEl.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      for (let y = Math.round(r.bottom - 12); y > r.top + 12; y -= 8) {
        const el = document.elementFromPoint(x, y);
        if (el && !el.closest(".phone-row") && pageEl.contains(el)) return { x, y };
      }
      return null;
    });

  await page.goto(`${BASE}/demo`, { waitUntil: "load" });
  await page.waitForSelector(".phone-shell");
  await page.locator(".phone-tab", { hasText: "Lists" }).click();
  await page.waitForSelector(".phone-pager");
  await page.waitForTimeout(400);

  // ---- the permission itself ------------------------------------------------
  const ta = await page.evaluate(() => {
    const of = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).touchAction : null;
    };
    return { pager: of(".phone-pager"), page: of(".phone-page"), row: of(".phone-row") };
  });
  ok("the pager permits horizontal panning", !!ta.pager?.includes("pan-x"), `pager ${ta.pager}`);
  ok(
    "a page permits both axes, so the pager under it can act",
    !!ta.page?.includes("pan-x") && !!ta.page?.includes("pan-y"),
    `page ${ta.page}`,
  );
  ok("a row keeps horizontal to itself", ta.row === "pan-y", `row ${ta.row}`);

  // ---- page to page ---------------------------------------------------------
  const first = await state();
  const p1 = await offRowPoint();
  ok("a page has surface no row owns", !!p1, JSON.stringify(p1));
  if (p1) {
    await drag(p1.x, p1.y, -220);
    const next = await state();
    ok("swiping left steps to the next list", next.seg !== first.seg, `${first.seg} → ${next.seg}`);
    const p2 = await offRowPoint();
    if (p2) {
      await drag(p2.x, p2.y, 220);
      const back = await state();
      ok("…and right steps back", back.seg === first.seg, `${next.seg} → ${back.seg}`);
    }
  }

  // ---- a card's swipe is still the card's -----------------------------------
  const rowBox = await page
    .locator(".phone-page .phone-row")
    .filter({ has: page.locator(".phone-row__body") })
    .first()
    .boundingBox()
    .catch(() => null);
  ok("there is a card to swipe", !!rowBox);
  if (rowBox) {
    const before = await state();
    await drag(Math.round(rowBox.x + rowBox.width / 2), Math.round(rowBox.y + rowBox.height / 2), -200);
    const after = await state();
    ok("a swipe on a card reveals the card's actions", after.revealed, `revealed ${after.revealed}`);
    ok("…and leaves the pager where it was", after.seg === before.seg, `${before.seg} → ${after.seg}`);
    await page.mouse.click(5, VIEWPORT.height / 2).catch(() => {});
  }

  // ---- the hint line, the handle a full page doesn't have --------------------
  const hint = await page.locator(".phone-lists__hint").boundingBox().catch(() => null);
  ok("the hint line is there to grab", !!hint);
  if (hint) {
    const hx = Math.round(hint.x + hint.width / 2);
    const hy = Math.round(hint.y + hint.height / 2);
    await page.evaluate(() => {
      window.__hits = [];
      document.addEventListener(
        "touchstart",
        (e) => window.__hits.push(e.target instanceof Element ? String(e.target.className) : "?"),
        true,
      );
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: hx, y: hy }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(200);
    const [hitClass = "nothing"] = await page.evaluate(() => window.__hits);
    ok(
      "the hint owns the middle of its own band (touch adjustment takes a flush one)",
      hitClass.includes("phone-lists__hint"),
      `touch landed on ${hitClass}`,
    );

    const before = await state();
    await drag(hx, hy, -180);
    const stepped = await state();
    ok("swiping the hint steps to the next list", stepped.seg !== before.seg, `${before.seg} → ${stepped.seg}`);
    await drag(hx, hy, 180);
    const backAgain = await state();
    ok("…and back", backAgain.seg === before.seg, `${stepped.seg} → ${backAgain.seg}`);
  }

  // ---- between the screens ---------------------------------------------------
  const toNow = (await offRowPoint()) ?? { x: 188, y: 400 };
  await drag(toNow.x, toNow.y, 200);
  const onNow = await state();
  ok("swiping right off the first list goes back to Now", onNow.title === "Now", `title ${onNow.title}`);

  const nowPoint = await page.evaluate(() => {
    const sc = document.querySelector(".phone-scroll");
    if (!sc) return null;
    const r = sc.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    for (let y = Math.round(r.bottom - 12); y > r.top + 12; y -= 8) {
      const el = document.elementFromPoint(x, y);
      if (el && !el.closest(".phone-row") && sc.contains(el)) return { x, y };
    }
    return null;
  });
  ok("Now has surface no row owns", !!nowPoint, JSON.stringify(nowPoint));
  if (nowPoint) {
    await drag(nowPoint.x, nowPoint.y, -200);
    const onLists = await state();
    ok("swiping left on Now goes to Lists", onLists.title === "Lists", `title ${onLists.title}`);
  }
} catch (e) {
  ok(`the run finished (${e.message})`, false);
} finally {
  await browser.close();
}

console.log(fails === 0 ? "\nall phone swipe checks passed" : `\n${fails} failing`);
process.exit(fails === 0 ? 0 : 1);
