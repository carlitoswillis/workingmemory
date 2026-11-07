// Build a fresh, realistic staging DB for PUBLIC-SAFE screenshots (README +
// portfolio site). Content is entirely fictional — no real card titles from the
// owner's own board. See scripts/dev/seed-phone-demo.ts, which this mirrors
// structurally but MUST NOT be reused directly for public captures.
//
//   DATA_DIR=<dir> npx tsx scripts/dev/seed-public-demo.ts
//
// Same pattern as seed-phone-demo.ts: CREATE_TABLES, bulk-insert items +
// item_events directly (so fabricated history is exactly what triggers would
// have produced, without a spurious "created" event clobbering it), THEN
// attach CREATE_TRIGGERS — so any later, LIVE interaction (tapping a checkbox
// during the capture pass) is journaled normally.
//
// One account ("demo"), one board ("Personal"), the default column set,
// content shaped to match app/BoardScreen.tsx + components/phone/*: recurring
// "Today" cards with varied streaks (lib/streaks.ts), Focus/Waiting/Backlog/Brain
// Dump cards at different ages, one card with 3 sub-cards, a couple of past
// list moves (for the time machine to show something), a pinned Note and a
// pinned weekly Review (the `note` / `review` sentinel lists — lib/lists.ts).
//
// Idempotent: wipes and rebuilds the DB file every run.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { CREATE_TABLES, CREATE_TRIGGERS, migrateDb } from "../../lib/schema.ts";
import { createUser } from "../../lib/users.ts";
import { ensureLists } from "../../lib/columns.ts";
import { NOTE_LIST, REVIEW_LIST } from "../../lib/lists.ts";

const DATA_DIR =
  process.env.DATA_DIR ??
  "/private/tmp/claude-501/-Users-carlitoswillis-workspace/d0c88bad-af13-4089-a699-c66f45e77acf/scratchpad/public-demo";

const USERNAME = "demo";
const PASSWORD = "public-demo-pass-2026"; // dev-only seed DB; never a real credential

const dbFile = path.join(DATA_DIR, "owner", "wm.db");

// ---------------------------------------------------------------------------
// Time helpers (local calendar, same convention as lib/demo/seed.ts).

const NOW = new Date();
const TODAY_WEEKDAY = NOW.getDay(); // 0=Sun..6=Sat, for the weekly recurring card

function ymd(daysAgo: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// `daysAgo` days before now, at a given local hh:mm. Seconds derived (not random)
// so re-runs of this script produce the same shape of history.
function at(daysAgo: number, hh: number, mm: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hh, mm, (daysAgo * 17 + hh * 7 + mm) % 60, 0);
  return d.toISOString();
}

