import type { Item } from "./types";

// Recurring cards. `items.recurrence` is a short string, so adding a kind needs no
// migration: "none" | "daily" | "weekly:<0-6>" (0 = Sunday). Weekly arrived
// 2026-07-23 for weekday routines ("Wednesdays: no car, do laundry") — checked off,
// the card STAYS done until its weekday comes round again, then reopens itself.
//
// Done-ness for a repeating card is derived, never stored: `completed_on` holds the
// local date it was last checked off, and the card counts as done while that date
// falls inside the CURRENT period (today for daily, this week-since-its-weekday for
// weekly). That's what makes the reset automatic — nothing runs at midnight — and
// what lets the time machine ask "was it done back then?" by passing a past date in.

export type Recurrence =
  | { kind: "none" }
  | { kind: "daily" }
  | { kind: "weekly"; weekday: number }; // 0 = Sunday … 6 = Saturday

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Local calendar date as YYYY-MM-DD (the day boundary is the user's local midnight).
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

// Date arithmetic on the date PARTS via UTC, so no timezone can shift a day.
export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + delta * 86_400_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
    t.getUTCDate(),
  ).padStart(2, "0")}`;
}

// 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD.
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function parseRecurrence(raw: string | null | undefined): Recurrence {
  if (raw === "daily") return { kind: "daily" };
  const m = /^weekly:([0-6])$/.exec(raw ?? "");
  if (m) return { kind: "weekly", weekday: Number(m[1]) };
  return { kind: "none" };
}

// The value stored in items.recurrence. Also the normalizer the server action uses:
// anything unrecognised collapses to "none".
export function formatRecurrence(r: Recurrence): string {
  if (r.kind === "daily") return "daily";
  if (r.kind === "weekly") return `weekly:${r.weekday}`;
  return "none";
}

export function describeRecurrence(r: Recurrence): string {
  if (r.kind === "daily") return "Every day";
  if (r.kind === "weekly") return `Every ${WEEKDAYS[r.weekday]}`;
  return "Doesn't repeat";
}

// The first day of the weekly period `day` falls in: the most recent `weekday` on or
// before it. Checking a Wednesday task off on Friday still counts for that Wednesday's
// week — the period runs weekday → the day before the next one.
export function periodStart(day: string, weekday: number): string {
  return addDays(day, -(((weekdayOf(day) - weekday) % 7) + 7) % 7);
}

// Is a repeating card done AS OF `today`? Non-repeating cards just use their flag.
export function effectiveDone(
  item: Pick<Item, "recurrence" | "completed_on" | "done">,
  today: string = localToday(),
): boolean {
  const r = parseRecurrence(item.recurrence);
  if (r.kind === "daily") return item.completed_on === today;
  if (r.kind === "weekly") {
    const on = item.completed_on;
    return !!on && on >= periodStart(today, r.weekday) && on <= today;
  }
  return item.done;
}

// When does a checked-off card come back? Used for the panel's one-line explanation.
export function resetsOn(r: Recurrence, today: string = localToday()): string | null {
  if (r.kind === "daily") return addDays(today, 1);
  if (r.kind === "weekly") return addDays(periodStart(today, r.weekday), 7);
  return null;
}
