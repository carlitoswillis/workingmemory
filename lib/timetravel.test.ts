// Run: node lib/timetravel.test.ts   (Node 26 strips the TS types natively)
import {
  reconstructItemAt,
  reconstructBoardAt,
  diffBoardSince,
  diffKindPhrase,
  nothingChangedPhrase,
  subCountPhrases,
  DIFF_KINDS,
} from "./timetravel.ts";

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

const T0 = "2026-06-01T10:00:00.000Z"; // created
const T2 = "2026-06-02T10:00:00.000Z"; // text edited
const T3 = "2026-06-03T10:00:00.000Z"; // moved list
const T4 = "2026-06-04T10:00:00.000Z"; // completed

// current state of the item, after all four events
const item = {
  id: "i1",
  user_id: "u1",
  text: "real idea",
  details: "",
  list: "today",
  done: true,
  position: 0,
  archived: false,
  created_at: T0,
  updated_at: T4,
};

const events = [
  { id: 1, item_id: "i1", user_id: "u1", type: "created", field: "text", old_value: null, new_value: "draft idea", at: T0 },
  { id: 2, item_id: "i1", user_id: "u1", type: "edited", field: "text", old_value: "draft idea", new_value: "real idea", at: T2 },
  { id: 3, item_id: "i1", user_id: "u1", type: "moved", field: "list", old_value: "braindump", new_value: "today", at: T3 },
  { id: 4, item_id: "i1", user_id: "u1", type: "completed", field: "done", old_value: "false", new_value: "true", at: T4 },
];

// just after create, before any edit
eq("at T0+2h: original text, original list, not done", reconstructItemAt(item as any, events as any, "2026-06-01T12:00:00.000Z"), {
  id: "i1", text: "draft idea", details: "", list: "braindump", done: false, parent_id: null, existed: true, archived: false,
});

// after edit, before move
eq("at T2+2h: edited text, still braindump, not done", reconstructItemAt(item as any, events as any, "2026-06-02T12:00:00.000Z"), {
  id: "i1", text: "real idea", details: "", list: "braindump", done: false, parent_id: null, existed: true, archived: false,
});

// after move, before complete
eq("at T3+2h: today, not yet done", reconstructItemAt(item as any, events as any, "2026-06-03T12:00:00.000Z"), {
  id: "i1", text: "real idea", details: "", list: "today", done: false, parent_id: null, existed: true, archived: false,
});

// after everything = current
eq("at T4+2h: current state", reconstructItemAt(item as any, events as any, "2026-06-05T00:00:00.000Z"), {
  id: "i1", text: "real idea", details: "", list: "today", done: true, parent_id: null, existed: true, archived: false,
});

// --- details are time-traveled too ---
const item3 = { id: "i3", user_id: "u1", text: "task", details: "note B", list: "today", done: false, position: 0, archived: false, created_at: T0, updated_at: T3 };
const events3 = [
  { id: 7, item_id: "i3", user_id: "u1", type: "created", field: "text", old_value: null, new_value: "task", at: T0 },
  { id: 8, item_id: "i3", user_id: "u1", type: "edited", field: "details", old_value: "note A", new_value: "note B", at: T3 },
];
eq("details before edit: note A", reconstructItemAt(item3 as any, events3 as any, "2026-06-02T00:00:00.000Z").details, "note A");
eq("details after edit: note B", reconstructItemAt(item3 as any, events3 as any, "2026-06-05T00:00:00.000Z").details, "note B");

// before it existed
eq("before creation: existed=false", reconstructItemAt(item as any, events as any, "2026-05-30T00:00:00.000Z").existed, false);

// --- board-level: an item archived later should still appear before its archive ---
const item2 = { id: "i2", user_id: "u1", text: "old todo", list: "today", done: false, position: 0, archived: true, created_at: T0, updated_at: T4 };
const events2 = [
  { id: 5, item_id: "i2", user_id: "u1", type: "created", field: "text", old_value: null, new_value: "old todo", at: T0 },
  { id: 6, item_id: "i2", user_id: "u1", type: "archived", field: "archived", old_value: "false", new_value: "true", at: T4 },
];

