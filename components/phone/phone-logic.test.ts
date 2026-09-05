// Run: node components/phone/phone-logic.test.ts   (plain node script, same
// convention as lib/*.test.ts and components/collapsibleColumn.test.ts)
//
// Covers the pure logic behind the phone app: the row's completion state machine
// (optimistic flip → 900ms undo window → collapse, plus failure and revalidation),
// the swipe's directional lock and 28px edge guard, the Now screen's Today / Due
// today / Done today derivation (which must go through effectiveDone, never a
// stored boolean), the Lists pager index maths, and reorder position reassignment.

import {
  applyReorder,
  deriveNowSections,
  isMilestone,
  lockAxis,
  localDayOf,
  pageIndexFor,
  pagerLists,
  reassignPositions,
  rowAriaLabel,
  rowHeldInPlace,
  rowInitial,
  rowNext,
  sectionOf,
  swipeIntent,
  withinSwipeZone,
  type NowItem,
  type NowSection,
  type RowState,
} from "./phone-logic.ts";

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

// --- row state machine -------------------------------------------------------

const idle = rowInitial(false);
ok("starts idle at the server's value", idle, { checked: false, phase: "idle", error: null });

const tapped = rowNext(idle, { type: "toggle" });
ok("a tap flips optimistically and opens the undo window", tapped, {
  checked: true,
  phase: "undo",
  error: null,
});
ok("the row stays in its original section during the window", rowHeldInPlace(tapped), true);

ok("undo inside the window puts it back, settled", rowNext(tapped, { type: "undo" }), {
  checked: false,
  phase: "idle",
  error: null,
});
ok("tapping the check again inside the window IS the undo", rowNext(tapped, { type: "toggle" }), {
  checked: false,
  phase: "idle",
  error: null,
});
ok("undo after the window has closed does nothing", rowNext(idle, { type: "undo" }), idle);

const collapsing = rowNext(tapped, { type: "window-elapsed" });
ok("900ms elapsed starts the collapse", collapsing.phase, "collapsing");
ok("still held in place while collapsing", rowHeldInPlace(collapsing), true);
const gone = rowNext(collapsing, { type: "collapsed" });
ok("collapse finished releases the row to its new section", gone, {
  checked: true,
  phase: "gone",
  error: null,
});
ok("released rows are no longer held", rowHeldInPlace(gone), false);
ok("a stray collapsed event outside the collapse is ignored", rowNext(tapped, { type: "collapsed" }), tapped);

ok("a failed write reverts the flip and pins the reason ON THE ROW", rowNext(tapped, { type: "failed", message: "Offline" }), {
  checked: false,
  phase: "error",
  error: "Offline",
});

// Revalidation must never yank a row out from under a finger.
ok("server truth is ignored mid-window", rowNext(tapped, { type: "sync", checked: false }), tapped);
ok("server truth is ignored mid-collapse", rowNext(collapsing, { type: "sync", checked: false }), collapsing);
ok("server truth lands once settled", rowNext(gone, { type: "sync", checked: false }), {
  checked: false,
  phase: "idle",
  error: null,
});
const errored: RowState = { checked: false, phase: "error", error: "Offline" };
ok("a matching sync still clears a pinned error", rowNext(errored, { type: "sync", checked: false }), {
  checked: false,
  phase: "idle",
  error: null,
});
ok("an identical sync is the same object (no re-render)", rowNext(gone, { type: "sync", checked: true }) === gone, true);

// --- milestones + accessible name -------------------------------------------

ok("only 7/30/100 pulse", [1, 6, 7, 8, 30, 99, 100].map(isMilestone), [
  false, false, true, false, true, false, true,
]);
ok(
  "streak is in the accessible name",
  rowAriaLabel("Gym", { checked: false, streak: 12, repeats: true }),
  "Gym, 12 day streak, not done today",
);
ok(
  "no streak, no noise",
  rowAriaLabel("Email Ana", { checked: true, repeats: false }),
  "Email Ana, done today",
);
ok(
  "a zero streak isn't announced",
  rowAriaLabel("Gym", { checked: false, streak: 0, repeats: true }),
  "Gym, not done today",
);

// --- swipe: directional lock -------------------------------------------------

ok("a small move decides nothing", lockAxis(4, 2), "pending");
ok("11px sideways against 2px down claims the gesture", lockAxis(11, 2), "x");
ok("leftward counts the same", lockAxis(-11, 2), "x");
ok("11px against 6px fails the 2x rule but is still inside the decision window", lockAxis(11, 6), "pending");
ok("…and once past 15px of travel the scroller keeps it", lockAxis(14, 9), "y");
ok("mostly-vertical travel goes to the scroller", lockAxis(3, 20), "y");
ok("10px is not yet past the threshold", lockAxis(10, 0), "pending");
ok("a 45° drag never claims the row", lockAxis(12, 12), "y");

ok("a touch 40px in is ours", withinSwipeZone(40, 375), true);
ok("a touch 20px from the left edge belongs to iOS back", withinSwipeZone(20, 375), false);
ok("…and 20px from the right edge too", withinSwipeZone(355, 375), false);
ok("exactly at the inset is allowed", withinSwipeZone(28, 375), true);

ok("a long right swipe completes", swipeIntent(80), "complete");
ok("a long left swipe reveals the actions", swipeIntent(-80), "reveal");
ok("a short swipe springs back", swipeIntent(30), "none");

// --- Now sections ------------------------------------------------------------

const TODAY = "2026-09-04";
function item(over: Partial<NowItem> & { id: string }): NowItem {
  return {
    list: "backlog",
    done: false,
    recurrence: "none",
    completed_on: null,
    parent_id: null,
    archived: false,
    updated_at: `${TODAY}T09:00:00.000Z`,
    ...over,
  };
}

