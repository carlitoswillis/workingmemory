"use client";

import { useMemo, useState } from "react";

// A fluid rewind control. Instead of only typing an exact date/time, you scrub a
// timeline whose ticks are the real moments your board changed: drag the handle
// (it soft-snaps to the nearest change on release), step change-to-change with the
// arrows, or jump with a relative chip. The exact-time input is still here, tucked
// into "exact time…". The board re-renders live as you move — reconstruction is local.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const fmtMoment = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
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

  const pct = (ms: number) => ((Math.min(nowMs, Math.max(minMs, ms)) - minMs) / range) * 100;

  return (
    <div
      className={`mb-5 rounded-2xl border px-3.5 py-2.5 transition-colors ${
        active
          ? "border-[rgba(110,139,196,0.4)] bg-[rgba(110,139,196,0.08)]"
          : "border-[var(--veil-soft)] bg-[rgba(20,26,46,0.35)]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-sm" aria-hidden>
          🕰
        </span>
        <span className="font-display text-[13px] italic text-[var(--text-mid)]">
          {active ? "Remembering" : "Time machine"}
        </span>

        {/* Step change-to-change */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => stepTo(-1)}
            disabled={loading || markers.length === 0}
            title="Previous change"
            className="grid h-6 w-6 place-items-center rounded-md border border-[var(--veil)] text-xs text-[var(--text-mid)] transition-colors hover:border-[var(--text-lo)] hover:text-[var(--text-hi)] disabled:opacity-40"
          >
            ◀
          </button>
          <button
            onClick={() => stepTo(1)}
            disabled={loading || !active}
            title="Next change"
            className="grid h-6 w-6 place-items-center rounded-md border border-[var(--veil)] text-xs text-[var(--text-mid)] transition-colors hover:border-[var(--text-lo)] hover:text-[var(--text-hi)] disabled:opacity-40"
          >
            ▶
          </button>
        </div>

        {/* The scrubber: a track with a tick per real change. */}
        <div className="relative min-w-[180px] flex-1 py-2">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--veil)]" />
          {/* filled portion up to the current moment */}
          <div
            className="pointer-events-none absolute top-1/2 left-0 h-px -translate-y-1/2"
            style={{ width: `${pct(current)}%`, background: active ? "var(--past)" : "var(--veil)" }}
          />
          {markers.map((m, i) => (
            <span
              key={i}
              aria-hidden
              className="pointer-events-none absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${pct(m)}%`,
                background: active && m <= current ? "var(--past)" : "var(--text-lo)",
                opacity: 0.6,
              }}
            />
          ))}
          <input
            type="range"
            min={minMs}
            max={nowMs}
            step={Math.max(1000, Math.round(range / 1000))}
            value={current}
            disabled={loading}
            onChange={(e) => onPick(Number(e.target.value))}
            onPointerUp={(e) => onPick(snap(Number((e.target as HTMLInputElement).value)))}
            onKeyUp={(e) => onPick(snap(Number((e.target as HTMLInputElement).value)))}
            className="tm-range relative w-full cursor-pointer appearance-none bg-transparent"
            aria-label="Rewind the board"
          />
        </div>

        {active ? (
          <button
            onClick={onLive}
            className="rounded-lg px-3 py-1 text-xs font-medium text-[var(--bg-0)] transition-opacity hover:opacity-90"
            style={{ background: "var(--now)" }}
          >
            ← Back to now
          </button>
        ) : (
          <span className="text-xs text-[var(--text-lo)]">
            {loading ? "loading timeline…" : "drag to rewind"}
          </span>
        )}
      </div>

      {/* Relative jumps + exact-time fallback + the resolved moment. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {chips.map((c) => (
          <button
            key={c.label}
            onClick={() => onPick(Math.max(minMs, c.ms))}
            disabled={loading}
            className="rounded-full border border-[var(--veil-soft)] px-2.5 py-0.5 text-[11px] text-[var(--text-mid)] transition-colors hover:border-[var(--text-lo)] hover:text-[var(--text-hi)] disabled:opacity-40"
          >
            {c.label}
          </button>
        ))}

        <button
          onClick={() => setExactOpen((v) => !v)}
          className="rounded-full px-2 py-0.5 text-[11px] text-[var(--text-lo)] hover:text-[var(--text-mid)]"
        >
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
            className="rounded-lg border border-[var(--veil-soft)] bg-[var(--bg-0)] px-2 py-0.5 text-[11px] text-[var(--text-mid)] [color-scheme:dark] focus:border-[var(--now)] focus:outline-none"
          />
        )}

        {active && (
          <span className="ml-auto font-display text-xs italic text-[var(--past)]">
            as it was · {fmtMoment(current)}
          </span>
        )}
      </div>
    </div>
  );
}