const boardBeforeArchive = reconstructBoardAt([item2 as any], events2 as any, "2026-06-02T00:00:00.000Z");
eq("board before archive: item present", boardBeforeArchive.map((b) => b.id), ["i2"]);

const boardAfterArchive = reconstructBoardAt([item2 as any], events2 as any, "2026-06-05T00:00:00.000Z");
eq("board after archive: item gone", boardAfterArchive.map((b) => b.id), []);

// timestamp-format robustness: Postgres-style "+00:00" offset vs "Z"
eq("mixed tz formats compare correctly", reconstructItemAt(
  item as any,
  [{ id: 2, item_id: "i1", user_id: "u1", type: "edited", field: "text", old_value: "draft idea", new_value: "real idea", at: "2026-06-02T10:00:00.123456+00:00" }] as any,
  "2026-06-02T09:00:00.000Z",
).text, "draft idea");


// ===========================================================================
// "What changed" — the diff ledger between a scrubbed moment T and now.
// ===========================================================================

const D = {
  beforeT: "2026-06-05T12:00:00.000Z", // well before the window opens
  T: "2026-06-08T12:00:00.000Z", // the scrubbed moment
  inside: "2026-06-09T12:00:00.000Z", // a change inside the window
  later: "2026-06-10T12:00:00.000Z", // a later change inside the window
  NOW: "2026-06-11T12:00:00.000Z",
};

// The same local-calendar-date convention lib/timetravel.ts and lib/recurrence.ts
// use, so the repeating-card cases read the same in every timezone the tests run in.
const localDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayT = localDate(D.T);
const dayNow = localDate(D.NOW);

const LABELS = { today: "Today", focus: "Focus", backlog: "Backlog" };
const OPTS = { listLabels: LABELS, today: dayNow };

function card(o: Record<string, unknown>) {
  return {
    user_id: "u1",
    text: "a card",
    details: "",
    list: "today",
    done: false,
    recurrence: "none",
    completed_on: null,
    parent_id: null,
    linked_board_id: null,
    converted_from: null,
    position: 0,
    archived: false,
    created_at: D.beforeT,
    updated_at: D.beforeT,
    ...o,
  } as any;
}

let evSeq = 1000;
function ev(
  item_id: string,
  type: string,
  field: string | null,
  old_value: string | null,
  new_value: string | null,
  at: string,
) {
  return { id: evSeq++, item_id, type, field, old_value, new_value, actor_id: null, at } as any;
}
const born = (id: string, text: string, at: string) => ev(id, "created", "text", null, text, at);

// The ledger as a person reads it: "<title> — <phrase>", one line per card.
const lines = (items: any[], events: any[], t = D.T, opts = OPTS) =>
  diffBoardSince(items, events, t, D.NOW, opts).entries.map((e) => `${e.title} — ${e.phrase}`);

// --- added -----------------------------------------------------------------
eq(
  "added: a card born inside the window",
  lines(
    [card({ id: "n1", text: "book the ferry", created_at: D.inside })],
    [born("n1", "book the ferry", D.inside)],
  ),
  ["book the ferry — added"],
);

eq(
  "added + done: born inside the window and finished (the edits on the way are not news)",
  lines(
    [card({ id: "n2", text: "call the vet", done: true, list: "today", created_at: D.inside })],
    [
      born("n2", "vet", D.inside),
      ev("n2", "edited", "text", "vet", "call the vet", D.inside),
      ev("n2", "moved", "list", "backlog", "today", D.later),
      ev("n2", "completed", "done", "false", "true", D.later),
    ],
  ),
  ["call the vet — added, done"],
);

eq(
  "added + archived: it lived and died inside the window",
  lines(
    [card({ id: "n3", text: "false start", archived: true, created_at: D.inside })],
    [born("n3", "false start", D.inside), ev("n3", "archived", "archived", "false", "true", D.later)],
  ),
  ["false start — added, archived"],
);

