// The ONE clock. "Today" decides whether a repeating card is done (lib/recurrence.ts
// effectiveDone), which day a check-off is written under (the apps AND the Shortcut's
// POST /api/items/done), and how the time machine judges a past moment. It used to be
// three clocks: the browser's zone, the server's zone (UTC on Render, during SSR) and a
// hard-coded Los Angeles in the bridge — so a check-off made at 10:30 pm PT counted as
// "yesterday" for a phone in another zone and was ticked twice.
//
// Every caller now asks here, on server and client alike. The zone is the BOARD's zone,
// not the viewer's: NEXT_PUBLIC_BOARD_TZ (inlined at build, so both sides agree),
// default America/Los_Angeles. An unknown zone name falls back to the default.
//
// Pure and client-safe (Intl only).

export const DEFAULT_BOARD_TZ = "America/Los_Angeles";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function boardTimeZone(): string {
  const raw = process.env.NEXT_PUBLIC_BOARD_TZ;
  if (!raw) return DEFAULT_BOARD_TZ;
  try {
    formatterFor(raw);
    return raw;
  } catch {
    return DEFAULT_BOARD_TZ;
  }
}

// The calendar date (YYYY-MM-DD) of an instant in `tz` (default: the board's zone).
export function boardDayOf(instant: Date | string | number, tz: string = boardTimeZone()): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  return formatterFor(tz).format(d);
}

// Today in the board's zone. The single source of "today" for done-ness.
export function boardToday(now: Date = new Date(), tz: string = boardTimeZone()): string {
  return boardDayOf(now, tz);
}
