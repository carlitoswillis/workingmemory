// Build a fresh, realistic staging DB for the PHONE APP screenshot pass.
//
//   DATA_DIR=<dir> npx tsx scripts/dev/seed-phone-demo.ts
//
// Mirrors the app's own seeding pattern (lib/db.ts#openDemoDb, scripts/import-backup.ts):
// CREATE_TABLES, bulk-insert items + item_events directly (so the fabricated history
// is exactly what triggers would have produced, without a spurious "created" event
// clobbering it), THEN attach CREATE_TRIGGERS — so every later, LIVE interaction
// (tapping a checkbox during the capture pass) is journaled normally.
//
// One account ("carlitos"), one board ("Personal"), the owner's real column set,
// content shaped to match app/BoardScreen.tsx + components/phone/*: recurring
// "Today" cards with varied streaks (lib/streaks.ts), Focus/Waiting/Backlog/Brain
// Dump cards at different ages, one card with 3 sub-cards, a pinned Note and a
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
  "/private/tmp/claude-501/-Users-carlitoswillis-workspace/d0c88bad-af13-4089-a699-c66f45e77acf/scratchpad/pass2";

const USERNAME = "carlitos";
const PASSWORD = "phone-demo-pass-2026"; // dev-only seed DB; never a real credential

const dbFile = path.join(DATA_DIR, "owner", "wm.db");

// ---------------------------------------------------------------------------
// Time helpers (local calendar, same convention as lib/demo/seed.ts).

const NOW = new Date();

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
// edit, and (for recurring cards) a run of completed_on check-offs.

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
  items.push({
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
  });
  pushCreated(id, opts.text, opts.createdAt);
  if (details && opts.detailsAt) {
    events.push({ item_id: id, type: "edited", field: "details", old_value: "", new_value: details, at: opts.detailsAt });
  }
  return id;
}