// A moment `hours` (and optional minutes) before right now — for "earlier today".
function ago(hours: number, minutes = 0): string {
  return new Date(NOW.getTime() - (hours * 60 + minutes) * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// Fresh DB.

fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(CREATE_TABLES);
migrateDb(db);

// ---- account + board (mirrors lib/db.ts#bootstrapBoards, one board, known id) ----

const created = createUser(db, USERNAME, PASSWORD);
if ("error" in created) throw new Error(`createUser: ${created.error}`);
const userId = created.id;

const boardId = randomUUID();
db.prepare("insert into boards (id, name, created_by) values (?, 'Personal', ?)").run(
  boardId,
  userId,
);
db.prepare("insert into board_members (board_id, user_id, role) values (?, ?, 'owner')").run(
  boardId,
  userId,
);

// Default columns (today / focus / waiting / backlog / braindump) — the same
// pure helper BoardScreen.tsx calls on first render.
ensureLists(db, boardId);

// ---------------------------------------------------------------------------
// Items + events, built directly (see file header) rather than replayed through
// a step script — every card here is a straight creation, at most one details
// edit, sometimes one past list move, and (for recurring cards) a run of
// completed_on check-offs.

type ItemRow = {
  id: string;
  text: string;
  list: string;
  done: 0 | 1;
  position: number;
  archived: 0 | 1;
  details: string;
  recurrence: string;
  completed_on: string | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  item_id: string;
  type: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  at: string;
};

const items: ItemRow[] = [];
const events: EventRow[] = [];
const itemsById = new Map<string, ItemRow>();

const posCounters = new Map<string, number>();
function nextPosition(list: string): number {
  const n = (posCounters.get(list) ?? 0) + 1000;
  posCounters.set(list, n);
  return n;
}

function pushCreated(id: string, text: string, createdAt: string) {
  events.push({ item_id: id, type: "created", field: "text", old_value: null, new_value: text, at: createdAt });
}

// A plain (non-recurring) card. `detailsAt`, if given, journals one details edit
// shortly after creation (the app's own "captured, then filled in" shape).
function card(opts: {
  text: string;
  list: string;
  createdAt: string;
  details?: string;
  detailsAt?: string;
  parentId?: string | null;
}): string {
  const id = randomUUID();
  const details = opts.details ?? "";
  const row: ItemRow = {
    id,
    text: opts.text,
    list: opts.list,
    done: 0,
    position: nextPosition(opts.list + (opts.parentId ? `:${opts.parentId}` : "")),
    archived: 0,
    details,
    recurrence: "none",
    completed_on: null,
    parent_id: opts.parentId ?? null,
    created_at: opts.createdAt,
    updated_at: opts.detailsAt ?? opts.createdAt,
  };
  items.push(row);
  itemsById.set(id, row);
  pushCreated(id, opts.text, opts.createdAt);
  if (details && opts.detailsAt) {
    events.push({ item_id: id, type: "edited", field: "details", old_value: "", new_value: details, at: opts.detailsAt });
  }
  return id;
}

// Journal a past move between lists for a card that already exists (its
// `list` field is already the CURRENT/final list — this just records that it
// used to live somewhere else, so the time machine has something to revert).
function movedFrom(id: string, fromList: string, toList: string, movedAt: string) {
  events.push({ item_id: id, type: "moved", field: "list", old_value: fromList, new_value: toList, at: movedAt });
  const row = itemsById.get(id);
  if (row && movedAt > row.updated_at) row.updated_at = movedAt;
}

// A recurring ("streak") card. `streakDays` are the local YYYY-MM-DD dates it was
// checked off, oldest first — exactly what lib/streaks.ts#completedDays replays
// back out of the event log. `lastCompletedOn` is the live field (items.completed_on).
function recurringCard(opts: {
  text: string;
  list: string;
  recurrence: string; // "daily" | "weekly:<0-6>"
  createdAt: string;
  streakDays: string[];
  lastCompletedOn: string | null;
}): string {
  const id = randomUUID();
  const row: ItemRow = {
    id,
    text: opts.text,
    list: opts.list,
    done: 0,
    position: nextPosition(opts.list),
    archived: 0,
    details: "",
    recurrence: opts.recurrence,
    completed_on: opts.lastCompletedOn,
    parent_id: null,
    created_at: opts.createdAt,
    updated_at: opts.lastCompletedOn
      ? `${opts.lastCompletedOn}T12:00:00.000Z`
      : opts.createdAt,
  };
  items.push(row);
  itemsById.set(id, row);
  pushCreated(id, opts.text, opts.createdAt);
  for (const day of opts.streakDays) {
    events.push({
      item_id: id,
      type: "completed",
      field: "completed_on",
      old_value: null,
      new_value: day,
      at: `${day}T08:15:00.000Z`,
    });
  }
  return id;
}

// ---- Today: recurring/streak cards (varied streaks; 2 done today) -------------

recurringCard({
  text: "Morning run",
  list: "today",
  recurrence: "daily",
  createdAt: at(90, 6, 30),
  streakDays: [ymd(5), ymd(4), ymd(3), ymd(2), ymd(1), ymd(0)], // 6, done today
  lastCompletedOn: ymd(0),
});
recurringCard({
  text: "Stretch",
  list: "today",
  recurrence: "daily",
  createdAt: at(40, 7, 0),
  streakDays: [ymd(3), ymd(2), ymd(1)], // 3, not yet today
  lastCompletedOn: ymd(1),
});
recurringCard({
  text: "Read 20 pages",
  list: "today",
  recurrence: "daily",
  createdAt: at(70, 21, 0),
  streakDays: Array.from({ length: 12 }, (_, i) => ymd(12 - i)), // 12, not yet today
  lastCompletedOn: ymd(1),
});
recurringCard({
  text: "Review tomorrow",
  list: "today",
  recurrence: "daily",
  createdAt: at(25, 21, 30),
  streakDays: [ymd(1)], // 1, not yet today
  lastCompletedOn: ymd(1),
});
// Weekly chore, done for the current period (today falls in it) — the second
// of the two "done today" cards.
recurringCard({
  text: "Water the plants",
  list: "today",
  recurrence: `weekly:${TODAY_WEEKDAY}`,
  createdAt: at(60, 9, 0),
  streakDays: [ymd(14), ymd(7), ymd(0)],
  lastCompletedOn: ymd(0),
});
recurringCard({
  text: "Inbox to zero",
  list: "today",
  recurrence: "daily",
  createdAt: at(10, 9, 0),
  streakDays: [], // 0 — just started, hasn't stuck yet
  lastCompletedOn: null,
});

// ---- Focus -------------------------------------------------------------------

// Captured as a quick brain-dump idea, promoted into Focus a few days later —
// gives the time machine a real "was somewhere else" moment.
const readingAppId = card({
  text: "Finish the reading list app",
  list: "focus",
  createdAt: at(15, 11, 20),
});
movedFrom(readingAppId, "braindump", "focus", at(6, 10, 0));

const lisbonId = card({
  text: "Plan the Lisbon trip",
  list: "focus",
  createdAt: at(20, 19, 0),
  details:
    "Aim for a week in October. Look at the Alfama and Graça neighborhoods first — walkable, close to the trams. Keep one day totally unplanned.",
  detailsAt: at(14, 20, 0),
});

// Lisbon trip's 3 sub-cards — one already done.
{
  const flights = card({
    text: "Book flights",
    list: "focus",
    createdAt: at(14, 20, 5),
    parentId: lisbonId,
  });
  events.push({ item_id: flights, type: "completed", field: "done", old_value: "false", new_value: "true", at: at(2, 17, 0) });
  const flightsRow = itemsById.get(flights)!;
  flightsRow.done = 1;
  flightsRow.updated_at = at(2, 17, 0);

  card({ text: "Find a place near Alfama", list: "focus", createdAt: at(10, 18, 0), parentId: lisbonId });
  card({ text: "Draft a day plan", list: "focus", createdAt: at(5, 21, 0), parentId: lisbonId });
}

// Sat in Waiting for a while, pulled into Focus a few days ago.
const dentistId = card({ text: "Call the dentist", list: "focus", createdAt: at(9, 16, 0) });
movedFrom(dentistId, "waiting", "focus", at(3, 9, 30));

card({ text: "Write the March newsletter", list: "focus", createdAt: at(11, 9, 0) });

// ---- Waiting / Later -----------------------------------------------------------

card({ text: "Reply from the landlord", list: "waiting", createdAt: at(7, 14, 0) });
card({ text: "Library hold: Piranesi", list: "waiting", createdAt: at(13, 12, 0) });
card({
  text: "Tax documents from the accountant",
  list: "waiting",
  createdAt: at(18, 10, 0),
  details: "Waiting on the 1099 before this can be filed.",
  detailsAt: at(17, 9, 0),
});

// ---- Backlog (someday/maybe, older) -------------------------------------------

card({ text: "Learn to make bread", list: "backlog", createdAt: at(45, 10, 0) });
card({ text: "Fix the squeaky door", list: "backlog", createdAt: at(38, 19, 0) });
card({ text: "Sort photos from summer", list: "backlog", createdAt: at(52, 15, 0) });
card({ text: "Try the climbing gym", list: "backlog", createdAt: at(60, 11, 0) });
card({ text: "Read about compost", list: "backlog", createdAt: at(70, 9, 0) });
card({ text: "Replace bike brake pads", list: "backlog", createdAt: at(33, 17, 0) });

// ---- Brain Dump (recent, quick captures) --------------------------------------

card({ text: "Idea: a tiny app for splitting dinner bills", list: "braindump", createdAt: ago(30, 0) });
card({ text: "Ask Sam about the camping spot", list: "braindump", createdAt: ago(5, 20) });

// ---- Note (sentinel list) ------------------------------------------------------

card({
  text: "Daily note",
  list: NOTE_LIST,
  createdAt: at(15, 8, 0),
  details:
    "Water the plants before work.\nCall the dentist about that appointment time.\nPack for Lisbon — check the passport expiry.",
  detailsAt: ago(4, 10),
});

// ---- Weekly review (sentinel list, ~100 words) ---------------------------------

const REVIEW_BODY = `## This week

Morning run is still going — six days straight, with Stretch not far behind. Read 20 pages hit its twelfth day, which is starting to feel automatic. Plan the Lisbon trip finally got real: flights are booked, and finding a place near Alfama is next. Call the dentist and the March newsletter are both still sitting in Focus without much movement — worth picking one tomorrow. Waiting held onto the landlord's reply and the library hold, both fine to leave a little longer. Brain Dump caught one small app idea, worth a look on a free evening.`;

card({
  text: "Weekly review",
  list: REVIEW_LIST,
  createdAt: at(2, 16, 0),
  details: REVIEW_BODY,
  detailsAt: at(2, 16, 5),
});

// ---------------------------------------------------------------------------
// Bulk insert — BEFORE triggers exist (see file header).

const insItem = db.prepare(`
  insert into items
    (id, text, list, done, position, archived, details, recurrence, completed_on,
     parent_id, user_id, board_id, touched_by, created_at, updated_at)
  values
    (@id, @text, @list, @done, @position, @archived, @details, @recurrence, @completed_on,
     @parent_id, @user_id, @board_id, @touched_by, @created_at, @updated_at)
`);
const insEvent = db.prepare(`
  insert into item_events (item_id, type, field, old_value, new_value, actor_id, at)
  values (@item_id, @type, @field, @old_value, @new_value, @actor_id, @at)
`);

db.transaction(() => {
  for (const it of items) {
    insItem.run({ ...it, user_id: userId, board_id: boardId, touched_by: userId });
  }
  for (const e of events) {
    insEvent.run({ ...e, actor_id: userId });
  }
})();

db.exec(CREATE_TRIGGERS);
db.close();

// ---------------------------------------------------------------------------

const meta = { dataDir: DATA_DIR, username: USERNAME, password: PASSWORD, userId, boardId };
fs.writeFileSync(path.join(DATA_DIR, "meta.json"), JSON.stringify(meta, null, 2));

console.log(`Seeded ${items.length} items, ${events.length} events.`);
console.log(`DB: ${dbFile}`);
console.log(JSON.stringify(meta, null, 2));
