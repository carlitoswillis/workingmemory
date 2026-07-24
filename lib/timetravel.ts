import type { Item, ItemEvent } from "./types";
import type { ListId } from "./lists";
// .ts extension so plain-node tests can import this module (see lib/columns.ts).
import { effectiveDone } from "./recurrence.ts";

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
  const byItem = new Map<string, ItemEvent[]>();
  for (const e of events) {
    const arr = byItem.get(e.item_id);
    if (arr) arr.push(e);
    else byItem.set(e.item_id, [e]);
  }
  return items
    .map((it) => reconstructItemAt(it, byItem.get(it.id) ?? [], t))
    .filter((s) => s.existed && !s.archived);
}