// A recurring ("streak") card. `streakDays` are the local YYYY-MM-DD dates it was
// checked off, oldest first — exactly what lib/streaks.ts#completedDays replays
// back out of the event log. `doneToday` decides whether today is one of them
// (and therefore whether it currently reads as checked).
function recurringCard(opts: {
  text: string;
  list: string;
  recurrence: string; // "daily" | "weekly:<0-6>"
  createdAt: string;
  streakDays: string[];
  lastCompletedOn: string | null; // items.completed_on — the live field
}): string {
  const id = randomUUID();
  items.push({
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
  });
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

// ---- Today: recurring/streak cards (varied streaks 0–6; 2 done today) -----------

recurringCard({
  text: "Gym",
  list: "today",
  recurrence: "daily",
  createdAt: at(90, 7, 10),
  streakDays: [ymd(5), ymd(4), ymd(3), ymd(2), ymd(1), ymd(0)], // 6, done today
  lastCompletedOn: ymd(0),
});
recurringCard({
  text: "Push",
  list: "today",
  recurrence: "daily",
  createdAt: at(60, 7, 30),
  streakDays: [ymd(3), ymd(2), ymd(1)], // 3, not yet today
  lastCompletedOn: ymd(1),
});
recurringCard({
  text: "Pull",
  list: "today",
  recurrence: "daily",
  createdAt: at(60, 7, 30),
  streakDays: [], // 0 — broken
  lastCompletedOn: null,
});
recurringCard({
  text: "Legs",
  list: "today",
  recurrence: "daily",
  createdAt: at(60, 7, 30),
  streakDays: [ymd(2), ymd(1)], // 2, not yet today
  lastCompletedOn: ymd(1),
});
recurringCard({
  text: "Shower",
  list: "today",
  recurrence: "daily",
  createdAt: at(120, 6, 50),
  streakDays: [ymd(3), ymd(2), ymd(1), ymd(0)], // 4, done today
  lastCompletedOn: ymd(0),
});
recurringCard({
  text: "Brush teeth",
  list: "today",
  recurrence: "daily",
  createdAt: at(200, 6, 55),
  streakDays: [ymd(5), ymd(4), ymd(3), ymd(2), ymd(1)], // 5, not yet today
  lastCompletedOn: ymd(1),
});
recurringCard({
  text: "Algorithm review",
  list: "today",
  recurrence: "daily",
  createdAt: at(30, 20, 0),
  streakDays: [ymd(1)], // 1, not yet today
  lastCompletedOn: ymd(1),
});
recurringCard({
  text: "Formation task",
  list: "today",
  recurrence: "daily",
  createdAt: at(14, 9, 0),
  streakDays: [], // 0 — just started, hasn't stuck yet
  lastCompletedOn: null,
});
recurringCard({
  text: "Review notes and plan tomorrow",
  list: "today",
  recurrence: "daily",
  createdAt: at(21, 21, 30),
  streakDays: [ymd(3), ymd(2), ymd(1)], // 3, not yet today
  lastCompletedOn: ymd(1),
});
// Wednesdays chore (weekday 3) — done the last two Wednesdays, not yet this one:
// weeklyStreak counts that as 2, currently due.
recurringCard({
  text: "Wednesdays: laundry, sweep, mop, clean",
  list: "today",
  recurrence: "weekly:3",
  createdAt: at(100, 8, 0),
  streakDays: ["2026-08-19", "2026-08-26"],
  lastCompletedOn: "2026-08-26",
});

// ---- Focus: created weeks ago -----------------------------------------------

card({ text: "Study dossier", list: "focus", createdAt: at(28, 19, 10) });
card({ text: "Reach out to network", list: "focus", createdAt: at(25, 9, 40) });
card({ text: "Seek contract work", list: "focus", createdAt: at(24, 11, 5) });
const formationId = card({
  text: "Formation",
  list: "focus",
  createdAt: at(21, 20, 15),
  details:
    "Halfway through the current module. The assessment wants a working example, not just theory — reuse the retrieval pattern from the brief. Cohort call is Thursdays.",
  detailsAt: at(9, 21, 0),
});
card({ text: "Job search", list: "focus", createdAt: at(20, 10, 0) });
card({ text: "Love letter to Mari", list: "focus", createdAt: at(18, 22, 40) });

// Formation's 3 sub-cards — one already done.
{
  const c1 = card({ text: "Finish assessment 3", list: "focus", createdAt: at(9, 21, 5), parentId: formationId });
  events.push({ item_id: c1, type: "completed", field: "done", old_value: "false", new_value: "true", at: at(2, 18, 0) });
  const i1 = items.find((i) => i.id === c1)!;
  i1.done = 1;
  i1.updated_at = at(2, 18, 0);

  card({ text: "Watch this week's session recording", list: "focus", createdAt: at(6, 19, 20), parentId: formationId });
  card({ text: "Message cohort lead about pairing", list: "focus", createdAt: at(4, 12, 0), parentId: formationId });
}

// ---- Waiting / Later ----------------------------------------------------------

card({
  text: "Interview prep",
  list: "waiting",
  createdAt: at(30, 15, 0),
  details: "Redo the behavioral answers — STAR format, keep each under 90 seconds.",
  detailsAt: at(29, 9, 0),
});
card({ text: "Coding projects", list: "waiting", createdAt: at(26, 16, 30) });
card({
  text: "openwiki",
  list: "waiting",
  createdAt: at(21, 14, 0),
  details: "Nightly LaunchAgent disabled since Aug 14. Move to 0.5.0 before re-enabling.",
  detailsAt: at(20, 18, 0),
});
card({ text: "Fix local model usage", list: "waiting", createdAt: at(12, 17, 45) });

// ---- Backlog (someday/maybe, older) -------------------------------------------

card({ text: "Growth eng curriculum", list: "backlog", createdAt: at(60, 13, 0) });
card({ text: "Coding by hand", list: "backlog", createdAt: at(75, 11, 20) });
card({ text: "See doctor for scalp", list: "backlog", createdAt: at(50, 9, 15) });
card({ text: "Learn car maintenance", list: "backlog", createdAt: at(65, 20, 0) });
card({ text: "hermes agent", list: "backlog", createdAt: at(40, 22, 10) });
card({
  text: "obsidian / second brain",
  list: "backlog",
  createdAt: at(80, 21, 0),
  details: "Decide: fold into Working Memory, or keep separate.",
  detailsAt: at(80, 21, 4),
});
card({ text: "watching", list: "backlog", createdAt: at(55, 23, 30) });
card({ text: "Learn more about style", list: "backlog", createdAt: at(70, 14, 40) });

// ---- Brain Dump (recent, quick captures) --------------------------------------

card({ text: "Schedule workouts with Mari", list: "braindump", createdAt: ago(28, 0) });
card({ text: "Fix the commit identity once", list: "braindump", createdAt: ago(3, 15) });

// ---- Note (sentinel list) ------------------------------------------------------

card({
  text: "Daily note",
  list: NOTE_LIST,
  createdAt: at(21, 8, 0),
  details:
    "Push day, then reply to Mari about Saturday.\nFormation: pick up assessment 3 tonight if there's time.\nStreak's at 6 for gym — don't break it now.",
  detailsAt: ago(6, 40),
});

// ---- Weekly review (sentinel list, ~120 words) ---------------------------------

const REVIEW_BODY = `## Week of September 4

The board tilted toward Formation this week — you finished assessment 3 and kept the cohort thread moving, while Job search sat in Focus without a new card landing on it. Gym is on a six-day run and Shower right behind it at four; Pull and the new Formation-task habit haven't caught yet, so tomorrow's a fair day to restart one of them. Waiting still holds Interview prep and openwiki from a while back, both worth a look before they go stale — openwiki in particular has been parked since the LaunchAgent came off. Brain Dump caught two quick things, including a note to fix the commit identity once and for all. Reach out to network and Love letter to Mari are both still open; neither needs research, just time.`;

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
