"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// ── The Dateline ────────────────────────────────────────────────────────────
// The moment you are looking at IS the title of the screen, and the ruler of real
// changes under it is the control. One word carries the whole state: "Now" in
// Fraunces roman while you are live; the date in Fraunces italic the instant you
// scrub. Nothing else changes register — no filter over the board, no wash, no
// second label, no hint paragraph.
//
// The ruler is a hairline with one 1×8px tick per real change (binned to one per
// 2px so a busy board reads as rhythm, not as a gray bar), a 12px amber dot for
// "now" that slides to where you are, and the then-blue filling the track behind
// it. Amber = the present, blue = the past; both are graphics here, never text.
//
// Two shells, one object: `desktop` renders it at 36px across the page's live
// width with a draggable range over the track; `phone` renders it at 26px, and
// when it is given `onTap` instead of `onPick` the whole 44px band is one tap
// target (the Now screen's topbar) rather than a scrubber you could nudge by
// accident while scrolling.

export type DatelineSize = "phone" | "desktop";

export type RulerProps = {
  nowMs: number;
  minMs: number;
  markers: number[]; // sorted, distinct ms of every recorded change
  valueMs: number | null; // null = live
  size?: DatelineSize;
  disabled?: boolean;
  onPick?: (ms: number) => void; // drag / arrow → a moment
  onStep?: (dir: -1 | 1) => void; // ← → → change-to-change
  onSnap?: (ms: number) => void; // pointer release → nearest real change
  onTap?: () => void; // tap-only band (phone topbar)
  label?: string;
  valueText?: string;
};

// The track's nominal live width per shell, used for SSR and the first client
// paint so tick positions never cause a hydration mismatch; the real width is
// measured right after mount and takes over.
const NOMINAL: Record<DatelineSize, number> = { desktop: 1360, phone: 358 };
const THUMB = 12;

export default function Dateline({
  size,
  eyebrow,
  moment,
  ruler = true,
  ...rest
}: RulerProps & {
  size: DatelineSize;
  eyebrow: string;
  moment: string;
  ruler?: boolean;
}) {
  const active = rest.valueMs != null;
  return (
    <div className={`wm-dateline wm-dateline--${size}`}>
      <p className="wm-dateline__eyebrow" suppressHydrationWarning>
        {eyebrow}
      </p>
      <p
        className={`wm-dateline__moment${active ? " wm-dateline__moment--then" : ""}`}
        suppressHydrationWarning
      >
        {moment}
      </p>
      {ruler && <Ruler size={size} valueText={active ? moment : "Now"} {...rest} />}
    </div>
  );
}

// The ruler alone. On the desktop page and the phone's Now topbar it sits under the
// moment; inside the phone's time sheet it sits in the thumb zone instead, because
// a control you drag belongs where your thumb already is — but it is the same
// object either way, so "the hairline with the amber dot" means one thing.
export function Ruler({
  size = "desktop",
  nowMs,
  minMs,
  markers,
  valueMs,
  disabled = false,
  onPick,
  onStep,
  onSnap,
  onTap,
  label = "Rewind the board",
  valueText,
}: RulerProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(NOMINAL[size]);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth || NOMINAL[size]);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);

  const range = Math.max(1, nowMs - minMs);
  const current = valueMs ?? nowMs;
  const active = valueMs != null;
  const frac = (ms: number) => Math.min(1, Math.max(0, (ms - minMs) / range));
  const x = (ms: number) => frac(ms) * (width - THUMB) + THUMB / 2;

  // One tick per real change, binned to one per 2px: on a three-week board that is
  // rhythm; on a board with hundreds of events it stays a ruler instead of fusing
  // into a solid rule.
  const ticks = useMemo(() => {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const m of markers) {
      const px = Math.round((frac(m) * (width - THUMB)) / 2) * 2;
      if (seen.has(px)) continue;
      seen.add(px);
      out.push(px + THUMB / 2);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, width, minMs, nowMs]);

  return (
    <div className="wm-ruler" ref={trackRef}>
      <span className="wm-ruler__track" aria-hidden />
      {active && <span className="wm-ruler__fill" style={{ width: x(current) }} aria-hidden />}
      {ticks.map((px) => (
        <span
          key={px}
          className={`wm-ruler__tick${active && px <= x(current) ? " wm-ruler__tick--onfill" : ""}`}
          style={{ left: px }}
          aria-hidden
        />
      ))}
      <span className="wm-ruler__thumb" style={{ left: x(current) }} aria-hidden />

      {onPick ? (
        <input
          type="range"
          className="wm-ruler__input"
          min={minMs}
          max={nowMs}
          step={Math.max(1000, Math.round(range / 1000))}
          value={current}
          disabled={disabled}
          onChange={(e) => onPick(Number(e.target.value))}
          onPointerUp={(e) => onSnap?.(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => {
            if (!onStep && onSnap) onSnap(Number((e.target as HTMLInputElement).value));
          }}
          onKeyDown={(e) => {
            if (!onStep) return;
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              onStep(e.key === "ArrowLeft" ? -1 : 1);
            }
          }}
          aria-label={label}
          aria-valuetext={valueText ?? (active ? "" : "Now")}
        />
      ) : (
        <button
          type="button"
          className="wm-ruler__tap"
          data-dateline-tap
          onClick={onTap}
          aria-label={label}
        />
      )}
    </div>
  );
}
