import type { Item, ItemEvent } from "./types";
import type { ListId } from "./lists";

// A reconstructed item as it was at some past moment T.
export interface BoardItemAt {
  id: string;
  text: string;
  details: string;
  list: ListId;
  done: boolean;
  existed: boolean; // was it created on or before T?
  archived: boolean; // was it archived at T?
}

function asBool(v: string | null): boolean {
  return v === "true" || v === "t" || v === "1";
}

const ms = (iso: string) => new Date(iso).getTime();

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
    }
  }

  const created = events.find((e) => e.type === "created");
  const bornAt = created ? ms(created.at) : ms(item.created_at);

  return { id: item.id, text, details, list, done, existed: bornAt <= tt, archived };
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
