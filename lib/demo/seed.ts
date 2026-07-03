// Fabricated board + history for demo mode (see lib/db.ts). Pure and
// dependency-free so it's unit-testable with plain `node`.
//
// The whole point of the demo is the time machine, so the seed isn't just rows —
// it's ~3 weeks of EVENT HISTORY that must be internally consistent: an item's
// current values have to be exactly what you get by replaying its events forward
// (reconstructBoardAt reverts events from current values, so any mismatch shows
// up as a glitchy past). Rather than hand-author both and hope, we author a
// SCRIPT of actions and replay it: the replay computes the final item rows and
// emits events in precisely the shape the SQLite triggers would have written.
//
// Timestamps are offsets from `now`, hand-placed to look organic (morning
// captures, evening triage bursts, quiet weekends) — a uniform spray would read
// as fake the moment someone scrubs the timeline.

export interface SeedItemRow {
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
}

export interface SeedEventRow {
  item_id: string;
  type: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  at: string;
}

type Step =
  | {
      do: "create";
      id: string;
      text: string;
      list: string;
      t: string;
      parent?: string;
      recurrence?: "daily";
      completed_on?: string;
    }
  | { do: "edit"; id: string; text: string; t: string }
  | { do: "details"; id: string; details: string; t: string }
  | { do: "move"; id: string; list: string; t: string }
  | { do: "done"; id: string; t: string }
  | { do: "reopen"; id: string; t: string }
  | { do: "archive"; id: string; t: string };

