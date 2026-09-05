#!/usr/bin/env node
// Realistic, repeatable staging of the PHONE app + a full screenshot set.
//
//   node scripts/dev/capture-phone.mjs
//
// What it does, in order (idempotent — safe to re-run):
//   1. Rebuilds the seed DB fresh (scripts/dev/seed-phone-demo.ts).
//   2. Builds the app if there's no production build yet.
//   3. Starts `next start` on :3124, pointed at the seed DB via DATA_DIR.
//   4. Mints a session cookie for the seeded user (lib/auth.ts's own signer,
//      via scripts/dev/mint-session.ts) and hands it to a Playwright context.
//   5. Drives the phone shell (375×812 @3x, isMobile, hasTouch) through every
//      screen, screenshotting each one, and dumps DOM metrics per screen.
//   6. Grabs one 1280×800 desktop shot of the same board for reference.
//   7. Kills the server.

import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRATCH_DIR =
  process.env.PHONE_DEMO_DIR ??
  "/private/tmp/claude-501/-Users-carlitoswillis-workspace/d0c88bad-af13-4089-a699-c66f45e77acf/scratchpad/pass2";
const PORT = 3124;
const BASE_URL = `http://localhost:${PORT}`;
const SESSION_SECRET = "phone-demo-session-secret-2026-not-real";

mkdirSync(SCRATCH_DIR, { recursive: true });

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: REPO_ROOT, stdio: "inherit", ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${res.status}`);
  }
}

function runCapture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: REPO_ROOT, ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${res.status}: ${res.stderr}`);
  }
  return res.stdout.toString();
}

async function waitForServer(url, timeoutMs = 30_000) {
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
  throw new Error(`server at ${url} never came up`);
}

// ---------------------------------------------------------------------------
// 1. Seed.

console.log("== seeding ==");
run("npx", ["tsx", "scripts/dev/seed-phone-demo.ts"], {
  env: { ...process.env, DATA_DIR: SCRATCH_DIR },
});
const meta = JSON.parse(readFileSync(path.join(SCRATCH_DIR, "meta.json"), "utf8"));
console.log(`user=${meta.username} userId=${meta.userId} boardId=${meta.boardId}`);

// ---------------------------------------------------------------------------
// 2. Build, if there's no production build yet.

const NEXT_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "next");
const buildIdFile = path.join(REPO_ROOT, ".next", "BUILD_ID");
if (!existsSync(buildIdFile)) {
  console.log("== no production build found — running `next build` ==");
  run(NEXT_BIN, ["build"]);
} else {
  console.log(`== reusing existing build (${buildIdFile}) ==`);
}

// ---------------------------------------------------------------------------
// 3. Start the server.

