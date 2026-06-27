import type { Item } from "./types";

// Local calendar date as YYYY-MM-DD (the day boundary is the user's local midnight).
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

// A daily task is "done" only if it was checked off today; otherwise it has reset.
export function effectiveDone(
  item: Pick<Item, "recurrence" | "completed_on" | "done">,
  today: string = localToday(),
): boolean {
  return item.recurrence === "daily" ? item.completed_on === today : item.done;
}
