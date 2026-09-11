import type { Item, ItemEvent } from "./types";
import type { ListId } from "./lists";
// .ts extension so plain-node tests can import this module (see lib/columns.ts).
import { describeRecurrence, effectiveDone, parseRecurrence } from "./recurrence.ts";
import { isSentinelList } from "./lists.ts";

// A reconstructed item as it was at some past moment T.
export interface BoardItemAt {
  id: string;
  text: string;
  details: string;
  list: ListId;
  done: boolean;
  parent_id: string | null; // null = top-level board card (children are hidden)
  existed: boolean; // was it created on or before T?
  archived: boolean; // was it archived at T?
}

function asBool(v: string | null): boolean {
  return v === "true" || v === "t" || v === "1";
}

const ms = (iso: string) => new Date(iso).getTime();

// The local calendar date (YYYY-MM-DD) of an ISO instant — same convention as
// lib/recurrence.ts localToday(), for judging a daily task "done" at time t.
function localDateOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Reconstruct one item's state at time `t` by starting from its CURRENT values
 * and reverting every change that happened after `t` (each event carries the
 * field's old value). Walking newest→oldest lands exactly on the state at `t`.
 */
export function reconstructItemAt(
  item: Item,
  events: ItemEvent[],
  t: string,
): BoardItemAt {
  const tt = ms(t);
  let { text, list, done, archived } = item;
  let details = item.details ?? "";
  let completed_on = item.completed_on ?? null;
  let parent_id = item.parent_id ?? null;

  const after = events
    .filter((e) => ms(e.at) > tt)
    .sort((a, b) => ms(b.at) - ms(a.at) || b.id - a.id);

  for (const e of after) {
    switch (e.field) {
      case "text":
        text = e.old_value ?? text;
        break;
      case "details":
        details = e.old_value ?? "";
        break;
      case "list":
        list = (e.old_value as ListId) ?? list;
        break;
      case "done":
        done = asBool(e.old_value);
        break;
      case "archived":
        archived = asBool(e.old_value);
        break;
      case "completed_on":
        completed_on = e.old_value;
        break;
      // Nesting (move into / out of another card). old_value null = it was a
      // top-level board card at that moment.
      case "parent":
        parent_id = e.old_value ?? null;
        break;
    }
  }

  const created = events.find((e) => e.type === "created");
  const bornAt = created ? ms(created.at) : ms(item.created_at);

  return {
    id: item.id,
    text,
    details,
    list,
    // A repeating task's done-ness at t is the live board's effectiveDone() applied
    // to the reverted state, as of t's calendar day: "was it checked off for that
    // day" (daily) / "for that week" (weekly). (completed_on events only exist from
    // 2026-07-03 on; older moments fall back to whatever completed_on survives, which
    // mirrors pre-streaks behavior.) Non-repeating items keep the reverted `done` flag.
    done: effectiveDone({ recurrence: item.recurrence, completed_on, done }, localDateOf(t)),
    parent_id,
    existed: bornAt <= tt,
    archived,
  };
}

/**
 * Reconstruct the whole visible board at time `t`: every item that existed and
 * was not archived at that moment, with its then-current text/list/done.
 */
export function reconstructBoardAt(
  items: Item[],
  events: ItemEvent[],
  t: string,
): BoardItemAt[] {
  const byItem = groupEvents(events);
  return items
    .map((it) => reconstructItemAt(it, byItem.get(it.id) ?? [], t))
    .filter((s) => s.existed && !s.archived);
}

function groupEvents(events: ItemEvent[]): Map<string, ItemEvent[]> {
  const byItem = new Map<string, ItemEvent[]>();
  for (const e of events) {
    const arr = byItem.get(e.item_id);
    if (arr) arr.push(e);
    else byItem.set(e.item_id, [e]);
  }
  return byItem;
}

// ---------------------------------------------------------------------------
// "What changed": the diff ledger between a scrubbed moment T and now.
//
// Not a second scrubber. The time machine already picks ONE moment; this answers
// the question that follows it — "so what happened since?" — as one line per card,
// in the phone's row grammar (see components/phone/PhoneNote.tsx).
//
// The whole thing is built by COMPARING STATE, not by counting events: each card is
// reconstructed at T (reconstructItemAt) and held against its state now. That is
// what makes the ledger read the way a person remembers the week — a card reworded
// three times is "reworded", a card renamed and renamed back is not a change at all,
// and a daily card ticked every morning is not seven lines of "done".
// ---------------------------------------------------------------------------

// The kinds a card's line can carry, in the order they read. Exported (with the
// phrases below) so the view never re-encodes this wording.
export type DiffKind =
  | "added"
  | "done"
  | "reopened"
  | "archived"
  | "restored"
  | "moved"
  | "reworded"
  | "details"
  | "nested"
  | "unnested"
  | "recurrence";

export const DIFF_KINDS: DiffKind[] = [
  "added",
  "done",
  "reopened",
  "archived",
  "restored",
  "moved",
  "reworded",
  "details",
  "nested",
  "unnested",
  "recurrence",
];

// The bare phrase for a kind. Lowercase and verb-shaped: a row reads
// `<title> — added, moved from Focus to Today`, so the card's own words lead.
export const DIFF_KIND_PHRASE: Record<DiffKind, string> = {
  added: "added",
  done: "done",
  reopened: "reopened",
  archived: "archived",
  restored: "restored",
  moved: "moved",
  reworded: "reworded",
  details: "details edited",
  nested: "nested",
  unnested: "un-nested",
  recurrence: "recurrence changed",
};

// The phrase plus its detail, when the kind carries one ("moved" + "from Focus to
// Today" = "moved from Focus to Today").
export function diffKindPhrase(kind: DiffKind, detail?: string | null): string {
  return detail ? `${DIFF_KIND_PHRASE[kind]} ${detail}` : DIFF_KIND_PHRASE[kind];
}

export interface DiffSubCounts {
  done: number;
  added: number;
  archived: number;
  reopened: number;
  restored: number;
}
export const SUB_COUNT_KINDS = ["added", "done", "reopened", "archived", "restored"] as const;
export type SubCountKind = (typeof SUB_COUNT_KINDS)[number];
export const EMPTY_SUB_COUNTS: DiffSubCounts = {
  done: 0,
  added: 0,
  archived: 0,
  reopened: 0,
  restored: 0,
};

// "2 sub-cards done" — the roll-up clauses for a parent's line, in kind order. A
// sub-card reopened or restored inside the window is a change too; without its
// own count it would vanish from the ledger.
export function subCountPhrases(s: DiffSubCounts): string[] {
  const out: string[] = [];
  const n = (count: number, what: string) =>
    `${count} sub-card${count === 1 ? "" : "s"} ${what}`;
  for (const k of SUB_COUNT_KINDS) if (s[k]) out.push(n(s[k], DIFF_KIND_PHRASE[k]));
  return out;
}

// The whole-ledger line for an empty window. Here rather than in the view for the
// same reason as the phrases above: one place owns the wording.
export function nothingChangedPhrase(moment: string): string {
  return `Nothing changed since ${moment}.`;
}

export interface DiffEntry {
  id: string;
  // The card's CURRENT title — or, for a card that was archived inside the window,
  // its title at the moment it was archived (what you'd recognise it by).
  title: string;
  kinds: DiffKind[]; // in DIFF_KINDS order; may be empty for a sub-count-only parent
  details: Partial<Record<DiffKind, string>>; // e.g. { moved: "from Focus to Today" }
  // Every clause joined the way the row prints it: "added, 2 sub-cards done".
  phrase: string;
  at: string | null; // the most recent change inside the window (ISO), null if none
  subCounts?: DiffSubCounts; // present only when sub-cards rolled up into this line
}

export interface BoardDiff {
  from: string; // T, as given
  to: string; // now, as given
  entries: DiffEntry[];
  // Cards carrying each kind — rolled-up sub-cards included, so "3 done" means three
  // cards were finished even when two of them are counted on a parent's line.
  counts: Record<DiffKind, number>;
  // The same numbers, non-zero only, in kind order, each with its printable phrase.
  summary: { kind: DiffKind; count: number; phrase: string }[];
}

const newestFirst = (a: ItemEvent, b: ItemEvent) => ms(b.at) - ms(a.at) || b.id - a.id;

// `completed_on` as it stood at `tMs` — reverted the same way reconstructItemAt
// reverts every other field. reconstructItemAt folds this into effectiveDone and
// doesn't hand the raw date back, and the diff needs the raw date at BOTH ends so it
// can judge done-ness at both against one explicit `today` (see "reopened" below).
function completedOnAt(item: Item, events: ItemEvent[], tMs: number): string | null {
  let on = item.completed_on ?? null;
  for (const e of events.filter((e) => e.field === "completed_on" && ms(e.at) > tMs).sort(newestFirst)) {
    on = e.old_value;
  }
  return on;
}

// Same walk for `recurrence`. No trigger writes these events today (lib/schema.ts
// tracks text/details/list/done/completed_on/archived/parent/linked_board), so this
// reads as "unchanged" on every real board — it is here so the kind is already
// wired the day the trigger lands, and costs one filter over a card's events.
function recurrenceAt(item: Item, events: ItemEvent[], tMs: number): string {
  let r = item.recurrence;
  for (const e of events.filter((e) => e.field === "recurrence" && ms(e.at) > tMs).sort(newestFirst)) {
    r = e.old_value ?? r;
  }
  return r;
}

interface Computed {
  kinds: DiffKind[];
  details: Partial<Record<DiffKind, string>>;
  title: string;
  at: string | null;
  parentId: string | null;
  parentChanged: boolean; // it carries a nested / un-nested clause of its own
}

/**
 * The ledger of what changed between `tIso` and `nowIso`, one entry per card.
 *
 * Pure and framework-free, like the rest of this file: hand it the timeline the
 * Time travel sheet already holds (items + the whole event log), the column labels,
 * and today's local date (for repeating cards' done-ness — see lib/recurrence.ts).
 */
export function diffBoardSince(
  items: Item[],
  events: ItemEvent[],
  tIso: string,
  nowIso: string,
  opts: { listLabels: Record<string, string>; today: string },
): BoardDiff {
  const tMs = ms(tIso);
  const nowMs = ms(nowIso);
  const byItem = groupEvents(events);
  const byId = new Map(items.map((i) => [i.id, i]));
  const labelOf = (id: string) => opts.listLabels[id] ?? id;
  const titleOf = (id: string) => byId.get(id)?.text ?? "a card";

  const computed = new Map<string, Computed>();
  // Cards that are not on the ledger's books at all: archived at BOTH ends (they
  // were already gone before the window opened), the pinned note/review, and
  // anything born after `now`. A sub-card whose parent is hidden is dropped with it.
  const hidden = new Set<string>();

  for (const item of items) {
    const evs = byItem.get(item.id) ?? [];
    const before = reconstructItemAt(item, evs, tIso);
    const after = reconstructItemAt(item, evs, nowIso);

    const bornBefore = before.existed;
    const archivedThen = bornBefore && before.archived;
    const archivedNow = after.archived;

    if (
      !after.existed || // created after `now` (clock skew) — not this window's business
      (archivedThen && archivedNow) || // gone at both ends
      isSentinelList(after.list) ||
      isSentinelList(before.list) // the pinned note and the weekly review aren't cards
    ) {
      hidden.add(item.id);
      continue;
    }

    // Repeating cards: done-ness is derived, so ask effectiveDone on both sides
    // rather than reading a flag. `doneThen` already comes out of reconstructItemAt
    // that way, as of T's calendar day.
    const repeats = parseRecurrence(item.recurrence).kind !== "none";
    const onThen = completedOnAt(item, evs, tMs);
    const onNow = completedOnAt(item, evs, nowMs);
    const doneThen = before.done;
    const doneNow = repeats
      ? effectiveDone({ recurrence: item.recurrence, completed_on: onNow, done: after.done }, opts.today)
      : after.done;

    const kinds: DiffKind[] = [];
    const details: Partial<Record<DiffKind, string>> = {};
    let parentChanged = false;
    const add = (k: DiffKind, d?: string) => {
      kinds.push(k);
      if (d) details[k] = d;
    };

    if (!bornBefore) {
      // Born inside the window: it arrived with the words it has now, so the edits
      // it took on the way are not news. Whether it got finished — or archived
      // again before the window closed — is.
      add("added");
      if (doneNow) add("done");
      if (archivedNow) add("archived");
    } else if (archivedNow) {
      // Off the board now; whatever else was done to it on the way out is moot.
      add("archived");
    } else {
      if (archivedThen) add("restored");
      if (!doneThen && doneNow) add("done");
      // "Reopened" asks one question of both ends of the window: is it still done
      // TODAY? `doneThen` can't answer it for a repeating card — it is measured as
      // of T's own calendar day (reconstructItemAt), so a card that merely rolled
      // into a new period reads done-then/not-done-now purely because the two sides
      // were judged on different days. Re-judge T's completed_on against the SAME
      // clock as now, and a rollover falls out by itself — no comparing raw dates,
      // which a tick made and undone inside the window would perturb into a false
      // "reopened". Only a card still done for today's period at T, and not done
      // now, was actually un-checked.
      const doneThenAsOfToday = repeats
        ? effectiveDone(
            { recurrence: item.recurrence, completed_on: onThen, done: before.done },
            opts.today,
          )
        : doneThen;
      if (doneThenAsOfToday && !doneNow) add("reopened");
      if (before.list !== after.list) {
        add("moved", `from ${labelOf(before.list)} to ${labelOf(after.list)}`);
      }
      if (before.text !== after.text) add("reworded");
      if (before.details !== after.details) add("details");
      if (before.parent_id !== after.parent_id) {
        parentChanged = true;
        if (after.parent_id) add("nested", `under "${titleOf(after.parent_id)}"`);
        else add("unnested", `out of "${titleOf(before.parent_id as string)}"`);
      }
      if (recurrenceAt(item, evs, tMs) !== item.recurrence) {
        add("recurrence", `to ${describeRecurrence(parseRecurrence(item.recurrence))}`);
      }
    }

    kinds.sort((a, b) => DIFF_KINDS.indexOf(a) - DIFF_KINDS.indexOf(b));

    const windowed = evs.filter((e) => ms(e.at) > tMs && ms(e.at) <= nowMs);
    const at = windowed.length
      ? windowed.reduce((a, b) => (ms(b.at) > ms(a.at) ? b : a)).at
      : null;

    // An archived card is remembered by the name it had when it went: reconstruct
    // at the archive moment so a later rename can't rewrite the epitaph.
    const archivedAt = archivedNow
      ? evs.filter((e) => e.field === "archived" && asBool(e.new_value)).sort(newestFirst)[0]
      : undefined;
    const title = archivedAt ? reconstructItemAt(item, evs, archivedAt.at).text : item.text;

    computed.set(item.id, {
      kinds,
      details,
      title,
      at,
      // Where the card hangs NOW, and whether that changed inside the window. A card
      // that moved INTO or OUT OF a parent keeps its own line either way — rolling it
      // up would swallow the very fact it carries ("nested under …") and would count
      // it as a sub-card of a parent it didn't have at T.
      parentId: after.parent_id,
      parentChanged,
    });
  }

  // ---- roll sub-cards up under their parent --------------------------------
  // A parent line carries counts ("2 sub-cards done") instead of its children
  // getting rows of their own — the board never shows sub-cards as cards either.
  // Only added/done/archived roll up; a sub-card that was merely reworded is the
  // parent's business, not the ledger's. A sub-card whose parent isn't on the
  // books (deleted, or archived at both ends) is dropped with it.

  // A row survives as a line of its own if it's a board card now, or if it moved
  // into / out of a parent inside the window (that fact IS its line).
  const keepsOwnLine = (row: Computed) => row.parentId === null || row.parentChanged;

  // Nesting goes deeper than one level (lib/nesting.ts), so a sub-card's tally
  // belongs to the nearest ANCESTOR that still has a line — counting it on an
  // intermediate parent whose own row is rolled away would lose it entirely.
  // Returns null when the walk leaves the books, or meets a cycle.
  const ledgerAncestorOf = (row: Computed): string | null => {
    const seen = new Set<string>();
    let id = row.parentId;
    while (id) {
      if (seen.has(id) || hidden.has(id) || !byId.has(id)) return null;
      seen.add(id);
      const parent = computed.get(id);
      if (!parent) return null;
      if (keepsOwnLine(parent)) return id;
      id = parent.parentId;
    }
    return null;
  };

  // Resolved against the whole map before anything is removed from it, so a child
  // can still see the ancestors it is climbing past.
  const rolledUp = new Map<string, string | null>();
  for (const [id, row] of computed) {
    if (!keepsOwnLine(row)) rolledUp.set(id, ledgerAncestorOf(row));
  }

  const subCounts = new Map<string, DiffSubCounts>();
  const subAt = new Map<string, string>();
  for (const [id, parentId] of rolledUp) {
    const row = computed.get(id) as Computed;
    computed.delete(id);
    if (!parentId) continue;
    const tally = subCounts.get(parentId) ?? { ...EMPTY_SUB_COUNTS };
    for (const k of row.kinds) {
      if ((SUB_COUNT_KINDS as readonly string[]).includes(k)) tally[k as SubCountKind] += 1;
    }
    subCounts.set(parentId, tally);
    const prev = subAt.get(parentId);
    if (row.at && (!prev || ms(row.at) > ms(prev))) subAt.set(parentId, row.at);
  }

  const entries: DiffEntry[] = [];
  for (const [id, row] of computed) {
    const sub = subCounts.get(id);
    const subPhrases = sub ? subCountPhrases(sub) : [];
    if (row.kinds.length === 0 && subPhrases.length === 0) continue;
    const childAt = subAt.get(id) ?? null;
    entries.push({
      id,
      title: row.title,
      kinds: row.kinds,
      details: row.details,
      phrase: [...row.kinds.map((k) => diffKindPhrase(k, row.details[k])), ...subPhrases].join(", "),
      at: row.at && childAt ? (ms(childAt) > ms(row.at) ? childAt : row.at) : (row.at ?? childAt),
      ...(subPhrases.length > 0 ? { subCounts: sub } : {}),
    });
  }

  // Grouped by what happened, in kind order — the ledger's whole shape. Inside a
  // kind, most recent first; a sub-count-only parent sorts after every kind.
  const rank = (e: DiffEntry) => (e.kinds.length ? DIFF_KINDS.indexOf(e.kinds[0]) : DIFF_KINDS.length);
  entries.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.at ? ms(b.at) : 0) - (a.at ? ms(a.at) : 0) ||
      a.title.localeCompare(b.title),
  );

  const counts = Object.fromEntries(DIFF_KINDS.map((k) => [k, 0])) as Record<DiffKind, number>;
  for (const e of entries) {
    for (const k of e.kinds) counts[k] += 1;
    if (e.subCounts) for (const k of SUB_COUNT_KINDS) counts[k] += e.subCounts[k];
  }

  return {
    from: tIso,
    to: nowIso,
    entries,
    counts,
    summary: DIFF_KINDS.filter((k) => counts[k] > 0).map((k) => ({
      kind: k,
      count: counts[k],
      phrase: `${counts[k]} ${DIFF_KIND_PHRASE[k]}`,
    })),
  };
}