export function buildSeed(now: Date): {
  items: SeedItemRow[];
  events: SeedEventRow[];
} {
  // `daysAgo` days before `now`, at hh:mm local. Seconds are derived (not random)
  // so the seed is deterministic for a given `now`.
  const at = (daysAgo: number, hh: number, mm: number): string => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hh, mm, (daysAgo * 17 + hh * 7 + mm) % 60, 0);
    return d.toISOString();
  };
  // For "earlier today" moments, counted back from now so they can't land in
  // the future regardless of when the demo board is created.
  const ago = (hours: number, minutes = 0): string =>
    new Date(now.getTime() - (hours * 60 + minutes) * 60_000).toISOString();

  const ymd = (daysAgo: number): string => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  const script: Step[] = [
    // ---- Week 3 (the beginning): project kickoff + first captures ----------
    { do: "create", id: "s-note", text: "Daily note", list: "note", t: at(21, 8, 4) },
    {
      do: "details",
      id: "s-note",
      details:
        "Kicking off the reading-tracker rebuild this week. Keep scope tiny: import, shelf view, notes.",
      t: at(21, 8, 6),
    },
    { do: "create", id: "s-api", text: "spike: goodreads csv import", list: "braindump", t: at(21, 9, 31) },
    { do: "create", id: "s-shelf", text: "shelf view mockup", list: "braindump", t: at(21, 9, 33) },
    { do: "create", id: "s-run", text: "Run 5k", list: "today", t: at(21, 7, 12), recurrence: "daily", completed_on: ymd(1) },
    { do: "create", id: "s-dentist", text: "book dentist appt", list: "braindump", t: at(20, 12, 47) },
    { do: "move", id: "s-api", list: "focus", t: at(20, 19, 2) },
    { do: "edit", id: "s-api", text: "Goodreads CSV import — parse + dedupe", t: at(20, 19, 5) },
    {
      do: "details",
      id: "s-api",
      details: "Their CSV has BOM + inconsistent quoting. Papaparse handles it. Dedupe on ISBN13, fall back to title+author.",
      t: at(19, 21, 40),
    },
    { do: "create", id: "s-lib", text: "pick a charting lib for reading stats", list: "backlog", t: at(19, 21, 55) },

    // ---- Week 2: import ships, shelf work starts, life intrudes ------------
    { do: "move", id: "s-dentist", list: "today", t: at(15, 8, 20) },
    { do: "done", id: "s-dentist", t: at(15, 11, 5) },
    { do: "create", id: "s-insurance", text: "renew renters insurance", list: "waiting", t: at(15, 11, 9) },
    {
      do: "details",
      id: "s-insurance",
      details: "Policy lapses on the 28th. Waiting on the requote email.",
      t: at(15, 11, 11),
    },
    { do: "done", id: "s-api", t: at(14, 22, 18) },
    {
      do: "details",
      id: "s-note",
      details:
        "Import is DONE — 412 books in, dedupe caught 9. Shelf view next.\n\nAlso: gym streak going, dentist finally booked.",
      t: at(14, 22, 25),
    },
    { do: "move", id: "s-shelf", list: "focus", t: at(14, 22, 30) },
    { do: "edit", id: "s-shelf", text: "Shelf view — cover grid + list toggle", t: at(14, 22, 32) },
    { do: "create", id: "s-covers", text: "cover images: openlibrary API", list: "focus", t: at(13, 20, 15), parent: "s-shelf" },
    { do: "create", id: "s-sort", text: "sort: recency / author / rating", list: "focus", t: at(13, 20, 16), parent: "s-shelf" },
    { do: "create", id: "s-bday", text: "mom birthday gift ideas", list: "braindump", t: at(13, 13, 2) },
    {
      do: "details",
      id: "s-bday",
      details: "- ceramics class?\n- that gardening book\n- frame the lake photo",
      t: at(13, 13, 6),
    },
    { do: "done", id: "s-covers", t: at(12, 21, 48) },
    { do: "create", id: "s-ratelimit", text: "openlibrary rate limits — add cache", list: "braindump", t: at(12, 21, 52) },
    { do: "move", id: "s-ratelimit", list: "backlog", t: at(11, 9, 15) },

    // ---- The stuck one (a "what's been rotting in Waiting" story) ----------
    { do: "create", id: "s-visa", text: "passport renewal", list: "today", t: at(18, 10, 30) },
    { do: "move", id: "s-visa", list: "waiting", t: at(17, 9, 5) },
    {
      do: "details",
      id: "s-visa",
      details: "Photos done. Mailed 6/16 — processing is '6-8 weeks', check status online.",
      t: at(17, 9, 8),
    },

    // ---- Week 1: polish, a reopened bug, triage of the dump ----------------
    { do: "done", id: "s-sort", t: at(8, 20, 40) },
    { do: "done", id: "s-shelf", t: at(8, 20, 44) },
    {
      do: "details",
      id: "s-note",
      details:
        "Shelf view shipped to the test deploy. It looks GOOD.\n\nWeekend: no laptop. Hike Saturday if it's clear.",
      t: at(8, 21, 10),
    },
    { do: "reopen", id: "s-shelf", t: at(6, 18, 22) },
    {
      do: "details",
      id: "s-shelf",
      details: "Reopened: grid collapses on mobile < 380px. Flex-basis fix, test on the old phone.",
      t: at(6, 18, 25),
    },
    { do: "create", id: "s-notes-feat", text: "per-book notes + quotes", list: "backlog", t: at(6, 19, 0) },
    { do: "create", id: "s-groceries", text: "groceries + meal prep sunday", list: "braindump", t: at(6, 16, 41) },
    { do: "archive", id: "s-groceries", t: at(4, 20, 10) },
    { do: "done", id: "s-shelf", t: at(4, 21, 33) },
    { do: "create", id: "s-deploy", text: "move tracker to real domain", list: "backlog", t: at(4, 21, 50) },
    { do: "move", id: "s-lib", list: "focus", t: at(3, 20, 5) },
    { do: "edit", id: "s-lib", text: "Reading stats — pages/week chart", t: at(3, 20, 8) },
    {
      do: "details",
      id: "s-lib",
      details: "Going with plain SVG, no lib. One chart: pages/week, last 12 weeks.",
      t: at(3, 20, 12),
    },

    // ---- This week / today -------------------------------------------------
    { do: "create", id: "s-taxes", text: "quarterly estimated taxes", list: "today", t: at(2, 8, 45) },
    {
      do: "details",
      id: "s-taxes",
      details: "Due the 15th. Numbers are in the spreadsheet from April.",
      t: at(2, 8, 47),
    },
    { do: "create", id: "s-review", text: "write up tracker v1 retro", list: "waiting", t: at(2, 9, 30) },
    { do: "move", id: "s-bday", list: "today", t: at(1, 18, 12) },
    { do: "edit", id: "s-bday", text: "order mom's birthday gift", t: at(1, 18, 14) },
    {
      do: "details",
      id: "s-note",
      details:
        "Today: taxes + mom's gift (ceramics class won). Stats chart is close — ship it tonight?\n\nPassport still 'processing'. Week 3 of hikes streak.",
      t: ago(7, 20),
    },
    { do: "create", id: "s-standup", text: "reply to Sam re: climbing sat", list: "today", t: ago(5, 45) },
    { do: "done", id: "s-standup", t: ago(2, 10) },
    { do: "create", id: "s-idea", text: "idea: 'currently reading' widget for the site", list: "braindump", t: ago(0, 50) },
  ];

  // ---- Replay ---------------------------------------------------------------

  interface ItemState {
    id: string;
    text: string;
    list: string;
    done: boolean;
    archived: boolean;
    details: string;
    recurrence: string;
    completed_on: string | null;
    parent_id: string | null;
    created_at: string;
    updated_at: string;
  }

  const ms = (iso: string) => new Date(iso).getTime();
  const steps = [...script].sort((a, b) => ms(a.t) - ms(b.t));

  const state = new Map<string, ItemState>();
  const events: SeedEventRow[] = [];
  const order: string[] = []; // creation order, for stable positions

  const emit = (
    item_id: string,
    type: string,
    field: string,
    old_value: string | null,
    new_value: string | null,
    t: string,
  ) => events.push({ item_id, type, field, old_value, new_value, at: t });

  for (const s of steps) {
    if (s.do === "create") {
      state.set(s.id, {
        id: s.id,
        text: s.text,
        list: s.list,
        done: false,
        archived: false,
        details: "",
        recurrence: s.recurrence ?? "none",
        completed_on: s.completed_on ?? null,
        parent_id: s.parent ?? null,
        created_at: s.t,
        updated_at: s.t,
      });
      order.push(s.id);
      emit(s.id, "created", "text", null, s.text, s.t);
      continue;
    }
    const it = state.get(s.id);
    if (!it) throw new Error(`seed script: "${s.do}" on unknown item ${s.id}`);
    switch (s.do) {
      case "edit":
        emit(s.id, "edited", "text", it.text, s.text, s.t);
        it.text = s.text;
        break;
      case "details":
        emit(s.id, "edited", "details", it.details, s.details, s.t);
        it.details = s.details;
        break;
      case "move":
        emit(s.id, "moved", "list", it.list, s.list, s.t);
        it.list = s.list;
        break;
      case "done":
        emit(s.id, "completed", "done", "false", "true", s.t);
        it.done = true;
        break;
      case "reopen":
        emit(s.id, "reopened", "done", "true", "false", s.t);
        it.done = false;
        break;
      case "archive":
        emit(s.id, "archived", "archived", "false", "true", s.t);
        it.archived = true;
        break;
    }
    it.updated_at = s.t;
  }

  // Positions: epoch-ms-flavored like the app writes, spaced by creation order.
  const base = now.getTime() - order.length * 1000;
  const items: SeedItemRow[] = order.map((id, i) => {
    const it = state.get(id)!;
    return {
      id: it.id,
      text: it.text,
      list: it.list,
      done: it.done ? 1 : 0,
      position: base + i * 1000,
      archived: it.archived ? 1 : 0,
      details: it.details,
      recurrence: it.recurrence,
      completed_on: it.completed_on,
      parent_id: it.parent_id,
      created_at: it.created_at,
      updated_at: it.updated_at,
    };
  });

  return { items, events };
}
