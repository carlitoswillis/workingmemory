import type { Item, ItemEvent } from "../types";
import type { ListDef } from "../lists";
// .ts extensions so plain-node scripts/tests can import this module without a
// build step (same convention as lib/columns.ts — scripts/weekly-review.mjs
// imports this file directly).
import { NOTE_LIST, REVIEW_LIST, isSentinelList } from "../lists.ts";
import { parseRecurrence, describeRecurrence, effectiveDone } from "../recurrence.ts";
import { streakFor } from "../streaks.ts";

// The weekly-review digest: the board's event log for one window, rendered as
// compact plaintext for an LLM to summarize (plan §2). PURE and deterministic —
// no DB handle, no clock, no network — so `node lib/ai/digest.test.ts` runs it
// against fixtures and the generator script (scripts/weekly-review.mjs) can
// build the same text from a read-only snapshot.
//
// Three things the digest does that a naive "dump the events" wouldn't:
//   - Columns are DATA. Every list id resolves through the board's label map,
//     which covers SOFT-DELETED columns too, so a move into a since-removed
//     column still reads "moved to Reading" instead of a raw uuid.
//   - Actors are named. item_events.actor_id → @username (shared boards); a null
//     actor is the single owner, so a personal board reads in the first person.
//   - The review sentinel is EXCLUDED. Otherwise each week's review would feed
//     itself its own prose and drift away from the actual log.

export interface DigestData {
  items: Item[];
  events: ItemEvent[];
  /** Live columns, in board order (lib/columns.ts#getLists). */
  columns: ListDef[];
  /** id → label for EVERY column incl. soft-deleted ones (#getListLabels). */
  listLabels?: Record<string, string>;
  /** actor_id → username (lib/boards.ts#getMemberUsernames). Empty on a personal board. */
  members?: Record<string, string>;
  boardName?: string | null;
}

export interface DigestOptions {
  /** Cap on per-card timelines; the least-recently-active are dropped first. */
  maxTimelines?: number;
  /** Local YYYY-MM-DD used for streak math. Defaults to the window's end date. */
  today?: string;
  /** Cap on the daily-note excerpt. */
  maxNoteChars?: number;
}

const DEFAULTS = { maxTimelines: 40, maxNoteChars: 700 };
const MAX_CARDS_PER_COLUMN = 12;
const MAX_STUCK = 8;
const MAX_TITLE = 90;

const ms = (iso: string | null | undefined): number =>
  iso ? new Date(iso).getTime() : Number.NaN;

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

function clip(s: string, n = MAX_TITLE): string {
  const flat = (s ?? "").replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
}

/** Whole days between two instants, rounded down. */
function daysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, Math.floor((toMs - fromMs) / 86400000));
}

