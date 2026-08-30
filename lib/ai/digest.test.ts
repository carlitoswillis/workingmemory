// Run: node lib/ai/digest.test.ts   (plain node script, same convention as the others)
//
// Covers the weekly-review digest builder (lib/ai/digest.ts): window bounds,
// column-label resolution incl. SOFT-DELETED columns, actor_id → @username
// attribution, sentinel handling (the note gets its own section; the review card
// is excluded entirely), truncation, and determinism. All fixtures — no DB, no
// network, no clock.

import type { Item, ItemEvent } from "../types.ts";
import type { ListDef } from "../lists.ts";
import { buildWeeklyDigest } from "./digest.ts";

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
function has(label: string, haystack: string, needle: string) {
  ok(label, haystack.includes(needle), true);
}
function lacks(label: string, haystack: string, needle: string) {
  ok(label, haystack.includes(needle), false);
}

// --- fixtures ---------------------------------------------------------------
const FROM = "2026-08-23T00:00:00.000Z";
const TO = "2026-08-30T00:00:00.000Z";

function item(over: Partial<Item> & { id: string; text: string; list: string }): Item {
  return {
    details: "",
    done: false,
    recurrence: "none",
    completed_on: null,
    parent_id: null,
    position: 1,
    archived: false,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:00.000Z",
    ...over,
  } as Item;
}

let seq = 0;
function ev(over: Partial<ItemEvent> & { item_id: string; type: string; at: string }): ItemEvent {
  return {
    id: ++seq,
    field: null,
    old_value: null,
    new_value: null,
    actor_id: null,
    ...over,
  } as ItemEvent;
}

const COLUMNS: ListDef[] = [
  { id: "today", label: "Today", hint: "" },
  { id: "waiting", label: "Waiting / Later", hint: "" },
];
// "reading" is soft-deleted: not in COLUMNS, but its label still resolves.
const LABELS = {
  today: "Today",
  waiting: "Waiting / Later",
  reading: "Reading",
};
const MEMBERS = { "u-1": "owner", "u-2": "alex" };

const items: Item[] = [
  item({ id: "a", text: "Fix the sink", list: "today", updated_at: "2026-08-28T10:00:00.000Z" }),
  item({
    id: "b",
    text: "File the taxes",
    list: "waiting",
    updated_at: "2026-07-02T09:00:00.000Z", // untouched long before the window
  }),
  item({
    id: "c",
    text: "Read the Ricard paper",
    list: "today",
    updated_at: "2026-08-26T12:00:00.000Z",
  }),
  item({
    id: "d",
    text: "Morning pages",
    list: "today",
    recurrence: "daily",
    completed_on: "2026-08-29",
    completed_days: ["2026-08-27", "2026-08-28", "2026-08-29"],
    updated_at: "2026-08-29T07:00:00.000Z",
  }),
  item({ id: "n", text: "Daily note", list: "note", details: "buy oat milk\nring mum" }),
  item({ id: "r", text: "Weekly review", list: "review", details: "## Last week\nYou shipped." }),
  item({
    id: "old",
    text: "Something ancient",
    list: "today",
    updated_at: "2026-08-01T00:00:00.000Z",
  }),
];

const events: ItemEvent[] = [
  // BEFORE the window — must not appear.
  ev({ item_id: "a", type: "created", field: "text", new_value: "Fix the sink", at: "2026-08-20T09:00:00.000Z" }),
  ev({ item_id: "old", type: "edited", field: "text", old_value: "Older name", new_value: "Something ancient", at: "2026-08-01T00:00:00.000Z" }),
  // IN the window.
  ev({
    item_id: "a",
    type: "moved",
    field: "list",
    old_value: "reading", // a since-DELETED column
    new_value: "today",
    actor_id: "u-2",
    at: "2026-08-26T09:00:00.000Z",
  }),
  ev({ item_id: "a", type: "completed", field: "done", old_value: "false", new_value: "true", actor_id: "u-1", at: "2026-08-28T10:00:00.000Z" }),
  ev({ item_id: "c", type: "created", field: "text", new_value: "Read the Ricard paper", actor_id: "u-1", at: "2026-08-26T12:00:00.000Z" }),
  ev({ item_id: "d", type: "completed", field: "completed_on", new_value: "2026-08-29", actor_id: "u-1", at: "2026-08-29T07:00:00.000Z" }),
  ev({ item_id: "n", type: "edited", field: "details", old_value: "", new_value: "buy oat milk\nring mum", actor_id: "u-1", at: "2026-08-27T08:00:00.000Z" }),
  ev({ item_id: "r", type: "edited", field: "details", old_value: "", new_value: "## Last week\nYou shipped.", actor_id: "u-1", at: "2026-08-24T06:00:00.000Z" }),
  // AT the exclusive upper bound — must not appear (half-open window).
  ev({ item_id: "b", type: "moved", field: "list", old_value: "today", new_value: "waiting", at: TO }),
];

const shared = buildWeeklyDigest(
  { items, events, columns: COLUMNS, listLabels: LABELS, members: MEMBERS, boardName: "Home" },
  FROM,
  TO,
  { today: "2026-08-29" },
);

