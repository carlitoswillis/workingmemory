"use client";

import { addDays, periodStart, type Recurrence } from "@/lib/recurrence";
import { prevDay } from "@/lib/streaks";

// The card sheet's streak history, mirroring CardPanel.tsx's recent-history strip
// (~859-874) but as its own component so PhoneCardSheet only needs one small call —
// see the note at the top of that file about keeping shared files' diffs localised.
// Oldest → now, one box per day (daily) or week (weekly); filled = done. CSS boxes,
// no emoji, no glyph — the same rule as the rest of the phone UI.

export default function PhoneStreakStrip({
  dayset,
  today,
  rec,
}: {
  dayset: Set<string>;
  today: string;
  rec: Recurrence;
}) {
  if (rec.kind === "none") return null;

  const recent: { key: string; done: boolean; title: string }[] = [];
  if (rec.kind === "daily") {
    let d = today;
    for (let i = 0; i < 14; i++) {
      recent.unshift({ key: d, done: dayset.has(d), title: d });
      d = prevDay(d);
    }
  } else {
    let start = periodStart(today, rec.weekday);
    for (let i = 0; i < 8; i++) {
      const done = Array.from({ length: 7 }, (_, k) => addDays(start, k)).some((d) =>
        dayset.has(d),
      );
      recent.unshift({ key: start, done, title: `week of ${start}` });
      start = addDays(start, -7);
    }
  }

  return (
    <div className="wm-ph-streak-strip" role="img" aria-label={describeStrip(recent, rec)}>
      {recent.map((r) => (
        <span
          key={r.key}
          title={`${r.title}${r.done ? " — done" : ""}`}
          className={`wm-ph-streak-box${r.done ? " is-done" : ""}${
            rec.kind === "weekly" ? " is-week" : ""
          }`}
        />
      ))}
    </div>
  );
}

function describeStrip(
  recent: { done: boolean }[],
  rec: Recurrence,
): string {
  const n = recent.filter((r) => r.done).length;
  const unit = rec.kind === "weekly" ? "weeks" : "days";
  return `${n} of the last ${recent.length} ${unit} done`;
}
