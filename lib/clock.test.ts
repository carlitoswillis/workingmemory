// Run: node lib/clock.test.ts   (plain node script, same convention as the others)
//
// The single "today" (lib/clock.ts): the same answer on server and client, whatever
// zone the process runs in, and the same one the Shortcut route and done-ness use.

import { DEFAULT_BOARD_TZ, boardDayOf, boardTimeZone, boardToday } from "./clock.ts";
import { effectiveDone } from "./recurrence.ts";

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

delete process.env.NEXT_PUBLIC_BOARD_TZ;
ok("default zone", boardTimeZone(), DEFAULT_BOARD_TZ);

// 22:30 PT on Nov 10 = 06:30 UTC on Nov 11 = 01:30 ET on Nov 11.
const lateEvening = new Date("2026-11-11T06:30:00Z");
ok("22:30 PT is still Nov 10 on the board clock (an Eastern or UTC process would say Nov 11)", boardToday(lateEvening), "2026-11-10");
ok("an explicit zone is honoured", boardToday(lateEvening, "America/New_York"), "2026-11-11");
ok("boardDayOf takes ISO strings", boardDayOf("2026-11-11T06:30:00Z"), "2026-11-10");

process.env.NEXT_PUBLIC_BOARD_TZ = "America/New_York";
ok("NEXT_PUBLIC_BOARD_TZ moves the board clock", boardToday(lateEvening), "2026-11-11");
process.env.NEXT_PUBLIC_BOARD_TZ = "Not/AZone";
ok("a bad zone name falls back to the default", boardTimeZone(), DEFAULT_BOARD_TZ);
delete process.env.NEXT_PUBLIC_BOARD_TZ;

// The scenario from the audit: the Shortcut ticks a daily card at 22:30 PT. A client
// computing "today" on the same clock reads it as done (previously an Eastern phone
// computed Nov 11 and showed it undone, then wrote a second completion).
const ticked = { recurrence: "daily", completed_on: boardToday(lateEvening), done: false };
ok("the tick written at 22:30 PT is done on the same clock", effectiveDone(ticked, boardToday(lateEvening)), true);

console.log(failures === 0 ? "\nall clock tests passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
