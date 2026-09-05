// Run: node components/collapsibleColumn.test.ts   (plain node script, same
// convention as lib/*.test.ts)
//
// Covers the pure logic behind the collapsible Weekly-review / Note columns:
// the per-board/per-column storage key, the localStorage read/write guards
// (wrapped in try/catch so a private-mode or storage-disabled browser can't
// crash the board), the phone-viewport check, and the two collapsed-header
// summary strings (the review's week label, the note's first line).

import {
  collapseStorageKey,
  firstLineSummary,
  isPhoneViewport,
  readStoredCollapsed,
  reviewWeekLabel,
  writeStoredCollapsed,
} from "./collapsibleColumn.ts";

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

// --- collapseStorageKey ------------------------------------------------------

ok("key scopes by board and kind", collapseStorageKey("b1", "review"), "wm:collapsed:b1:review");
ok("key scopes note separately from review", collapseStorageKey("b1", "note"), "wm:collapsed:b1:note");
ok("null boardId (local/demo mode) gets its own bucket", collapseStorageKey(null, "note"), "wm:collapsed:local:note");

// --- read/write against a fake localStorage ---------------------------------

type FakeStorage = Storage;
function installFakeLocalStorage(): { store: Map<string, string> } {
  const store = new Map<string, string>();
  const fake: FakeStorage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
  };
  // @ts-expect-error — minimal window shim for this test file only
  globalThis.window = { localStorage: fake };
  return { store };
}
function removeFakeLocalStorage() {
  // @ts-expect-error — undo the shim
  delete globalThis.window;
}

{
  installFakeLocalStorage();
  ok("nothing stored yet reads as null", readStoredCollapsed("b1", "review"), null);
  writeStoredCollapsed("b1", "review", true);
  ok("stored true reads back true", readStoredCollapsed("b1", "review"), true);
  writeStoredCollapsed("b1", "review", false);
  ok("stored false reads back false", readStoredCollapsed("b1", "review"), false);
  ok("a different kind on the same board is untouched", readStoredCollapsed("b1", "note"), null);
  ok("a different board is untouched", readStoredCollapsed("b2", "review"), null);
  removeFakeLocalStorage();
}

{
  // No window at all (SSR) — both must degrade quietly rather than throw.
  ok("read with no window returns null", readStoredCollapsed("b1", "review"), null);
  writeStoredCollapsed("b1", "review", true); // must not throw
  ok("isPhoneViewport with no window is false", isPhoneViewport(), false);
}

{
  // A localStorage getItem/setItem that throws (private mode / quota) must not
  // propagate — both read and write degrade to "not persisted" instead.
  const throwing: FakeStorage = {
    length: 0,
    clear: () => {},
    getItem: () => {
      throw new Error("blocked");
    },
    key: () => null,
    removeItem: () => {},
    setItem: () => {
      throw new Error("blocked");
    },
  };
  // @ts-expect-error — minimal window shim for this test file only
  globalThis.window = { localStorage: throwing };
  ok("read against a throwing store returns null", readStoredCollapsed("b1", "review"), null);
  writeStoredCollapsed("b1", "review", true); // must not throw
  removeFakeLocalStorage();
}

// --- reviewWeekLabel ---------------------------------------------------------

ok(
  "same-month week reads as a single range",
  reviewWeekLabel("2026-08-31T09:00:00Z", new Date("2026-09-04T00:00:00Z")),
  "Week of Aug 24–31"
);
ok(
  "a week spanning two months names both",
  reviewWeekLabel("2026-09-05T09:00:00Z", new Date("2026-09-05T00:00:00Z")),
  "Week of Aug 29–Sep 5"
);
ok(
  "an off-year review carries the year",
  reviewWeekLabel("2025-08-31T09:00:00Z", new Date("2026-09-04T00:00:00Z")),
  "Week of Aug 24–31, 2025"
);
ok("an unparseable date falls back to a plain label", reviewWeekLabel("not-a-date"), "Weekly review");

// --- firstLineSummary ---------------------------------------------------------

ok("picks the first non-empty line", firstLineSummary("\n\nWrite the proposal\nmore stuff"), "Write the proposal");
ok("strips a markdown heading marker", firstLineSummary("### Today\nbody"), "Today");
ok("strips a checkbox list marker", firstLineSummary("- [ ] Ship the thing"), "Ship the thing");
ok("strips a blockquote marker", firstLineSummary("> quoted line"), "quoted line");
ok("truncates a long line with an ellipsis", firstLineSummary("x".repeat(80), 10), `${"x".repeat(9)}…`);
ok("empty body yields an empty summary", firstLineSummary("   \n   "), "");

if (failures > 0) {
  console.error(`\n${failures} collapsibleColumn test(s) failed`);
  process.exit(1);
}
console.log("\nall collapsibleColumn tests passed");
