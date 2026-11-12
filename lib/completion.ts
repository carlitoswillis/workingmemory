import type Database from "better-sqlite3";
import type { Item } from "./types";
// .ts extension so plain-node tests can import this module (see lib/columns.ts).
import { effectiveDone, parseRecurrence } from "./recurrence.ts";

// The item COMPLETION machine: the one place that says what "done" means for a card
// and what each transition does to the two stored encodings.
//
//   one-off   (recurrence "none")      state = items.done           (0 | 1)
//   recurring (daily | weekly:<d>)     state = items.completed_on   (a YYYY-MM-DD)
//                                      done today  <=>  completed_on falls in the
//                                      CURRENT period (effectiveDone, lib/recurrence.ts)
//
// For a recurring card `done` is a dead column: nothing reads it. For a one-off card
// `completed_on` is dead. The only way the two meet is when a card switches kind, and
// that is the transition this module owns:
//
//   none      -> recurring   currently done  => completed_on = today  (done for this period)
//                            currently open  => completed_on = null
//                            `done` is left alone (dead now; leaving it keeps history quiet,
//                            and the time machine reverts it correctly if needed)
//   recurring -> none        done = "was it done today" (effectiveDone of the OLD kind);
//                            completed_on is left alone so streak history stays intact
//   recurring -> recurring   nothing to reconcile; the period maths re-reads completed_on
//   same -> same             no-op
//
// Every writer that changes recurrence goes through `recurrenceSwitchPatch`; the check-off
// writers share `checkOffPatch`. Pure — the caller supplies `today` (see lib/clock.ts).

export type CompletionFields = Pick<Item, "recurrence" | "completed_on" | "done">;

// Column values to write (SQLite 0/1 for done). A key that is absent is not touched.
export type CompletionPatch = { done?: 0 | 1; completed_on?: string | null };

export function isRecurring(recurrence: string | null | undefined): boolean {
  return parseRecurrence(recurrence).kind !== "none";
}

// Fields to change when `item` is switched to `nextRecurrence` (already normalized).
// An empty object means nothing needs to move.
export function recurrenceSwitchPatch(
  item: CompletionFields,
  nextRecurrence: string,
  today: string,
): CompletionPatch {
  const from = parseRecurrence(item.recurrence).kind;
  const to = parseRecurrence(nextRecurrence).kind;
  if (from === "none" && to !== "none") {
    return { completed_on: item.done ? today : null };
  }
  if (from !== "none" && to === "none") {
    return { done: effectiveDone(item, today) ? 1 : 0 };
  }
  return {};
}

// Fields to change when a card is checked (done=true) or unchecked for `day`.
// Recurring: check sets completed_on = day; uncheck clears it only when it still equals
// `day` (an old tick must not be erased by a stale uncheck). One-off: flips `done`.
export function checkOffPatch(
  item: Pick<Item, "recurrence" | "completed_on">,
  done: boolean,
  day: string,
): CompletionPatch {
  if (isRecurring(item.recurrence)) {
    if (done) return { completed_on: day };
    return item.completed_on === day ? { completed_on: null } : {};
  }
  return { done: done ? 1 : 0 };
}

// The writer: switch one card's recurrence, reconciling done / completed_on in the SAME
// UPDATE so the per-field history triggers (lib/schema.ts) journal them together. Returns
// false when the card is not on this board.
export function switchRecurrence(
  db: Database.Database,
  boardId: string | null,
  id: string,
  nextRecurrence: string,
  userId: string | null,
  today: string,
): boolean {
  return db.transaction(() => {
    const row = db
      .prepare("select recurrence, completed_on, done from items where id = ? and board_id is ?")
      .get(id, boardId) as { recurrence: string; completed_on: string | null; done: number } | undefined;
    if (!row) return false;
    const patch = recurrenceSwitchPatch(
      { recurrence: row.recurrence, completed_on: row.completed_on, done: row.done === 1 },
      nextRecurrence,
      today,
    );
    db.prepare(
      `update items set recurrence = ?,
         done = coalesce(?, done),
         completed_on = case when ? then ? else completed_on end,
         touched_by = ? where id = ? and board_id is ?`,
    ).run(
      nextRecurrence,
      patch.done ?? null,
      "completed_on" in patch ? 1 : 0,
      patch.completed_on ?? null,
      userId,
      id,
      boardId,
    );
    return true;
  })();
}