export function buildWeeklyDigest(
  data: DigestData,
  from: string,
  to: string,
  options: DigestOptions = {},
): string {
  const opts = { ...DEFAULTS, ...options };
  const labels = data.listLabels ?? {};
  const members = data.members ?? {};
  const fromMs = ms(from);
  const toMs = ms(to);
  const today = opts.today ?? dayOf(to);

  const liveIds = new Set(data.columns.map((c) => c.id));
  // A since-deleted column keeps its label (the row is only soft-archived) — say
  // so, otherwise the model reads a removed column as part of the current board.
  const labelOf = (id: string): string => {
    if (id === NOTE_LIST) return "Daily note";
    if (id === REVIEW_LIST) return "Weekly review";
    const label = labels[id] ?? data.columns.find((c) => c.id === id)?.label ?? id;
    return liveIds.has(id) ? label : `${label} (removed column)`;
  };
  // Null actor = the one person whose board this is; a known id = @username; an
  // id with no membership row = someone who has since left the board.
  const actorOf = (id: string | null): string => {
    if (!id) return "you";
    const name = members[id];
    return name ? `@${name}` : "a former member";
  };

  // ---- scope: sentinel items are not board cards ---------------------------
  const review = data.items.find(
    (i) => i.list === REVIEW_LIST && !i.archived && !i.parent_id,
  );
  const note = data.items.find((i) => i.list === NOTE_LIST && !i.archived && !i.parent_id);
  const byId = new Map(data.items.map((i) => [i.id, i]));
  const cards = data.items.filter((i) => !isSentinelList(i.list));

  const inWindow = (e: ItemEvent): boolean => {
    const at = ms(e.at);
    return Number.isFinite(at) && at >= fromMs && at < toMs;
  };
  // Chronological, id as the tiebreak — two events can share a millisecond.
  const windowEvents = data.events
    .filter((e) => inWindow(e) && byId.get(e.item_id)?.list !== REVIEW_LIST)
    .sort((a, b) => ms(a.at) - ms(b.at) || a.id - b.id);

  const out: string[] = [];
  const push = (line = "") => out.push(line);

  // ---- header --------------------------------------------------------------
  const span = daysBetween(fromMs, toMs);
  push(`WEEKLY DIGEST — board: ${data.boardName ?? "(personal board)"}`);
  push(`Window: ${from} → ${to} (${span} day${span === 1 ? "" : "s"})`);
  const people = Object.values(members).sort();
  push(
    people.length
      ? `Board members: ${people.map((p) => `@${p}`).join(", ")} — attribute actions to them by name.`
      : `Board members: just the one person — write in the second person ("you").`,
  );
  push();

  // ---- the board as it stands now ------------------------------------------
  push("BOARD NOW (open cards per column, in board order)");
  for (const col of data.columns) {
    // effectiveDone, not the raw flag: a daily task checked off today is done
    // for today even though `done` stays 0 (lib/recurrence.ts).
    const open = cards.filter(
      (i) => i.list === col.id && !i.archived && !i.parent_id && !effectiveDone(i, today),
    );
    if (open.length === 0) {
      push(`- ${col.label} [0]: (empty)`);
      continue;
    }
    const shown = open.slice(0, MAX_CARDS_PER_COLUMN).map((i) => clip(i.text));
    const more = open.length - shown.length;
    push(
      `- ${col.label} [${open.length}]: ${shown.join("; ")}${more > 0 ? `; …+${more} more` : ""}`,
    );
  }
  push();

  // ---- what moved in the window --------------------------------------------
  const tally = {
    created: 0,
    completed: 0,
    reopened: 0,
    moved: 0,
    nested: 0,
    archived: 0,
    restored: 0,
    renamed: 0,
    noted: 0,
    checked: 0,
  };
  for (const e of windowEvents) {
    if (e.type === "created") tally.created++;
    else if (e.field === "list") tally.moved++;
    else if (e.field === "parent") tally.nested++;
    else if (e.field === "done") e.type === "completed" ? tally.completed++ : tally.reopened++;
    else if (e.field === "completed_on") tally.checked++;
    else if (e.field === "archived") e.type === "archived" ? tally.archived++ : tally.restored++;
    else if (e.field === "text") tally.renamed++;
    else if (e.field === "details") tally.noted++;
  }
  push(`ACTIVITY IN WINDOW (${windowEvents.length} logged changes)`);
  push(
    [
      `created ${tally.created}`,
      `completed ${tally.completed}`,
      `reopened ${tally.reopened}`,
      `moved between columns ${tally.moved}`,
      `nested/unnested ${tally.nested}`,
      `archived ${tally.archived}`,
      `restored ${tally.restored}`,
      `retitled ${tally.renamed}`,
      `notes edited ${tally.noted}`,
      `repeating check-offs ${tally.checked}`,
    ].join(" · "),
  );
  push();

  // ---- per-card timelines ---------------------------------------------------
  const perItem = new Map<string, ItemEvent[]>();
  for (const e of windowEvents) {
    if (byId.get(e.item_id)?.list === NOTE_LIST) continue; // its own section below
    const arr = perItem.get(e.item_id);
    if (arr) arr.push(e);
    else perItem.set(e.item_id, [e]);
  }
  // Most-recently-active first, so truncation drops the oldest activity (plan §2).
  const ordered = [...perItem.entries()].sort((a, b) => {
    const la = ms(a[1][a[1].length - 1].at);
    const lb = ms(b[1][b[1].length - 1].at);
    return lb - la || (a[0] < b[0] ? -1 : 1);
  });
  const kept = ordered.slice(0, opts.maxTimelines);
  const dropped = ordered.length - kept.length;

  push(`CARD TIMELINES (${ordered.length} card${ordered.length === 1 ? "" : "s"} changed)`);
  if (kept.length === 0) push("(no card activity in this window)");
  for (const [itemId, evs] of kept) {
    const item = byId.get(itemId);
    const title = clip(item?.text ?? evs.find((e) => e.type === "created")?.new_value ?? itemId);
    const state = item
      ? `${labelOf(item.list)}${
          item.archived ? ", archived" : effectiveDone(item, today) ? ", done" : ", open"
        }`
      : "deleted since";
    push(`* "${title}" [${state}]`);
    for (const e of evs) push(`  - ${dayOf(e.at)} ${describeEvent(e, labelOf, actorOf, byId)}`);
  }
  if (dropped > 0) {
    push(
      `(${dropped} further card${dropped === 1 ? "" : "s"} changed in this window; their timelines were dropped — oldest activity first — to keep this digest small.)`,
    );
  }
  push();

  // ---- new captures ---------------------------------------------------------
  const createdIds = new Set(
    windowEvents.filter((e) => e.type === "created").map((e) => e.item_id),
  );
  const fresh = cards.filter((i) => createdIds.has(i.id) && !i.archived);
  if (fresh.length) {
    push("NEW THIS WINDOW (where each capture sits now)");
    for (const i of fresh) {
      push(`- "${clip(i.text)}" → ${labelOf(i.list)}${effectiveDone(i, today) ? " (done)" : ""}`);
    }
    push();
  }

  // ---- repeating tasks ------------------------------------------------------
  const repeating = cards.filter((i) => !i.archived && i.recurrence !== "none");
  if (repeating.length) {
    push("REPEATING TASKS (check-offs are the streak record)");
    for (const i of repeating) {
      const rec = parseRecurrence(i.recurrence);
      const days = new Set(i.completed_days ?? (i.completed_on ? [i.completed_on] : []));
      const hits = [...days].filter((d) => d >= dayOf(from) && d <= today).sort();
      const streak = streakFor(days, today, rec);
      push(
        `- "${clip(i.text)}" (${describeRecurrence(rec)}) — checked ${hits.length} time${
          hits.length === 1 ? "" : "s"
        } in window${hits.length ? ` (${hits.join(", ")})` : ""}; current streak ${streak}`,
      );
    }
    push();
  }

  // ---- the daily note -------------------------------------------------------
  if (note) {
    const edits = windowEvents.filter((e) => e.item_id === note.id && e.field === "details");
    push("DAILY NOTE");
    push(
      edits.length
        ? `- rewritten ${edits.length} time${edits.length === 1 ? "" : "s"} in window; last ${dayOf(
            edits[edits.length - 1].at,
          )} by ${actorOf(edits[edits.length - 1].actor_id)}`
        : "- untouched in this window",
    );
    const body = (note.details ?? "").trim();
    if (body) {
      push("- it currently reads:");
      for (const line of clipBody(body, opts.maxNoteChars).split("\n")) push(`    ${line}`);
    }
    push();
  }

  // ---- what hasn't moved ----------------------------------------------------
  const touched = new Set(windowEvents.map((e) => e.item_id));
  const stuck = cards
    .filter((i) => !i.archived && !i.parent_id && !effectiveDone(i, today) && !touched.has(i.id))
    .sort((a, b) => ms(a.updated_at) - ms(b.updated_at))
    .slice(0, MAX_STUCK);
  if (stuck.length) {
    push("UNTOUCHED THROUGH THE WHOLE WINDOW (candidates for 'stuck')");
    for (const i of stuck) {
      const age = daysBetween(ms(i.updated_at), toMs);
      push(`- "${clip(i.text)}" in ${labelOf(i.list)} — last touched ${dayOf(i.updated_at)} (${age}d ago)`);
    }
    push();
  }

  if (review) {
    push(
      "(The board's own weekly-review card is deliberately excluded above — this digest is the log, not the last review.)",
    );
  }

  return out.join("\n").trimEnd() + "\n";
}

