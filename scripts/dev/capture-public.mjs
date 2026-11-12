#!/usr/bin/env node
// PUBLIC-SAFE screenshot set for the README + portfolio site.
//
//   node scripts/dev/capture-public.mjs
//
// Modeled on scripts/dev/capture-phone.mjs but pointed at the fictional seed
// (scripts/dev/seed-public-demo.ts) and trimmed to just the shots the README
// needs. What it does, in order (idempotent — safe to re-run):
//   1. Rebuilds the seed DB fresh (scripts/dev/seed-public-demo.ts).
//   2. Builds the app if there's no production build yet.
//   3. Starts `next start` on :3127, pointed at the seed DB via DATA_DIR.
//   4. Mints a session cookie for the seeded "demo" user and hands it to
//      Playwright.
//   5. Drives the phone shell (375×812 @2x, isMobile, hasTouch) through Now,
//      Lists, a card sheet (with sub-cards), and Capture.
//   6. Grabs a light-theme "Now" shot (colorScheme: 'light').
//   7. Grabs two 1280×800 desktop shots: the full board, and the board with
//      the time machine scrubbed to a past moment (or skips that one, and
//      says so, if the scrubber can't be driven).
//   8. Kills the server.

import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, copyFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRATCH_DIR =
  process.env.PUBLIC_DEMO_DIR ??
  "/private/tmp/claude-501/-Users-carlitoswillis-workspace/d0c88bad-af13-4089-a699-c66f45e77acf/scratchpad/public-demo";
const OUT_DIR = path.join(REPO_ROOT, "docs", "media");
const PORT = 3127;
const BASE_URL = `http://localhost:${PORT}`;
const SESSION_SECRET = "public-demo-session-secret-2026-not-real";