console.log(`== starting next start -p ${PORT} ==`);
const server = spawn(NEXT_BIN, ["start", "-p", String(PORT)], {
  cwd: REPO_ROOT,
  env: {
    ...process.env,
    DEMO_MODE: "1",
    SESSION_SECRET,
    DATA_DIR: SCRATCH_DIR,
    PORT: String(PORT),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d.toString()));
server.stderr.on("data", (d) => (serverLog += d.toString()));

let exitCode = 0;
try {
  await waitForServer(BASE_URL);
  console.log("== server up ==");

  // -------------------------------------------------------------------------
  // 4. Mint the session cookie.

  const token = runCapture("npx", [
    "tsx",
    "scripts/dev/mint-session.ts",
    meta.userId,
    SESSION_SECRET,
  ]).trim();
  if (!token || token.split(".").length !== 4) {
    throw new Error(`mint-session produced an unexpected token: ${JSON.stringify(token)}`);
  }

  // -------------------------------------------------------------------------
  // 5. Drive the phone shell.

  const outDir = SCRATCH_DIR;
  const metrics = {};
  const shots = [];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    });
    await context.addCookies([
      {
        name: "wm_session",
        value: token,
        url: BASE_URL,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    // Both shells render at all times (CSS picks one — see app/globals.css's
    // "phone shell" block), and Vaul's sheets portal their content onto
    // <body> — outside `[data-shell="phone"]` — so a DOM-position scope can't
    // tell the live phone content apart from the hidden desktop duplicate.
    // Filtering to what's actually on screen can, everywhere role/text
    // queries would otherwise be ambiguous between the two trees.
    const phone = page.locator('[data-shell="phone"]');
    const vis = (loc) => loc.and(page.locator(":visible"));

    async function collectMetrics() {
      return page.evaluate(() => {
        const isVisible = (el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return false;
          const cs = getComputedStyle(el);
          return cs.visibility !== "hidden" && cs.display !== "none";
        };
        const fontSet = new Set();
        const colorSet = new Set();
        const rowHeights = new Set();
        const tapTargets = [];
        const smallInteractive = [];

        document.querySelectorAll("body *").forEach((el) => {
          if (!isVisible(el)) return;
          const cs = getComputedStyle(el);
          if (
            el.childElementCount === 0 ||
            el.matches("button,a,input,textarea,label,span,p,h1,h2,h3")
          ) {
            fontSet.add(`${cs.fontSize} / ${cs.fontWeight} / ${cs.lineHeight}`);
          }
          for (const prop of ["color", "backgroundColor", "borderColor"]) {
            const v = cs[prop];
            if (v && v !== "rgba(0, 0, 0, 0)" && v !== "transparent") colorSet.add(v);
          }
        });

        document
          .querySelectorAll(".phone-row, .phone-rowwrap, .wm-ph-row, .wm-ph-card")
          .forEach((el) => {
            if (!isVisible(el)) return;
            rowHeights.add(Math.round(el.getBoundingClientRect().height));
          });

        const interactiveSel =
          'button, a[href], input, textarea, select, [role="button"], [role="checkbox"], [role="radio"], [role="tab"]';
        document.querySelectorAll(interactiveSel).forEach((el) => {
          if (!isVisible(el)) return;
          const r = el.getBoundingClientRect();
          const label =
            el.getAttribute("aria-label") || el.textContent.trim().slice(0, 40) || el.tagName;
          const box = { label, width: Math.round(r.width), height: Math.round(r.height) };
          tapTargets.push(box);
          if (r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44)) {
            smallInteractive.push(box);
          }
        });

        return {
          fonts: [...fontSet].sort(),
          colors: [...colorSet].sort(),
          rowHeights: [...rowHeights].sort((a, b) => a - b),
          tapTargets,
          smallInteractive,
        };
      });
    }

    async function snap(name) {
      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
      metrics[name] = await collectMetrics();
      console.log(`  shot: ${name}.png`);
    }

    // ---- Now --------------------------------------------------------------
    await page.goto(BASE_URL, { waitUntil: "load" });
    await page.waitForSelector(".phone-shell", { timeout: 15_000 });
    await snap("now");

    const firstDue = page
      .locator('.phone-section:has(.phone-section__title:text("Due today")) .phone-rows li')
      .first()
      .locator('[role="checkbox"]');
    await firstDue.click();
    await snap("now-after-tap");
    await page.waitForTimeout(80);
    await snap("now-tap-080");
    await page.waitForTimeout(520); // total ~600ms since the tap
    await snap("now-tap-600");

    await page.locator("button.phone-section__toggle").click();
    await snap("now-done-expanded");

    // ---- Lists --------------------------------------------------------------
    await page.locator('nav.phone-tabs button[aria-label="Lists"]').click();
    await page.waitForTimeout(200);
    await snap("lists-focus");

    await phone.getByRole("tab", { name: "Backlog" }).click();
    await page.waitForTimeout(300);
    await snap("lists-backlog");

    const swipeRow = page.locator("#phone-page-backlog .phone-row").first();
    const box = await swipeRow.boundingBox();
    if (!box) throw new Error("no backlog row to swipe");
    // Start well inside SWIPE_EDGE_INSET (28px, phone-logic.ts) from either
    // edge — the row's own bounding box runs edge-to-edge, so anchoring off
    // its right edge lands in iOS's back-swipe turf and the row ignores it.
    const startX = 330;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 20, startY, { steps: 3 });
    await page.mouse.move(startX - 150, startY, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const revealedCount = await page.locator("#phone-page-backlog .phone-row__actions").count();
    if (revealedCount === 0) throw new Error("swipe did not reveal row actions");
    await snap("lists-swipe-revealed");

    // ---- Card sheet (Formation — details + 3 sub-cards) --------------------
    await phone.getByRole("tab", { name: "Focus" }).click();
    await page.waitForTimeout(300);
    await page.locator(".phone-row__title", { hasText: /^Formation$/ }).click();
    await page.waitForTimeout(300);
    await snap("card-peek");

    await page.locator('button[aria-label="Show card details"]').click();
    await page.waitForTimeout(250);
    await snap("card-full");

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // ---- Capture --------------------------------------------------------------
    await page.locator('nav.phone-tabs button[aria-label="Capture a thought"]').click();
    await page.waitForTimeout(300);
    await snap("capture");

    const captureField = page.locator('textarea[aria-label="What\'s on your mind?"]');
    await captureField.click();
    await page.keyboard.type("Pick up dry cleaning");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Text Sam about Saturday");
    await snap("capture-typed");

    await vis(page.getByRole("button", { name: "Cancel" })).click();
    await page.waitForTimeout(400);

    // ---- Find -----------------------------------------------------------------
    await page.locator('nav.phone-tabs button[aria-label="Find"]').click();
    await page.waitForTimeout(200);
    await vis(page.getByLabel("Find a card by its title or details")).fill("job");
    await page.waitForTimeout(400);
    await snap("search");

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // ---- More + its rows --------------------------------------------------
    await page.locator('nav.phone-tabs button[aria-label="More"]').click();
    await page.waitForTimeout(250);
    await snap("more");

    await vis(page.getByText("Weekly review", { exact: true })).click();
    await page.waitForTimeout(300);
    await snap("review");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    await page.locator('nav.phone-tabs button[aria-label="More"]').click();
    await page.waitForTimeout(250);
    await vis(page.getByText("Note", { exact: true })).click();
    await page.waitForTimeout(300);
    await snap("note");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    await page.locator('nav.phone-tabs button[aria-label="More"]').click();
    await page.waitForTimeout(250);
    await vis(page.getByText("Time travel", { exact: true })).click();
    await page.waitForTimeout(900); // let the timeline fetch land
    const scrub = page.locator("input.wm-ph-scrub");
    const [min, max] = await scrub.evaluate((el) => [Number(el.min), Number(el.max)]);
    // A week ago, clamped into range — recent enough that most of the board
    // already exists (so the past view reads as populated, not sparse), far
    // enough back that today's check-offs and the newest captures haven't
    // happened yet.
    const mid = Math.min(max, Math.max(min, Date.now() - 7 * 86_400_000));
    await scrub.evaluate((el, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, mid);
    await page.waitForTimeout(200);
    await snap("timetravel");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    await page.locator('nav.phone-tabs button[aria-label="More"]').click();
    await page.waitForTimeout(250);
    await vis(page.getByText("Boards", { exact: true })).click();
    await page.waitForTimeout(300);
    await snap("boards");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    await context.close();

    // ---- Desktop reference, same board -------------------------------------
    const deskContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    });
    await deskContext.addCookies([
      { name: "wm_session", value: token, url: BASE_URL, httpOnly: true, sameSite: "Lax" },
    ]);
    const deskPage = await deskContext.newPage();
    await deskPage.goto(BASE_URL, { waitUntil: "load" });
    await deskPage.waitForSelector('[data-shell="desktop"]', { timeout: 15_000 });
    await deskPage.waitForTimeout(1000); // let the lazy-loaded Markdown chunks resolve
    const deskFile = path.join(outDir, "desktop-1280.png");
    await deskPage.screenshot({ path: deskFile });
    shots.push(deskFile);
    metrics["desktop-1280"] = await deskPage.evaluate(() => {
      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 || r.height > 0;
      };
      const fontSet = new Set();
      document.querySelectorAll("body *").forEach((el) => {
        if (!isVisible(el)) return;
        const cs = getComputedStyle(el);
        if (el.childElementCount === 0) fontSet.add(`${cs.fontSize} / ${cs.fontWeight} / ${cs.lineHeight}`);
      });
      return { fonts: [...fontSet].sort() };
    });
    console.log("  shot: desktop-1280.png");
    await deskContext.close();
  } finally {
    await browser.close();
  }

  writeFileSync(path.join(outDir, "dom-metrics.json"), JSON.stringify(metrics, null, 2));

  // ---------------------------------------------------------------------------
  // Verify every PNG exists and is non-trivially sized.

  console.log("== verifying ==");
  let allGood = true;
  for (const file of shots) {
    if (!existsSync(file)) {
      console.error(`MISSING: ${file}`);
      allGood = false;
      continue;
    }
    const { size } = statSync(file);
    if (size < 2000) {
      console.error(`SUSPICIOUSLY SMALL (${size}B, likely blank): ${file}`);
      allGood = false;
    } else {
      console.log(`  ok (${size}B): ${file}`);
    }
  }
  if (!allGood) {
    exitCode = 1;
  } else {
    console.log(`All ${shots.length} PNGs verified. Metrics: ${path.join(outDir, "dom-metrics.json")}`);
  }
} catch (err) {
  console.error(err);
  console.error("---- server log tail ----");
  console.error(serverLog.slice(-4000));
  exitCode = 1;
} finally {
  console.log("== killing server ==");
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 300));
  if (!server.killed) server.kill("SIGKILL");
}

process.exit(exitCode);
