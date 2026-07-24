// Run: node lib/recurrence.test.ts   (plain node script, same convention as the others)
//
// Repeating cards (lib/recurrence.ts + the weekly half of lib/streaks.ts): parsing,
// the derived reset, and the rule the owner asked for — a weekly card checked off
// STAYS done until its weekday comes round again.

import {
  addDays,
  describeRecurrence,
  effectiveDone,
  formatRecurrence,
  parseRecurrence,
  periodStart,
  resetsOn,
  weekdayOf,
} from "./recurrence.ts";
import { daysWithLiveCheck, streakFor, weeklyStreak } from "./streaks.ts";

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

// 2026-07-22 is a Wednesday (weekday 3).
const WED = "2026-07-22";
const THU = "2026-07-23";
const SUN = "2026-07-26";
const TUE = "2026-07-28"; // the day before the next Wednesday
const NEXT_WED = "2026-07-29";

ok("weekdayOf knows its Wednesdays", weekdayOf(WED), 3);
ok("weekdayOf knows its Sundays", weekdayOf(SUN), 0);

// --- parsing / formatting ---------------------------------------------------
ok("parses none", parseRecurrence("none"), { kind: "none" });
ok("parses daily", parseRecurrence("daily"), { kind: "daily" });
ok("parses a weekday", parseRecurrence("weekly:3"), { kind: "weekly", weekday: 3 });
ok("junk collapses to none", parseRecurrence("weekly:9"), { kind: "none" });
ok("null collapses to none", parseRecurrence(null), { kind: "none" });
ok("round-trips", formatRecurrence(parseRecurrence("weekly:0")), "weekly:0");
ok("describes itself", describeRecurrence({ kind: "weekly", weekday: 3 }), "Every Wednesday");

// --- the week a day belongs to ----------------------------------------------
ok("Wednesday starts its own week", periodStart(WED, 3), WED);
ok("Thursday belongs to that Wednesday", periodStart(THU, 3), WED);
ok("so does the Tuesday six days later", periodStart(TUE, 3), WED);
ok("the next Wednesday starts a new one", periodStart(NEXT_WED, 3), NEXT_WED);

// --- done-ness, the whole point ---------------------------------------------
const wednesdayCard = { recurrence: "weekly:3", completed_on: WED, done: false };
ok("checked off on the day → done", effectiveDone(wednesdayCard, WED), true);
ok("…still done the next day", effectiveDone(wednesdayCard, THU), true);
ok("…still done on Sunday", effectiveDone(wednesdayCard, SUN), true);
ok("…still done the Tuesday after", effectiveDone(wednesdayCard, TUE), true);
ok("…and reopens itself next Wednesday", effectiveDone(wednesdayCard, NEXT_WED), false);
ok(
  "a late check-off covers the rest of that week",
  effectiveDone({ recurrence: "weekly:3", completed_on: SUN, done: false }, TUE),
  true,
);
ok(
  "never checked → not done",
  effectiveDone({ recurrence: "weekly:3", completed_on: null, done: true }, WED),
  false,
);
ok(
  "a stale `done` flag can't fake it",
  effectiveDone({ recurrence: "weekly:3", completed_on: "2026-07-01", done: true }, WED),
  false,
);
// Daily and non-repeating behaviour is unchanged.
ok(
  "daily is still today-only",
  [
    effectiveDone({ recurrence: "daily", completed_on: WED, done: false }, WED),
    effectiveDone({ recurrence: "daily", completed_on: WED, done: false }, THU),
  ],
  [true, false],
);
ok(
  "a plain card just uses its flag",
  effectiveDone({ recurrence: "none", completed_on: null, done: true }, WED),
  true,
);

ok("resets on the next Wednesday", resetsOn({ kind: "weekly", weekday: 3 }, THU), NEXT_WED);
ok("daily resets tomorrow", resetsOn({ kind: "daily" }, WED), THU);
ok("a plain card never resets", resetsOn({ kind: "none" }, WED), null);

// --- weekly streaks ---------------------------------------------------------
const threeWeeks = new Set([WED, addDays(WED, -7), addDays(WED, -14)]);
ok("three Wednesdays running", weeklyStreak(threeWeeks, WED, 3), 3);
ok("…still three on the Friday after", weeklyStreak(threeWeeks, addDays(WED, 2), 3), 3);
ok(
  "an unfinished week doesn't break the streak yet",
  weeklyStreak(threeWeeks, NEXT_WED, 3),
  3,
);
ok("but a skipped week does", weeklyStreak(threeWeeks, addDays(WED, 14), 3), 0);
ok(
  "any day of the week counts for that week",
  weeklyStreak(new Set([SUN, addDays(WED, -7)]), TUE, 3),
  2,
);
ok("nothing checked, no streak", weeklyStreak(new Set(), WED, 3), 0);
ok("streakFor routes by kind", streakFor(threeWeeks, WED, { kind: "weekly", weekday: 3 }), 3);
ok("streakFor ignores plain cards", streakFor(threeWeeks, WED, { kind: "none" }), 0);

// --- the optimistic checkbox fold ------------------------------------------
ok(
  "unchecking clears this week from the display",
  [...daysWithLiveCheck(threeWeeks, THU, "weekly:3", false, WED)].sort(),
  [addDays(WED, -14), addDays(WED, -7)].sort(),
);
ok(
  "…and re-checking puts it back",
  [...daysWithLiveCheck(threeWeeks, THU, "weekly:3", true, WED)].sort(),
  [...threeWeeks].sort(),
);
ok(
  "daily still folds just today",
  [...daysWithLiveCheck([WED], THU, "daily", true, null)].sort(),
  [WED, THU].sort(),
);

console.log(failures === 0 ? "\nall recurrence tests passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