const gym = item({ id: "gym", recurrence: "daily", completed_on: null });
const gymDone = item({ id: "gym", recurrence: "daily", completed_on: TODAY });
ok("an unchecked daily card is due today", sectionOf(gym, TODAY, "today"), "due");
ok("a checked daily card is done today", sectionOf(gymDone, TODAY, "today"), "done");
ok(
  "yesterday's check does not carry over — the card reopens itself",
  sectionOf(item({ id: "gym", recurrence: "daily", completed_on: "2026-09-03" }), TODAY, "today"),
  "due",
);
ok(
  "a weekly card stays done for the rest of its period",
  // 2026-09-04 is a Friday (weekday 5); checked on Wednesday the 2nd, period start Wed.
  sectionOf(
    item({ id: "laundry", recurrence: "weekly:3", completed_on: "2026-09-02" }),
    TODAY,
    "today",
  ),
  "done",
);

ok("a Today-column card is the top section", sectionOf(item({ id: "a", list: "today" }), TODAY, "today"), "today");
ok(
  "a one-off ticked today drops into Done today",
  sectionOf(item({ id: "a", list: "today", done: true }), TODAY, "today"),
  "done",
);
ok(
  "…but one finished on an earlier day is gone from Now",
  sectionOf(
    item({ id: "a", list: "today", done: true, updated_at: "2026-08-30T09:00:00.000Z" }),
    TODAY,
    "today",
  ),
  null,
);
ok("a backlog card is not on Now at all", sectionOf(item({ id: "b" }), TODAY, "today"), null);
ok("a sub-card never surfaces as a row", sectionOf(item({ id: "c", list: "today", parent_id: "a" }), TODAY, "today"), null);
ok("the note sentinel is not a card", sectionOf(item({ id: "n", list: "note" }), TODAY, "today"), null);
ok("the review sentinel is not a card", sectionOf(item({ id: "r", list: "review" }), TODAY, "today"), null);
ok("an archived card is not on Now", sectionOf(item({ id: "z", list: "today", archived: true }), TODAY, "today"), null);
ok(
  "a renamed first column still owns the Today section",
  sectionOf(item({ id: "a", list: "col-abc" }), TODAY, "col-abc"),
  "today",
);

const board = [
  item({ id: "t1", list: "today" }),
  gym,
  item({ id: "t2", list: "today", done: true }),
  item({ id: "b1" }),
];
ok("sections keep the board's order", deriveNowSections(board, { today: TODAY, todayListId: "today" }), {
  today: [board[0]],
  due: [gym],
  done: [board[2]],
});

// A row mid-flip is pinned where it was tapped, so a revalidation arriving inside
// the 900ms undo window can't teleport it into Done today.
const held = new Map<string, NowSection>([["gym", "due"]]);
const afterServer = [item({ id: "t1", list: "today" }), gymDone];
ok(
  "a held row stays in the section it was tapped in",
  deriveNowSections(afterServer, { today: TODAY, todayListId: "today", held }).due.map((i) => i.id),
  ["gym"],
);
ok(
  "…and is not double-counted in Done today",
  deriveNowSections(afterServer, { today: TODAY, todayListId: "today", held }).done,
  [],
);

ok("local day of an ISO stamp", localDayOf("2026-09-04T09:00:00.000Z")?.length, 10);
ok("garbage in, null out", localDayOf("not a date"), null);

// --- Lists pager -------------------------------------------------------------

const lists = [
  { id: "today" },
  { id: "focus" },
  { id: "waiting" },
  { id: "backlog" },
  { id: "braindump" },
  { id: "note" },
  { id: "review" },
];
ok(
  "the pager is every column but Now's, sentinels excluded",
  pagerLists(lists, "today").map((l) => l.id),
  ["focus", "waiting", "backlog", "braindump"],
);

ok("scrolled to the start", pageIndexFor(0, 375, 4), 0);
ok("snapped to page 2", pageIndexFor(750, 375, 4), 2);
ok("mid-swipe rounds to the nearer page", pageIndexFor(700, 375, 4), 2);
ok("never past the last page", pageIndexFor(99999, 375, 4), 3);
ok("never negative (rubber-band overscroll)", pageIndexFor(-40, 375, 4), 0);
ok("an unmeasured track is page 0", pageIndexFor(120, 0, 4), 0);

// --- reorder -----------------------------------------------------------------

const cards = [
  { id: "a", position: 1000 },
  { id: "b", position: 2000 },
  { id: "c", position: 3000 },
];
ok("moving the last card to the top rewrites every slot it passed", reassignPositions(cards, 2, 0, "focus"), [
  { id: "c", list: "focus", position: 1000 },
  { id: "a", list: "focus", position: 2000 },
  { id: "b", list: "focus", position: 3000 },
]);
ok("a no-op move writes nothing", reassignPositions(cards, 1, 1, "focus"), []);
ok("an out-of-range move writes nothing", reassignPositions(cards, 0, 9, "focus"), []);
ok("existing position values are reused, never invented", applyReorder(cards, 0, 2).map((c) => c.position), [
  1000, 2000, 3000,
]);
ok("…in the new order", applyReorder(cards, 0, 2).map((c) => c.id), ["b", "c", "a"]);
ok("uneven spacing survives a reorder", reassignPositions(
  [
    { id: "a", position: 5 },
    { id: "b", position: 900 },
  ],
  0,
  1,
  "focus",
), [
  { id: "b", list: "focus", position: 5 },
  { id: "a", list: "focus", position: 900 },
]);

console.log(failures === 0 ? "\nall phone-logic tests passed" : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