function clipBody(body: string, max: number): string {
  return body.length > max ? `${body.slice(0, max)}\n… (note truncated)` : body;
}

// One event → one human clause. Kept out of buildWeeklyDigest so the test can
// exercise the wording (column labels + attribution) directly.
export function describeEvent(
  e: ItemEvent,
  labelOf: (id: string) => string,
  actorOf: (id: string | null) => string,
  byId: Map<string, Item>,
): string {
  const who = `by ${actorOf(e.actor_id)}`;
  switch (e.field) {
    case "list":
      return `moved ${labelOf(e.old_value ?? "")} → ${labelOf(e.new_value ?? "")} ${who}`;
    case "parent": {
      const name = (id: string | null) =>
        id ? `"${clip(byId.get(id)?.text ?? id, 50)}"` : "the board";
      return e.new_value
        ? `nested under ${name(e.new_value)} ${who}`
        : `pulled back out to ${name(null)} ${who}`;
    }
    case "done":
      return `${e.type === "completed" ? "completed" : "reopened"} ${who}`;
    case "completed_on":
      return e.new_value
        ? `checked off for ${e.new_value} ${who}`
        : `un-checked for ${e.old_value ?? "that day"} ${who}`;
    case "archived":
      return `${e.type === "archived" ? "archived" : "restored from the archive"} ${who}`;
    case "text":
      return e.type === "created"
        ? `created ${who}`
        : `retitled from "${clip(e.old_value ?? "", 50)}" ${who}`;
    case "details":
      return `${detailsVerb(e)} ${who}`;
    default:
      return `${e.type} ${who}`;
  }
}

function detailsVerb(e: ItemEvent): string {
  const before = (e.old_value ?? "").trim().length;
  const after = (e.new_value ?? "").trim().length;
  if (!before && after) return "notes added";
  if (before && !after) return "notes cleared";
  return after > before ? "notes expanded" : "notes trimmed";
}
