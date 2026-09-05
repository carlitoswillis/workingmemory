#!/usr/bin/env node
// P2 acceptance, run against a live `next start` (PHONE_DEMO_PORT, default 3125).
// Every claim in the plan's "Acceptance" list for package P2 — chrome — plus the
// iOS-keyboard simulation the brief mandates: headless Chromium cannot raise a
// keyboard, so we shrink the viewport to 375x430 with a sheet open and its field
// focused, and assert that nothing floated off the top of the screen.
//
//   PHONE_DEMO_PORT=3125 node scripts/dev/assert-p2.mjs

import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR =
  process.env.PHONE_DEMO_DIR ??
  "/private/tmp/claude-501/-Users-carlitoswillis-workspace/d0c88bad-af13-4089-a699-c66f45e77acf/scratchpad/pass2/P2-chrome";
const PORT = Number(process.env.PHONE_DEMO_PORT ?? 3125);
const BASE = `http://localhost:${PORT}`;
const SESSION_SECRET = "phone-demo-session-secret-2026-not-real";

const meta = JSON.parse(readFileSync(path.join(DIR, "meta.json"), "utf8"));
const token = spawnSync(
  "npx",
  ["tsx", "scripts/dev/mint-session.ts", meta.userId, SESSION_SECRET],
  { cwd: REPO_ROOT },
)
  .stdout.toString()
  .trim();

let fails = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) {
    fails++;
    console.error(`✗ ${label} ${detail}`);
  } else {
    console.log(`✓ ${label} ${detail}`);
  }
};