// --- done / reopened -------------------------------------------------------
eq(
  "done: completed inside the window",
  lines(
    [card({ id: "d1", text: "pay the bill", done: true })],
    [born("d1", "pay the bill", D.beforeT), ev("d1", "completed", "done", "false", "true", D.inside)],
  ),
  ["pay the bill — done"],
);

eq(
  "reopened: unchecked inside the window",
  lines(
    [card({ id: "d2", text: "draft the reply", done: false })],
    [born("d2", "draft the reply", D.beforeT), ev("d2", "reopened", "done", "true", "false", D.inside)],
  ),
  ["draft the reply — reopened"],
);

eq(
  "done and undone inside the window is not a change",
  lines(
    [card({ id: "d3", text: "wobble", done: false })],
    [
      born("d3", "wobble", D.beforeT),
      ev("d3", "completed", "done", "false", "true", D.inside),
      ev("d3", "reopened", "done", "true", "false", D.later),
    ],
  ),
  [],
);

// --- archived / restored ---------------------------------------------------
eq(
  "archived: and it keeps the name it had when it went",
  lines(
    [card({ id: "a1", text: "renamed after the fact", archived: true })],
    [
      born("a1", "old plan", D.beforeT),
      ev("a1", "archived", "archived", "false", "true", D.inside),
      ev("a1", "edited", "text", "old plan", "renamed after the fact", D.later),
    ],
  ),
  ["old plan — archived"],
);

eq(
  "restored: pulled back out of the archive",
  lines(
    [card({ id: "a2", text: "second wind", archived: false })],
    [born("a2", "second wind", D.beforeT), ev("a2", "reopened", "archived", "true", "false", D.inside)],
  ),
  ["second wind — restored"],
);

eq(
  "archived at both ends is ignored",
  lines(
    [card({ id: "a3", text: "long gone", archived: true })],
    [born("a3", "long gone", D.beforeT), ev("a3", "archived", "archived", "false", "true", D.beforeT)],
  ),
  [],
);

// --- moved, reworded, details, nesting ------------------------------------
eq(
  "moved: with column labels, not ids",
  lines(
    [card({ id: "m1", text: "ship the draft", list: "today" })],
    [born("m1", "ship the draft", D.beforeT), ev("m1", "moved", "list", "focus", "today", D.inside)],
  ),
  ["ship the draft — moved from Focus to Today"],
);

eq(
  "moved and moved back is not a change",
  lines(
    [card({ id: "m2", text: "round trip", list: "focus" })],
    [
      born("m2", "round trip", D.beforeT),
      ev("m2", "moved", "list", "focus", "today", D.inside),
      ev("m2", "moved", "list", "today", "focus", D.later),
    ],
  ),
  [],
);

eq(
  "reworded once, however many times it was edited",
  lines(
    [card({ id: "r1", text: "final wording" })],
    [
      born("r1", "first wording", D.beforeT),
      ev("r1", "edited", "text", "first wording", "second wording", D.inside),
      ev("r1", "edited", "text", "second wording", "third wording", D.inside),
      ev("r1", "edited", "text", "third wording", "final wording", D.later),
    ],
  ),
  ["final wording — reworded"],
);

eq(
  "made and undone: three edits back to the original word is no entry at all",
  lines(
    [card({ id: "r2", text: "original" })],
    [
      born("r2", "original", D.beforeT),
      ev("r2", "edited", "text", "original", "other", D.inside),
      ev("r2", "edited", "text", "other", "another", D.inside),
      ev("r2", "edited", "text", "another", "original", D.later),
    ],
  ),
  [],
);

eq(
  "details edited",
  lines(
    [card({ id: "r3", text: "recipe", details: "with the new step" })],
    [born("r3", "recipe", D.beforeT), ev("r3", "edited", "details", "", "with the new step", D.inside)],
  ),
  ["recipe — details edited"],
);