mkdirSync(SCRATCH_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

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

// Best-effort PNG shrink: try `pngquant` first (real lossy palette compression,
// often a large win), then macOS's `sips` reformat as a fallback — but `sips`
// re-encoding a PNG through its own encoder can come out LARGER than
// Playwright's already-decent output, so only keep whichever is smaller.
function shrinkPng(file) {
  const before = statSync(file).size;
  const tmp = `${file}.tmp.png`;

  const pngquant = spawnSync(
    "pngquant",
    ["--quality=65-90", "--force", "--output", tmp, file],
    { stdio: "ignore" },
  );
  if (pngquant.status === 0 && existsSync(tmp)) {
    const after = statSync(tmp).size;
    if (after < before) {
      copyFileSync(tmp, file);
      rmSync(tmp, { force: true });
      return "pngquant";
    }
    rmSync(tmp, { force: true });
  }

  const sips = spawnSync("sips", ["-s", "format", "png", file, "--out", tmp], {
    stdio: "ignore",
  });
  if (sips.status === 0 && existsSync(tmp)) {
    const after = statSync(tmp).size;
    if (after < before) {
      copyFileSync(tmp, file);
      rmSync(tmp, { force: true });
      return "sips";
    }
    rmSync(tmp, { force: true });
  }

  return "none";
}

const skipped = [];

// ---------------------------------------------------------------------------
// 1. Seed.

console.log("== seeding (public-safe, fictional data) ==");
run("npx", ["tsx", "scripts/dev/seed-public-demo.ts"], {
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
  const cookie = { name: "wm_session", value: token, url: BASE_URL, httpOnly: true, sameSite: "Lax" };

  const shots = [];
  function record(file) {
    shots.push(file);
    console.log(`  shot: ${path.basename(file)}`);
  }

  const browser = await chromium.launch();
  try {
    // -----------------------------------------------------------------------
    // 5. Phone shell — Now, Lists, card sheet (sub-cards), Capture.

    const phoneContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      // Dark ("Nocturne") is the app's default look — but Chromium/Playwright's
      // own default colorScheme is "light", and lib/theme.ts follows the
      // system preference when there's no stored choice, so this must be
      // explicit or every "default" shot comes out light instead.
      colorScheme: "dark",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    });
    await phoneContext.addCookies([cookie]);
    const phonePage = await phoneContext.newPage();
    const phone = phonePage.locator('[data-shell="phone"]');
    const vis = (loc) => loc.and(phonePage.locator(":visible"));

    await phonePage.goto(BASE_URL, { waitUntil: "load" });
    await phonePage.waitForSelector(".phone-shell", { timeout: 15_000 });
    await phonePage.waitForTimeout(300);
    const nowFile = path.join(OUT_DIR, "phone-now.png");
    await phonePage.screenshot({ path: nowFile });
    record(nowFile);

    await phonePage.locator('nav.phone-tabs button[aria-label="Lists"]').click();
    await phonePage.waitForTimeout(300);
    const listsFile = path.join(OUT_DIR, "phone-lists.png");
    await phonePage.screenshot({ path: listsFile });
    record(listsFile);

    // Card sheet peek — "Plan the Lisbon trip" carries its 3 sub-cards.
    await phone.getByRole("tab", { name: "Focus" }).click();
    await phonePage.waitForTimeout(300);
    await phonePage
      .locator(".phone-row__title", { hasText: /^Plan the Lisbon trip$/ })
      .click();
    await phonePage.waitForTimeout(300);
    const cardFile = path.join(OUT_DIR, "phone-card.png");
    await phonePage.screenshot({ path: cardFile });
    record(cardFile);
    await phonePage.keyboard.press("Escape");
    await phonePage.waitForTimeout(400);

    await phonePage.locator('nav.phone-tabs button[aria-label="Capture a thought"]').click();
    await phonePage.waitForTimeout(300);
    const captureFile = path.join(OUT_DIR, "phone-capture.png");
    await phonePage.screenshot({ path: captureFile });
    record(captureFile);
    await vis(phonePage.getByRole("button", { name: "Cancel" })).click();
    await phonePage.waitForTimeout(300);

    await phoneContext.close();

    // -----------------------------------------------------------------------
    // 6. Light-theme "Now" shot.

    const lightContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: "light",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    });
    await lightContext.addCookies([cookie]);
    const lightPage = await lightContext.newPage();
    await lightPage.goto(BASE_URL, { waitUntil: "load" });
    await lightPage.waitForSelector(".phone-shell", { timeout: 15_000 });
    await lightPage.waitForTimeout(300);
    const nowLightFile = path.join(OUT_DIR, "phone-now-light.png");
    await lightPage.screenshot({ path: nowLightFile });
    record(nowLightFile);
    await lightContext.close();

    // -----------------------------------------------------------------------
    // 7. Desktop — full board, then time machine scrubbed to a past moment.

    const deskContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      colorScheme: "dark",
    });
    await deskContext.addCookies([cookie]);
    const deskPage = await deskContext.newPage();
    await deskPage.goto(BASE_URL, { waitUntil: "load" });
    await deskPage.waitForSelector('[data-shell="desktop"]', { timeout: 15_000 });
    await deskPage.waitForTimeout(1000); // let the lazy-loaded Markdown chunks resolve
    const boardFile = path.join(OUT_DIR, "desktop-board.png");
    await deskPage.screenshot({ path: boardFile });
    record(boardFile);

    // The dateline's ruler (components/Dateline.tsx) — the desktop one is the
    // only range input on the page; the phone shell's is a tap band, not a range.
    const scrub = deskPage.locator('input.wm-ruler__input[aria-label="Rewind the board"]');
    let scrubDriven = false;
    if (await scrub.count()) {
      try {
        const [min, max] = await scrub.evaluate((el) => [Number(el.min), Number(el.max)]);
        if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
          // A week ago, clamped into range — recent enough most of the board
          // already exists, far enough back that recent moves/completions
          // haven't happened yet, so the past view visibly differs.
          const mid = Math.min(max, Math.max(min, Date.now() - 7 * 86_400_000));
          await scrub.evaluate((el, v) => {
            el.value = String(v);
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }, mid);
          await deskPage.waitForTimeout(400);
          scrubDriven = true;
        }
      } catch (err) {
        console.error(`  time machine scrub failed: ${err}`);
      }
    }
    if (scrubDriven) {
      const ttFile = path.join(OUT_DIR, "desktop-timetravel.png");
      await deskPage.screenshot({ path: ttFile });
      record(ttFile);
    } else {
      skipped.push(
        "desktop-timetravel.png — could not find/drive the time-machine scrubber (input.tm-range)",
      );
    }
    await deskContext.close();
  } finally {
    await browser.close();
  }

  // ---------------------------------------------------------------------------
  // Shrink + verify.

  console.log("== shrinking PNGs (pngquant, else sips, else left as-is) ==");
  for (const file of shots) {
    const before = statSync(file).size;
    const method = shrinkPng(file);
    const after = statSync(file).size;
    console.log(`  ${path.basename(file)}: ${before}B -> ${after}B (${method})`);
  }

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
      const flag = size > 400_000 ? "  (over 400KB budget)" : "";
      console.log(`  ok (${size}B): ${file}${flag}`);
    }
  }
  if (skipped.length) {
    console.log("== skipped ==");
    for (const s of skipped) console.log(`  ${s}`);
  }
  if (!allGood) {
    exitCode = 1;
  } else {
    console.log(`All ${shots.length} PNGs verified in ${OUT_DIR}.`);
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