function luminance([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const parse = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
const contrast = (a, b) => {
  const [l1, l2] = [luminance(parse(a)), luminance(parse(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await context.addCookies([
  { name: "wm_session", value: token, url: BASE, httpOnly: true, sameSite: "Lax" },
]);
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector(".phone-shell");

// --- no uppercase anywhere under the phone shell -----------------------------
const upper = await page.$$eval('[data-shell="phone"] *', (els) =>
  els
    .filter((el) => getComputedStyle(el).textTransform === "uppercase")
    .map((el) => el.className || el.tagName),
);
ok("no text-transform: uppercase under the phone shell", upper.length === 0, JSON.stringify(upper));

// --- the shell root is fixed -------------------------------------------------
const shell = await page.$eval('[data-shell="phone"]', (el) => {
  const cs = getComputedStyle(el);
  return { position: cs.position, overflow: cs.overflow, height: cs.height };
});
ok("shell root position is fixed", shell.position === "fixed", JSON.stringify(shell));
ok("shell root clips its own overflow", shell.overflow === "hidden");

// --- --text-lo contrast, both themes -----------------------------------------
for (const theme of ["dark", "light"]) {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  const { lo, bg } = await page.evaluate(() => {
    const probe = document.createElement("div");
    document.body.appendChild(probe);
    probe.style.color = "var(--text-lo)";
    probe.style.backgroundColor = "var(--bg-1)";
    const cs = getComputedStyle(probe);
    const out = { lo: cs.color, bg: cs.backgroundColor };
    probe.remove();
    return out;
  });
  const c = contrast(lo, bg);
  ok(`--text-lo on --bg-1 >= 4.5:1 (${theme})`, c >= 4.5, `${c.toFixed(2)}:1  ${lo} on ${bg}`);
}
await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));

// --- tab glyph weights, one inactive colour, 44px targets --------------------
const tabs = await page.$$eval("nav.phone-tabs .phone-tab", (els) =>
  els.map((el) => {
    const g = el.querySelector(".phone-tab__glyph");
    // Outlined marks carry weight as stroke-width; the More glyph's filled dots
    // carry the same cue as radius. Read whichever this glyph is built from.
    const outlined = g.querySelector('[fill="none"]');
    const filled = g.querySelector('circle[fill="currentColor"]');
    const r = el.getBoundingClientRect();
    return {
      label: el.getAttribute("aria-label"),
      current: el.classList.contains("is-current"),
      stroke: outlined ? getComputedStyle(outlined).strokeWidth : null,
      dotR: filled ? getComputedStyle(filled).r : null,
      color: getComputedStyle(el).color,
      h: Math.round(r.height),
    };
  }),
);
const current = tabs.find((t) => t.current);
ok("active tab glyph stroke-width is 1.8px", current.stroke === "1.8px", `${current.label}=${current.stroke}`);
const inactive = tabs.filter((t) => !t.current);
ok(
  "inactive outlined glyphs are 1.6px (capture's two-stroke plus is 2px by design)",
  inactive.every(
    (t) => t.stroke === null || t.stroke === "1.6px" || (t.label === "Capture a thought" && t.stroke === "2px"),
  ),
  JSON.stringify(inactive.map((t) => [t.label, t.stroke])),
);
// The More glyph has no stroke to thicken, so it must express "current" some other
// way than hue alone — otherwise one of the five tabs quietly fails the rule.
const moreTab = tabs.find((t) => t.label === "More");
ok("the More glyph is not signalled by hue alone", moreTab.dotR === "1.5px", `resting r=${moreTab.dotR}`);
const inactiveColors = new Set(inactive.map((t) => t.color));
ok("all four inactive tabs share one colour", inactiveColors.size === 1, [...inactiveColors].join(" "));
ok("every tab is at least 44px tall", tabs.every((t) => t.h >= 44), JSON.stringify(tabs.map((t) => t.h)));

// --- the segment strip fades at both edges -----------------------------------
await page.locator('nav.phone-tabs button[aria-label="Lists"]').click();
await page.waitForTimeout(250);
const mask = await page.$eval(".phone-seg", (el) => {
  const cs = getComputedStyle(el);
  return cs.maskImage && cs.maskImage !== "none" ? cs.maskImage : cs.webkitMaskImage;
});
ok(".phone-seg has a non-none mask-image", Boolean(mask) && mask !== "none", String(mask).slice(0, 64));

// --- empty copy is a sentence, and a parent carries its sub-card count --------
const empties = await page.$$eval(".phone-empty", (els) => els.map((e) => e.textContent.trim()));
ok("no em-dash empty copy", !empties.some((t) => t.includes("—")), JSON.stringify(empties));
const subMeta = await page.$$eval("#phone-page-focus .phone-row__meta", (els) =>
  els.map((e) => e.textContent.trim()),
);
ok("a parent on Lists shows its sub-card count", subMeta.some((t) => /sub-cards?/.test(t)), JSON.stringify(subMeta));

// --- --vvh exists the moment a sheet opens -----------------------------------
await page.locator('nav.phone-tabs button[aria-label="Find"]').click();
await page.waitForTimeout(400);
const vvh = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue("--vvh").trim(),
);
ok("--vvh is a px value with a sheet open", /^\d+px$/.test(vvh), vvh);
const shellH = await page.$eval('[data-shell="phone"]', (el) => Math.round(el.getBoundingClientRect().height));
ok("shell height tracks --vvh while a sheet is open", Math.abs(shellH - parseInt(vvh, 10)) <= 1, `${shellH} vs ${vvh}`);

// --- THE OWNER'S BUG ---------------------------------------------------------
// "the search opens up the keyboard so the whole app is floated up, I can't see the
// entry box but can see some results". Focus the field, then shrink the visible
// viewport the way a keyboard does, and check the field is still on screen.
const field = page.getByLabel("Find a card by its title or details");
await field.click();
await field.fill("job");
await page.waitForTimeout(300);
await page.setViewportSize({ width: 375, height: 430 });
await page.waitForTimeout(400);

const kb = await page.evaluate(() => {
  const el =
    document.querySelector('.wm-sheet input[type="search"]') ??
    document.querySelector(".wm-sheet input") ??
    document.querySelector(".wm-ph-field");
  const r = el?.getBoundingClientRect();
  return {
    focused: document.activeElement === el,
    top: r ? Math.round(r.top) : null,
    bottom: r ? Math.round(r.bottom) : null,
    inner: window.innerHeight,
    scrollY: Math.round(window.scrollY),
    docScroll: Math.round(document.scrollingElement.scrollTop),
    vvh: getComputedStyle(document.documentElement).getPropertyValue("--vvh").trim(),
    shellH: Math.round(document.querySelector('[data-shell="phone"]').getBoundingClientRect().height),
  };
});
ok("the field is still focused after the viewport shrinks", kb.focused, JSON.stringify(kb));
ok("the field's top edge is still on screen", kb.top !== null && kb.top >= 0, `top=${kb.top}`);
ok("the whole field is on screen", kb.bottom !== null && kb.bottom <= kb.inner, `bottom=${kb.bottom} inner=${kb.inner}`);
ok("the layout viewport did not float the app up", kb.scrollY === 0 && kb.docScroll === 0, `scrollY=${kb.scrollY} doc=${kb.docScroll}`);
ok("--vvh followed the shrink", parseInt(kb.vvh, 10) <= 430, kb.vvh);
ok("the shell re-measured to the visible viewport", Math.abs(kb.shellH - 430) <= 1, `${kb.shellH}`);
await page.screenshot({ path: path.join(DIR, "keyboard-375x430.png") });

// --- nothing scrolls the document at rest ------------------------------------
await page.setViewportSize({ width: 375, height: 812 });
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
const scrollable = await page.evaluate(() => ({
  doc: document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
}));
ok("the document itself has nothing to scroll", scrollable.doc <= 1, JSON.stringify(scrollable));

// --- the serif is rationed, and the title is 510 -----------------------------
// The FIRST family only — "sans-serif" at the end of every fallback stack would
// otherwise match every element in the app.
const serifs = await page.$$eval('[data-shell="phone"] *', (els) =>
  els
    .filter((el) => {
      if (el.childElementCount !== 0 || !el.textContent.trim()) return false;
      const first = getComputedStyle(el).fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
      return /fraunces|georgia|^serif$/i.test(first);
    })
    .map((el) => `${el.className}: ${el.textContent.trim().slice(0, 28)}`),
);
console.log(`  serif users on this screen: ${JSON.stringify(serifs, null, 1)}`);
const titleWeight = await page.$eval(".phone-title", (el) => getComputedStyle(el).fontWeight);
ok("page title weight is 510", titleWeight === "510", titleWeight);

// --- the desktop board is untouched by the now-fixed phone shell -------------
const desk = await context.newPage();
await desk.setViewportSize({ width: 1280, height: 800 });
await desk.goto(BASE, { waitUntil: "load" });
await desk.waitForSelector('[data-shell="desktop"]');
const deskOk = await desk.$eval('[data-shell="desktop"]', (el) => {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { display: cs.display, w: Math.round(r.width), h: Math.round(r.height) };
});
ok(
  "the desktop board still renders at 1280",
  deskOk.display !== "none" && deskOk.w > 1000 && deskOk.h > 400,
  JSON.stringify(deskOk),
);
await desk.screenshot({ path: path.join(DIR, "desktop-check.png") });

await browser.close();
console.log(fails === 0 ? "\nall P2 acceptance checks passed" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