eq(
  "nested / un-nested name the parent",
  lines(
    [
      card({ id: "p1", text: "Trip" }),
      card({ id: "c1", text: "book the train", parent_id: "p1" }),
      card({ id: "c2", text: "pulled back out", parent_id: null }),
    ],
    [
      born("p1", "Trip", D.beforeT),
      born("c1", "book the train", D.beforeT),
      ev("c1", "moved", "parent", null, "p1", D.inside),
      born("c2", "pulled back out", D.beforeT),
      ev("c2", "moved", "parent", "p1", null, D.inside),
    ],
  ),
  // Both cards changed parent inside the window, so both keep their own line —
  // rolling either up would swallow the very fact it carries.
  [
    'book the train — nested under "Trip"',
    'pulled back out — un-nested out of "Trip"',
  ],
);

eq(
  "a card nested inside the window is not counted as its new parent's sub-card",
  lines(
    [
      card({ id: "np", text: "Move house", list: "focus" }),
      card({ id: "nc", text: "boxes", parent_id: "np", done: true }),
    ],
    [
      born("np", "Move house", D.beforeT),
      born("nc", "boxes", D.beforeT),
      ev("nc", "moved", "parent", null, "np", D.inside),
      ev("nc", "completed", "done", "false", "true", D.later),
    ],
  ),
  // It was a board card at T: the ledger says what happened TO IT, and the parent
  // gets no "1 sub-card done" for a card that only just arrived under it.
  ['boxes — done, nested under "Move house"'],
);

eq(
  "the nested kind reaches the counts",
  diffBoardSince(
    [
      card({ id: "np2", text: "Move house", list: "focus" }),
      card({ id: "nc2", text: "boxes", parent_id: "np2" }),
    ],
    [
      born("np2", "Move house", D.beforeT),
      born("nc2", "boxes", D.beforeT),
      ev("nc2", "moved", "parent", null, "np2", D.inside),
    ],
    D.T,
    D.NOW,
    OPTS,
  ).summary,
  [{ kind: "nested", count: 1, phrase: "1 nested" }],
);

eq(
  "a sub-card re-parented from one card to another says where it went",
  lines(
    [
      card({ id: "ra", text: "Old home" }),
      card({ id: "rb", text: "New home" }),
      card({ id: "rc", text: "the drill", parent_id: "rb" }),
    ],
    [
      born("ra", "Old home", D.beforeT),
      born("rb", "New home", D.beforeT),
      born("rc", "the drill", D.beforeT),
      ev("rc", "moved", "parent", "ra", "rb", D.inside),
    ],
  ),
  ['the drill — nested under "New home"'],
);

// --- sub-cards nested more than one level deep -----------------------------
eq(
  "a grandchild rolls up to the board card, not to a parent that has no line",
  lines(
    [
      card({ id: "g1", text: "Move house", list: "focus" }),
      card({ id: "g2", text: "Packing", parent_id: "g1" }),
      card({ id: "g3", text: "boxes", parent_id: "g2", done: true }),
    ],
    [
      born("g1", "Move house", D.beforeT),
      born("g2", "Packing", D.beforeT),
      born("g3", "boxes", D.beforeT),
      ev("g3", "completed", "done", "false", "true", D.inside),
    ],
  ),
  ["Move house — 1 sub-card done"],
);

const deepItems = [
  card({ id: "h1", text: "Move house", list: "focus" }),
  card({ id: "h2", text: "Packing", parent_id: "h1", done: true }),
  card({ id: "h3", text: "boxes", parent_id: "h2", done: true }),
];
const deepEvents = [
  born("h1", "Move house", D.beforeT),
  born("h2", "Packing", D.beforeT),
  born("h3", "boxes", D.beforeT),
  ev("h2", "completed", "done", "false", "true", D.later),
  ev("h3", "completed", "done", "false", "true", D.inside),
];

