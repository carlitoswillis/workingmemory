// Run: node lib/streaks.test.ts   (Node 26 strips the TS types natively)
import { completedDays, currentStreak, prevDay } from "./streaks.ts";

let failures = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.error(`✗ ${label}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

const ev = (new_value: string | null, old_value: string | null = null) => ({
  field: "completed_on",
  new_value,
  old_value,
});

// --- prevDay ----------------------------------------------------------------
eq("prevDay mid-month", prevDay("2026-07-03"), "2026-07-02");
eq("prevDay across month", prevDay("2026-07-01"), "2026-06-30");
eq("prevDay across year", prevDay("2026-01-01"), "2025-12-31");
eq("prevDay leap Feb", prevDay("2024-03-01"), "2024-02-29");

// --- completedDays ----------------------------------------------------------
eq(
  "check adds a day",
  [...completedDays([ev("2026-07-01")], null)],
  ["2026-07-01"],
);
eq(
  "uncheck removes the cleared day",
  [...completedDays([ev("2026-07-01"), ev(null, "2026-07-01")], null)],
  [],
);
eq(
  "re-check after uncheck counts again",
  [...completedDays([ev("2026-07-01"), ev(null, "2026-07-01"), ev("2026-07-01")], null)],
  ["2026-07-01"],
);
eq(
  "later day does not erase earlier day",
  [...completedDays([ev("2026-07-01"), ev("2026-07-02")], null)].sort(),
  ["2026-07-01", "2026-07-02"],
);
eq(
  "current completed_on seeds pre-trigger history",
  [...completedDays([], "2026-06-30")],
  ["2026-06-30"],
);
eq(
  "non-completed_on fields ignored",
  [...completedDays([{ field: "done", new_value: "true", old_value: "false" }], null)],
  [],
);
eq(
  "garbage new_value ignored",
  [...completedDays([ev("not-a-date")], "also-bad")],
  [],
);

// --- currentStreak ----------------------------------------------------------
const days = (...d: string[]) => new Set(d);

eq("empty set → 0", currentStreak(days(), "2026-07-03"), 0);
eq("today only → 1", currentStreak(days("2026-07-03"), "2026-07-03"), 1);
eq(
  "3 consecutive ending today",
  currentStreak(days("2026-07-01", "2026-07-02", "2026-07-03"), "2026-07-03"),
  3,
);
eq(
  "today unchecked: streak ends yesterday, not broken",
  currentStreak(days("2026-07-01", "2026-07-02"), "2026-07-03"),
  2,
);
eq(
  "gap two days ago breaks the run",
  currentStreak(days("2026-06-30", "2026-07-02", "2026-07-03"), "2026-07-03"),
  2,
);
eq(
  "only old history, gap before yesterday → 0",
  currentStreak(days("2026-06-28"), "2026-07-03"),
  0,
);
eq(
  "run across month boundary",
  currentStreak(days("2026-06-29", "2026-06-30", "2026-07-01"), "2026-07-01"),
  3,
);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall streak tests passed");
