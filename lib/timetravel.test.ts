// Run: node lib/timetravel.test.ts   (Node 26 strips the TS types natively)
import { reconstructItemAt, reconstructBoardAt } from "./timetravel.ts";

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
  id: "i1", text: "draft idea", details: "", list: "braindump", done: false, existed: true, archived: false,
});

// after edit, before move
eq("at T2+2h: edited text, still braindump, not done", reconstructItemAt(item as any, events as any, "2026-06-02T12:00:00.000Z"), {
  id: "i1", text: "real idea", details: "", list: "braindump", done: false, existed: true, archived: false,
});

// after move, before complete
eq("at T3+2h: today, not yet done", reconstructItemAt(item as any, events as any, "2026-06-03T12:00:00.000Z"), {
  id: "i1", text: "real idea", details: "", list: "today", done: false, existed: true, archived: false,
});

// after everything = current
eq("at T4+2h: current state", reconstructItemAt(item as any, events as any, "2026-06-05T00:00:00.000Z"), {
  id: "i1", text: "real idea", details: "", list: "today", done: true, existed: true, archived: false,
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

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll time-travel tests passed.");
