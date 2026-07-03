// Run: node lib/demo/seed.test.ts   (plain node, TS types stripped natively)
//
// The seed's contract: items and their fabricated event history must be mutually
// consistent, because the time machine reconstructs the past by reverting events
// FROM the current values — any drift shows up as a corrupted past in the demo.

import { buildSeed } from "./seed.ts";
import { reconstructBoardAt } from "../timetravel.ts";
import type { Item, ItemEvent } from "../types.ts";
import type { ListId } from "../lists.ts";

let failures = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (!cond) {
    failures++;
    console.error(`✗ ${label}${detail ? `\n    ${detail}` : ""}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

const NOW = new Date("2026-07-02T17:30:00.000Z");
const seed = buildSeed(NOW);

// --- determinism -------------------------------------------------------------
const again = buildSeed(NOW);
ok(
  "deterministic for a fixed now",
  JSON.stringify(seed) === JSON.stringify(again),
);

// --- shape -------------------------------------------------------------------
ok("has a real board's worth of items", seed.items.length >= 15);
ok("has weeks of history", seed.events.length >= 40);

const lists = new Set(seed.items.filter((i) => !i.parent_id).map((i) => i.list));
for (const l of ["today", "focus", "waiting", "backlog", "braindump", "note"]) {
  ok(`list "${l}" is populated`, lists.has(l));
}
ok("has sub-cards", seed.items.some((i) => i.parent_id));
ok("has an archived item (time-travel only)", seed.items.some((i) => i.archived === 1));
ok("has a daily recurring task", seed.items.some((i) => i.recurrence === "daily"));

// --- chronology --------------------------------------------------------------
const times = seed.events.map((e) => new Date(e.at).getTime());
ok(
  "events are emitted in chronological order",
  times.every((t, i) => i === 0 || times[i - 1] <= t),
);
ok(
  "no event is in the future",
  times.every((t) => t <= NOW.getTime()),
);
const spanDays = (times[times.length - 1] - times[0]) / 86_400_000;
ok(`history spans ~3 weeks (got ${spanDays.toFixed(1)}d)`, spanDays >= 18);

// --- per-item event-chain consistency -----------------------------------------
for (const it of seed.items) {
  const evs = seed.events.filter((e) => e.item_id === it.id);
  ok(`${it.id}: first event is 'created'`, evs[0]?.type === "created");

  // Replaying new_values forward must land exactly on the item's current values.
  const fin: Record<string, string | null> = {
    text: null,
    details: "",
    list: null,
    done: "false",
    archived: "false",
  };
  // 'created' carries field='text' with the initial text, so one rule covers all.
  for (const e of evs) fin[e.field!] = e.new_value;
  ok(`${it.id}: text chain matches`, fin.text === it.text);
  ok(`${it.id}: details chain matches`, (fin.details ?? "") === it.details);
  ok(
    `${it.id}: done chain matches`,
    (fin.done === "true" ? 1 : 0) === it.done,
    `chain=${fin.done} item=${it.done}`,
  );
  ok(
    `${it.id}: archived chain matches`,
    (fin.archived === "true" ? 1 : 0) === it.archived,
  );
}

// --- reconstruction over the seeded history -----------------------------------
const toItem = (r: (typeof seed.items)[number]): Item => ({
  id: r.id,
  text: r.text,
  details: r.details,
  list: r.list as ListId,
  done: r.done === 1,
  recurrence: r.recurrence,
  completed_on: r.completed_on,
  parent_id: r.parent_id,
  position: r.position,
  archived: r.archived === 1,
  created_at: r.created_at,
  updated_at: r.updated_at,
});
const items = seed.items.map(toItem);
const events: ItemEvent[] = seed.events.map((e, i) => ({ id: i + 1, field: e.field, ...e }));

// At `now`, reconstruction must equal current state exactly (nothing to revert).
const nowBoard = reconstructBoardAt(items, events, NOW.toISOString());
const liveVisible = items.filter((i) => !i.archived);
ok(
  "reconstruction at now == current visible items",
  nowBoard.length === liveVisible.length,
  `reconstructed=${nowBoard.length} live=${liveVisible.length}`,
);
for (const s of nowBoard) {
  const cur = items.find((i) => i.id === s.id)!;
  ok(
    `${s.id}: state at now matches current`,
    s.text === cur.text && s.list === cur.list && s.done === cur.done,
    JSON.stringify({ snap: s, cur }),
  );
}

// Two weeks back, the board existed but was visibly different.
const midT = new Date(NOW.getTime() - 14 * 86_400_000).toISOString();
const midBoard = reconstructBoardAt(items, events, midT);
ok("board 2 weeks ago is non-empty", midBoard.length > 0);
ok(
  "board 2 weeks ago differs from today",
  JSON.stringify(midBoard.map((i) => [i.id, i.list, i.done, i.text]).sort()) !==
    JSON.stringify(nowBoard.map((i) => [i.id, i.list, i.done, i.text]).sort()),
);

// Before the first event, there was nothing.
const preT = new Date(times[0] - 1000).toISOString();
ok("board before first event is empty", reconstructBoardAt(items, events, preT).length === 0);

// The archived item should be VISIBLE in the past (after creation, before archive).
const archived = seed.items.find((i) => i.archived === 1)!;
const archEvent = seed.events.find(
  (e) => e.item_id === archived.id && e.type === "archived",
)!;
const justBefore = new Date(new Date(archEvent.at).getTime() - 60_000).toISOString();
ok(
  "archived item appears when scrubbing before its archival",
  reconstructBoardAt(items, events, justBefore).some((i) => i.id === archived.id),
);
ok(
  "archived item absent from board at now",
  !nowBoard.some((i) => i.id === archived.id),
);

// -------------------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} seed test(s) failed.`);
  process.exit(1);
}
console.log("\nAll demo-seed tests passed.");
