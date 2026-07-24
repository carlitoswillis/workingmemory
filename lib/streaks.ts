// Streaks for daily tasks, computed from the event log (items_log_completed_on
// events in lib/schema.ts). Pure — safe on server and client.
//
// The log is value-based: checking a daily task writes new_value = the local
// YYYY-MM-DD being completed; unchecking writes new_value = null with the
// cleared date in old_value. Replaying chronologically therefore yields the
// exact set of days that ended up checked, regardless of the event's own
// timestamp (late-night check-offs land on the day the UI said, not the UTC
// day the write happened).

// .ts extension so plain-node tests can import this module (see lib/columns.ts).
import { addDays, parseRecurrence, periodStart, type Recurrence } from "./recurrence.ts";

export interface CompletedOnEvent {
  field: string | null;
  old_value: string | null;
  new_value: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The set of local days a daily task was (and stayed) checked off. `current`
// is the item's live completed_on — it seeds the set for items whose history
// predates the completed_on trigger.
export function completedDays(
  events: CompletedOnEvent[],
  current: string | null,
): Set<string> {
  const days = new Set<string>();
  for (const e of events) {
    if (e.field !== "completed_on") continue;
    if (e.new_value && DATE_RE.test(e.new_value)) days.add(e.new_value);
    else if (e.old_value) days.delete(e.old_value);
  }
  if (current && DATE_RE.test(current)) days.add(current);
  return days;
}

// YYYY-MM-DD minus one day (UTC arithmetic on the date parts — no TZ involved).
export function prevDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) - 86_400_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
    t.getUTCDate(),
  ).padStart(2, "0")}`;
}

// Consecutive run of completed days ending today — or ending yesterday when
// today isn't checked yet (an unfinished today shouldn't read as a broken
// streak until the day is actually over).
export function currentStreak(days: Set<string>, today: string): number {
  let cursor = days.has(today) ? today : prevDay(today);
  let n = 0;
  while (days.has(cursor)) {
    n++;
    cursor = prevDay(cursor);
  }
  return n;
}

// The weekly equivalent: consecutive weekly periods with a check-off in them, ending
// with the current one — or with the previous one when this week's hasn't happened
// yet (an unfinished week shouldn't read as a broken streak until it's over).
export function weeklyStreak(days: Set<string>, today: string, weekday: number): number {
  const checkedIn = (start: string) => {
    for (let i = 0; i < 7; i++) if (days.has(addDays(start, i))) return true;
    return false;
  };
  const thisPeriod = periodStart(today, weekday);
  let cursor = checkedIn(thisPeriod) ? thisPeriod : addDays(thisPeriod, -7);
  let n = 0;
  while (checkedIn(cursor)) {
    n++;
    cursor = addDays(cursor, -7);
  }
  return n;
}

// One call for either kind — how many days/weeks running is this card done?
export function streakFor(days: Set<string>, today: string, rec: Recurrence): number {
  if (rec.kind === "daily") return currentStreak(days, today);
  if (rec.kind === "weekly") return weeklyStreak(days, today, rec.weekday);
  return 0;
}

// Fold the LIVE checkbox into the historical day set, so a streak display tracks an
// optimistic toggle instead of waiting for the refetch. Daily: today is in or out.
// Weekly: the whole current period is replaced by whatever the checkbox now says.
export function daysWithLiveCheck(
  days: Iterable<string>,
  today: string,
  recurrence: string,
  checked: boolean,
  completedOn: string | null,
): Set<string> {
  const rec = parseRecurrence(recurrence);
  const out = new Set(days);
  if (rec.kind === "daily") {
    if (checked) out.add(today);
    else out.delete(today);
  } else if (rec.kind === "weekly") {
    const start = periodStart(today, rec.weekday);
    for (let i = 0; i < 7; i++) out.delete(addDays(start, i));
    if (checked) out.add(completedOn ?? today);
  }
  return out;
}
