"use client";

import { useMemo, useState } from "react";
import Dateline from "./Dateline";

// The desktop dateline. The moment you are looking at is the title of the page —
// "Now" in Fraunces roman, the date in Fraunces italic once you rewind — and the
// ruler of real changes under it is the control: drag it (it soft-snaps to the
// nearest real change on release), step change-to-change with ← →, or jump with a
// relative chip. The exact-time input is still here, tucked into "exact time…".
// The board re-renders live as you move — reconstruction is local.
//
// What used to be here and is not any more: a rounded box around the whole thing,
// a 13px "Time machine" / "Remembering" label, two 24×24 ‹ › steppers, a "drag to
// rewind" hint, and a second 12px readout of the moment in the corner. The moment
// is stated once, at 36px, and everything else is the ruler.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const fmtMoment = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const fmtToday = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

// Value for the <input type="datetime-local"> (local wall-clock, no timezone suffix).
function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

export default function TimeMachineBar({
  markers,
  minMs,
  nowMs,
  valueMs,
  active,
  loading,
  onPick,
  onLive,
}: {
  markers: number[]; // sorted, distinct ms of every recorded change
  minMs: number;
  nowMs: number;
  valueMs: number | null; // current rewind moment, or null when live
  active: boolean;
  loading: boolean;
  onPick: (ms: number) => void;
  onLive: () => void;
}) {
  const [exactOpen, setExactOpen] = useState(false);
  const range = Math.max(1, nowMs - minMs);
  const current = valueMs ?? nowMs;

  // Snap a raw scrub position to the nearest change within ~1.5% of the timeline.
  function snap(ms: number): number {
    const threshold = range * 0.015;
    let best = ms;
    let bestD = Infinity;
    for (const m of markers) {
      const d = Math.abs(m - ms);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return bestD <= threshold ? best : ms;
  }

  function stepTo(dir: -1 | 1) {
    const next =
      dir < 0
        ? [...markers].reverse().find((m) => m < current - 1)
        : markers.find((m) => m > current + 1);
    if (next != null) onPick(next);
    else if (dir > 0) onLive(); // stepping past the last change = back to now
  }

  const chips = useMemo(
    () => [
      { label: "1h ago", ms: nowMs - HOUR },
      { label: "6h ago", ms: nowMs - 6 * HOUR },
      { label: "yesterday", ms: nowMs - DAY },
      { label: "last week", ms: nowMs - 7 * DAY },
    ],
    [nowMs],
  );

  return (
    <div className="mb-8">
      <Dateline
        size="desktop"
        eyebrow={active ? "As it was" : fmtToday(nowMs)}
        moment={active ? fmtMoment(current) : "Now"}
        nowMs={nowMs}
        minMs={minMs}
        markers={markers}
        valueMs={valueMs}
        disabled={loading}
        onPick={onPick}
        onSnap={(ms) => onPick(snap(ms))}
        onStep={stepTo}
      />

      {/* Relative jumps, the exact-time fallback, and the way back. */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button
            key={c.label}
            onClick={() => onPick(Math.max(minMs, c.ms))}
            disabled={loading}
            className="wm-dl-chip"
          >
            {c.label}
          </button>
        ))}

        <button onClick={() => setExactOpen((v) => !v)} className="wm-dl-quiet">
          exact time…
        </button>
        {exactOpen && (
          <input
            type="datetime-local"
            value={toLocalInput(current)}
            max={toLocalInput(nowMs)}
            onChange={(e) => {
              const ms = e.target.value ? new Date(e.target.value).getTime() : NaN;
              if (Number.isFinite(ms)) onPick(ms);
            }}
            className="wm-dl-exact"
          />
        )}

        {active && (
          <button onClick={onLive} className="wm-dl-return ml-auto">
            <span className="wm-dl-return__dot" aria-hidden />
            Back to now
          </button>
        )}
      </div>
    </div>
  );
}
