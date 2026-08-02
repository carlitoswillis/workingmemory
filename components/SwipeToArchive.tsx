"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

// Swipe a card left to archive it — PHONES ONLY (< sm), where the columns stack and
// nothing else wants a horizontal drag. On the desktop rail a sideways drag belongs
// to the rail, so the gesture stays off and the card panel's Archive button remains
// the way in.
//
// Deliberately hard to do by accident (owner: "the swipe should be extreme so we
// don't accidentally delete stuff"): you must pull the card past HALF its own width,
// and even then nothing is archived — the card just rests open over an Archive
// button you still have to tap. Anything shorter springs back.
//
// Coexisting with dnd-kit: Board's TouchSensor arms after a 150ms hold and aborts if
// the finger moves more than 8px in that window. So we only claim a gesture that
// clears SLOP (> that 8px tolerance) within CLAIM_MS (< that delay) — a prompt
// sideways flick is ours, a slow press-then-move is the drag sensor's, and the two
// can never both be running. `touch-pan-y` keeps the page scrolling vertically
// while taking the horizontal axis away from the browser.
const OPEN_W = 108; // px of Archive button showing once the card rests open
const OVERPULL = 56; // how far past the commit point the pull can go before it bottoms out
const SLOP = 10;
const CLAIM_MS = 150;
// Only one card sits open at a time: opening broadcasts, everyone else closes.
const OPEN_EVENT = "wm:swipe-open";
const GLIDE = "transform 0.22s cubic-bezier(0.2,0.7,0.2,1)";

// What moves is the card, not the words on it (owner: "the card should appear to
// swipe but the text should stay still"). The frame slides; anything wrapped in
// <SwipeStill> takes the exact opposite translation, so it holds its place on
// screen while the card travels out from under it. The card clips its own
// overflow, so the still content is revealed away by the passing right edge
// instead of spilling over the Archive button.
const SwipeCtx = createContext({ x: 0, gliding: true });

export function SwipeStill({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { x, gliding } = useContext(SwipeCtx);
  return (
    <div
      className={className}
      style={{
        transform: x ? `translateX(${-x}px)` : undefined,
        transition: gliding ? GLIDE : undefined,
      }}
    >
      {children}
    </div>
  );
}

export default function SwipeToArchive({
  id,
  onArchive,
  children,
}: {
  id: string;
  onArchive: () => void;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0); // ≤ 0: px the card is pulled left
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false); // pulled past half — releasing now holds it open
  const [gliding, setGliding] = useState(true); // transition off while the finger drives
  const [archiving, setArchiving] = useState(false);
  // Live offset for the touchend read, and the in-flight gesture.
  const offRef = useRef(0);
  const g = useRef({ x: 0, y: 0, t: 0, base: 0, axis: "" as "" | "x" | "y", swiped: false });

  function slide(px: number) {
    offRef.current = px;
    setOffset(px);
  }
  function close() {
    setOpen(false);
    setArmed(false);
    setGliding(true);
    slide(0);
  }

  useEffect(() => {
    const h = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) close();
    };
    window.addEventListener(OPEN_EVENT, h);
    return () => window.removeEventListener(OPEN_EVENT, h);
  }, [id]);

  function onTouchStart(e: React.TouchEvent) {
    if (archiving || e.touches.length !== 1) return;
    if (!window.matchMedia("(max-width: 639px)").matches) return;
    const t = e.touches[0];
    g.current = {
      x: t.clientX,
      y: t.clientY,
      t: Date.now(),
      base: open ? -OPEN_W : 0,
      axis: "",
      swiped: false,
    };
  }

  function onTouchMove(e: React.TouchEvent) {
    const s = g.current;
    const t = e.touches[0];
    if (s.axis === "y" || !s.t || !t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      // Sideways, and quick enough that the drag sensor has already let go.
      s.axis = Math.abs(dx) > Math.abs(dy) && Date.now() - s.t < CLAIM_MS ? "x" : "y";
      if (s.axis === "y") return;
      setGliding(false);
    }
    s.swiped = true;
    const w = wrapRef.current?.offsetWidth ?? 0;
    slide(Math.max(-(w / 2 + OVERPULL), Math.min(0, s.base + dx)));
    setArmed(-offRef.current >= w / 2);
  }

  function onTouchEnd() {
    const s = g.current;
    s.t = 0;
    if (s.axis !== "x") return;
    setGliding(true);
    const past = -offRef.current >= (wrapRef.current?.offsetWidth ?? 0) / 2;
    setOpen(past);
    setArmed(false);
    slide(past ? -OPEN_W : 0);
    if (past) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
  }

  function archive() {
    setArchiving(true);
    setGliding(true);
    slide(-(wrapRef.current?.offsetWidth ?? 400));
    onArchive();
  }

  const still = useMemo(() => ({ x: offset, gliding }), [offset, gliding]);

  return (
    <div ref={wrapRef} className="relative overflow-hidden rounded-lg">
      <div
        aria-hidden={!open}
        className={`absolute inset-y-0 right-0 flex ${open ? "" : "pointer-events-none"}`}
        style={{ width: Math.max(OPEN_W, -offset) }}
      >
        <button
          tabIndex={open ? 0 : -1}
          onClick={archive}
          className={`flex w-full flex-col items-center justify-center gap-1 rounded-lg border bg-[var(--surface-2)] text-[10px] uppercase tracking-[0.14em] transition-colors ${
            armed || open
              ? "border-[var(--past)] text-[var(--past)]"
              : "border-[var(--veil-soft)] text-[var(--text-lo)]"
          }`}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
            <path
              d="M1.8 3.4h12.4v2.4H1.8zM3 5.8h10V13H3zM6.2 8.6h3.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Archive
        </button>
      </div>

      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClickCapture={(e) => {
          // The tap that ends a swipe must not also open the card; while the card
          // rests open, a tap on it just puts it back.
          if (!g.current.swiped && !open) return;
          e.preventDefault();
          e.stopPropagation();
          g.current.swiped = false;
          if (open) close();
        }}
        className={`relative touch-pan-y sm:touch-auto ${archiving ? "opacity-0" : ""}`}
        style={{
          transform: offset ? `translateX(${offset}px)` : undefined,
          transition: gliding ? `${GLIDE}, opacity 0.22s ease` : undefined,
        }}
      >
        <SwipeCtx.Provider value={still}>{children}</SwipeCtx.Provider>
      </div>
    </div>
  );
}