eq(
  "both depths count on the board card's line",
  lines(deepItems, deepEvents),
  ["Move house — 2 sub-cards done"],
);

eq(
  "and the summary counts them as the two cards they are",
  diffBoardSince(deepItems, deepEvents, D.T, D.NOW, OPTS).summary,
  [{ kind: "done", count: 2, phrase: "2 done" }],
);

eq(
  "a grandchild whose whole branch hangs off a ghost is ignored",
  lines(
    [
      card({ id: "k2", text: "Packing", parent_id: "ghost" }),
      card({ id: "k3", text: "boxes", parent_id: "k2", done: true }),
    ],
    [
      born("k2", "Packing", D.beforeT),
      born("k3", "boxes", D.beforeT),
      ev("k3", "completed", "done", "false", "true", D.inside),
    ],
  ),
  [],
);

// --- sub-cards roll up -----------------------------------------------------
const rollupItems = [
  card({ id: "P", text: "Move house", list: "focus" }),
  card({ id: "s1", text: "boxes", parent_id: "P", done: true }),
  card({ id: "s2", text: "van", parent_id: "P", done: true }),
  card({ id: "s3", text: "keys", parent_id: "P", created_at: D.later }),
  card({ id: "s4", text: "reworded only", parent_id: "P" }),
];
const rollupEvents = [
  born("P", "Move house", D.beforeT),
  born("s1", "boxes", D.beforeT),
  ev("s1", "completed", "done", "false", "true", D.inside),
  born("s2", "van", D.beforeT),
  ev("s2", "completed", "done", "false", "true", D.later),
  born("s3", "keys", D.later),
  born("s4", "old name", D.beforeT),
  ev("s4", "edited", "text", "old name", "reworded only", D.inside),
];

eq(
  "sub-cards roll up into one parent line",
  lines(rollupItems, rollupEvents),
  ["Move house — 1 sub-card added, 2 sub-cards done"],
);

eq(
  "the roll-up counts, on the parent entry",
  diffBoardSince(rollupItems, rollupEvents, D.T, D.NOW, OPTS).entries[0].subCounts,
  { done: 2, added: 1, archived: 0 },
);

eq(
  "the summary counts rolled-up sub-cards as the cards they are",
  diffBoardSince(rollupItems, rollupEvents, D.T, D.NOW, OPTS).summary,
  [
    { kind: "added", count: 1, phrase: "1 added" },
    { kind: "done", count: 2, phrase: "2 done" },
  ],
);

eq(
  "a parent that changed too gets both its own phrase and the counts",
  lines(
    [
      card({ id: "P2", text: "Move house", list: "today" }),
      card({ id: "q1", text: "boxes", parent_id: "P2", done: true }),
    ],
    [
      born("P2", "Move house", D.beforeT),
      ev("P2", "moved", "list", "focus", "today", D.inside),
      born("q1", "boxes", D.beforeT),
      ev("q1", "completed", "done", "false", "true", D.later),
    ],
  ),
  ["Move house — moved from Focus to Today, 1 sub-card done"],
);

eq(
  "a sub-card whose parent isn't on the board is ignored",
  lines(
    [card({ id: "orphan", text: "under a ghost", parent_id: "ghost", done: true })],
    [born("orphan", "under a ghost", D.beforeT), ev("orphan", "completed", "done", "false", "true", D.inside)],
  ),
  [],
);

// --- repeating cards -------------------------------------------------------
eq(
  "a repeating card ticked inside the window (and not done at T) reads done",
  lines(
    [card({ id: "rep1", text: "vitamins", recurrence: "daily", completed_on: dayNow, done: true })],
    [
      born("rep1", "vitamins", D.beforeT),
      ev("rep1", "completed", "completed_on", null, dayNow, D.later),
    ],
  ),
  ["vitamins — done"],
);