// --- window bounds ----------------------------------------------------------
has("names the window", shared, `Window: ${FROM} → ${TO} (7 days)`);
has("names the board", shared, "board: Home");
lacks("drops events before the window", shared, "Older name");
lacks("upper bound is exclusive", shared, "File the taxes\" [Waiting");
ok(
  "counts only in-window card events",
  /ACTIVITY IN WINDOW \((\d+) logged card changes\)/.exec(shared)?.[1],
  // 4: a's move + a's completion + c's creation + d's check-off. Both sentinels
  // drop out (the note has its own section, the review must not summarize
  // itself), and so does b's move — it lands exactly on the exclusive end.
  "4",
);

// --- column labels ----------------------------------------------------------
has("resolves live column labels", shared, "→ Today");
has("resolves a soft-deleted column's label", shared, "moved Reading (removed column) → Today");
has("lists the live board by column", shared, "- Waiting / Later [1]: File the taxes");

// --- attribution ------------------------------------------------------------
has("names the actor who moved a card", shared, "moved Reading (removed column) → Today by @alex");
has("names the actor who completed a card", shared, "completed by @owner");
has("lists the members", shared, "Board members: @alex, @owner");

// --- sentinels --------------------------------------------------------------
has("the daily note gets its own section", shared, "DAILY NOTE");
has("the note body is quoted", shared, "buy oat milk");
lacks("the review's own text never re-enters the digest", shared, "You shipped.");
lacks("the review card is not a board card", shared, "- Weekly review [");
has("the exclusion is stated", shared, "deliberately excluded");

// --- repeating + stuck ------------------------------------------------------
has("repeating tasks report check-offs", shared, "checked 3 times in window");
has("repeating tasks report the streak", shared, "current streak 3");
has("untouched cards are surfaced", shared, "UNTOUCHED THROUGH THE WHOLE WINDOW");
has("untouched cards carry their age", shared, '"File the taxes" in Waiting / Later');
has("new captures are listed", shared, '- "Read the Ricard paper" → Today');

// Without completed_days attached (what getTimelineData returns), the streak is
// replayed from the completed_on events instead.
const raw = buildWeeklyDigest(
  {
    items: items.map((i) => (i.id === "d" ? { ...i, completed_days: undefined } : i)),
    events: [
      ...events,
      ev({ item_id: "d", type: "completed", field: "completed_on", new_value: "2026-08-27", at: "2026-08-27T07:00:00.000Z" }),
      ev({ item_id: "d", type: "completed", field: "completed_on", new_value: "2026-08-28", at: "2026-08-28T07:00:00.000Z" }),
    ],
    columns: COLUMNS,
    listLabels: LABELS,
  },
  FROM,
  TO,
  { today: "2026-08-29" },
);
has("streaks replay from events when completed_days is absent", raw, "current streak 3");

// --- personal board (no members) -------------------------------------------
const personal = buildWeeklyDigest(
  {
    items,
    events: events.map((e) => ({ ...e, actor_id: null })),
    columns: COLUMNS,
    listLabels: LABELS,
  },
  FROM,
  TO,
  { today: "2026-08-29" },
);
has("a personal board reads in the second person", personal, "completed by you");
has("a personal board says so up top", personal, 'Board members: just the one person');
lacks("no @handles on a personal board", personal, "@owner");
has("an unnamed board is labelled", personal, "board: (personal board)");

// --- an unknown actor -------------------------------------------------------
const departed = buildWeeklyDigest(
  { items, events, columns: COLUMNS, listLabels: LABELS, members: { "u-1": "owner" } },
  FROM,
  TO,
  { today: "2026-08-29" },
);
has("an actor with no membership row degrades gracefully", departed, "by a former member");

// --- truncation -------------------------------------------------------------
const many: Item[] = [];
const manyEvents: ItemEvent[] = [];
for (let i = 0; i < 12; i++) {
  const id = `m${i}`;
  many.push(item({ id, text: `Card ${i}`, list: "today" }));
  manyEvents.push(
    ev({
      item_id: id,
      type: "created",
      field: "text",
      new_value: `Card ${i}`,
      // Card 0 oldest … card 11 newest.
      at: `2026-08-2${4 + Math.floor(i / 6)}T0${i % 6}:00:00.000Z`,
    }),
  );
}
const truncated = buildWeeklyDigest(
  { items: many, events: manyEvents, columns: COLUMNS, listLabels: LABELS },
  FROM,
  TO,
  { maxTimelines: 5, today: "2026-08-29" },
);
has("truncation is announced", truncated, "7 further cards changed in this window");
has("keeps the most recent activity", truncated, '"Card 11"');
lacks("drops the oldest activity first", truncated, '* "Card 0"');

// --- determinism ------------------------------------------------------------
const again = buildWeeklyDigest(
  { items, events, columns: COLUMNS, listLabels: LABELS, members: MEMBERS, boardName: "Home" },
  FROM,
  TO,
  { today: "2026-08-29" },
);
ok("the same inputs give byte-identical output", again === shared, true);

// --- an empty window --------------------------------------------------------
const quiet = buildWeeklyDigest(
  { items, events: [], columns: COLUMNS, listLabels: LABELS },
  FROM,
  TO,
  { today: "2026-08-29" },
);
has("a quiet window says so", quiet, "(no card activity in this window)");
has("a quiet window still shows the board", quiet, "BOARD NOW");

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall digest tests passed");