eq(
  "a repeating card ticked every day is not a change — done then, done now",
  lines(
    [card({ id: "rep2", text: "stretch", recurrence: "daily", completed_on: dayNow, done: true })],
    [
      born("rep2", "stretch", D.beforeT),
      ev("rep2", "completed", "completed_on", null, dayT, D.beforeT),
      ev("rep2", "completed", "completed_on", dayT, dayNow, D.later),
    ],
  ),
  [],
);

eq(
  "a repeating card that merely rolled into a new day was not reopened",
  lines(
    [card({ id: "rep3", text: "stretch", recurrence: "daily", completed_on: dayT, done: true })],
    [born("rep3", "stretch", D.beforeT), ev("rep3", "completed", "completed_on", null, dayT, D.beforeT)],
  ),
  [],
);

eq(
  "a repeating card actually un-checked inside the window reads reopened",
  lines(
    [card({ id: "rep4", text: "stretch", recurrence: "daily", completed_on: null, done: false })],
    [
      born("rep4", "stretch", D.beforeT),
      ev("rep4", "completed", "completed_on", null, dayT, D.beforeT),
      ev("rep4", "reopened", "completed_on", dayT, null, D.inside),
    ],
  ),
  // done at T (checked off for T's own day), not done now, and completed_on moved.
  ["stretch — reopened"],
);

// --- several kinds on one line, and the order the ledger reads in ----------
eq(
  "one card can carry several kinds, comma-joined in kind order",
  lines(
    [card({ id: "many", text: "new wording", list: "today", done: true })],
    [
      born("many", "old wording", D.beforeT),
      ev("many", "moved", "list", "focus", "today", D.inside),
      ev("many", "edited", "text", "old wording", "new wording", D.inside),
      ev("many", "completed", "done", "false", "true", D.later),
    ],
  ),
  ["new wording — done, moved from Focus to Today, reworded"],
);

eq(
  "entries are grouped by kind, in the ledger's order",
  lines(
    [
      card({ id: "o1", text: "moved one", list: "today" }),
      card({ id: "o2", text: "archived one", archived: true }),
      card({ id: "o3", text: "added one", created_at: D.inside }),
      card({ id: "o4", text: "done one", done: true }),
    ],
    [
      born("o1", "moved one", D.beforeT),
      ev("o1", "moved", "list", "backlog", "today", D.inside),
      born("o2", "archived one", D.beforeT),
      ev("o2", "archived", "archived", "false", "true", D.inside),
      born("o3", "added one", D.inside),
      born("o4", "done one", D.beforeT),
      ev("o4", "completed", "done", "false", "true", D.inside),
    ],
  ),
  [
    "added one — added",
    "done one — done",
    "archived one — archived",
    "moved one — moved from Backlog to Today",
  ],
);

// --- an empty window -------------------------------------------------------
const quiet = diffBoardSince(
  [card({ id: "z1", text: "untouched" })],
  [born("z1", "untouched", D.beforeT)],
  D.T,
  D.NOW,
  OPTS,
);
eq("empty window: no entries", quiet.entries, []);
eq("empty window: no summary", quiet.summary, []);
eq("empty window: every count is zero", Object.values(quiet.counts).every((n) => n === 0), true);
eq(
  "empty window: the ledger's own line",
  nothingChangedPhrase("Tue, Jun 9, 3:00 PM"),
  "Nothing changed since Tue, Jun 9, 3:00 PM.",
);

// --- the exported wording the view leans on --------------------------------
eq("kind order is the ledger's order", DIFF_KINDS.slice(0, 5), [
  "added",
  "done",
  "reopened",
  "archived",
  "restored",
]);
eq("a kind's phrase, with and without its detail", [
  diffKindPhrase("done"),
  diffKindPhrase("moved", "from Focus to Today"),
  diffKindPhrase("unnested", 'out of "Trip"'),
], ["done", "moved from Focus to Today", 'un-nested out of "Trip"']);
eq("sub-card counts read as sentences", subCountPhrases({ done: 1, added: 0, archived: 3 }), [
  "1 sub-card done",
  "3 sub-cards archived",
]);

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll time-travel tests passed.");
