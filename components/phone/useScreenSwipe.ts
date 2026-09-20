"use client";

import { useCallback, useEffect, useRef } from "react";
import { haptic } from "./phone-motion";
import { lockAxis, screenSwipeIntent, withinSwipeZone, type ScreenSwipe } from "./phone-logic";

// A swipe that changes the SCREEN — Now → Lists, and the first Lists page back to
// Now. The Lists pager's page-to-page swipe is not this: that one is native
// scroll-snap (see PhoneList.tsx), and this only picks up where the track runs out.
//
// THREE RULES, and every one of them is about not stealing a gesture that already
// belongs to someone:
//
//   1. A row owns its own horizontal swipe (complete / Snooze / Archive), so a touch
//      that starts on a `.phone-row` is never ours. `.phone-row` keeps
//      `touch-action: pan-y` for the same reason on the browser's side, which is
//      what stops a row-drag from ALSO panning the pager underneath it.
//   2. A touch that starts within 28px of either edge is iOS's back gesture.
//   3. The axis lock is the row's (`lockAxis`): until the finger has committed to
//      horizontal we do nothing, and once it has gone vertical we never look again.
//
// TOUCH EVENTS, not pointer events — for the reason written out at length in
// PhoneRow.tsx: iOS Safari cancels a pointer sequence the moment it suspects a pan,
// which is exactly the sequence we need to watch.

export type ScreenSwipeHandlers = {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchCancel: (e: React.TouchEvent) => void;
};

export function useScreenSwipe(
  onSwipe: (dir: Exclude<ScreenSwipe, "none">) => void,
  // Called once, at touch-down, with the element the touch landed on. Return false
  // to sit this gesture out — PhoneList uses it to decline unless the pager is
  // already parked against its left edge.
  canStart?: (target: Element | null) => boolean,
): ScreenSwipeHandlers {
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"pending" | "x">("pending");

  // The callbacks outlive the render that made them, so the latest ones are read
  // from a ref rather than rebuilding every handler on each render.
  const latest = useRef({ onSwipe, canStart });
  useEffect(() => {
    latest.current = { onSwipe, canStart };
  });

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    start.current = null;
    axis.current = "pending";
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (!withinSwipeZone(t.clientX, window.innerWidth)) return;
    const target = t.target instanceof Element ? t.target : null;
    if (target?.closest(".phone-row")) return; // the row's gesture, not ours
    if (latest.current.canStart && !latest.current.canStart(target)) return;
    start.current = { x: t.clientX, y: t.clientY };
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const from = start.current;
    if (!from || axis.current === "x") return;
    const t = e.touches[0];
    if (!t) return;
    const locked = lockAxis(t.clientX - from.x, t.clientY - from.y);
    if (locked === "y") start.current = null; // the scroller keeps it
    else if (locked === "x") axis.current = "x";
  }, []);

  const finish = useCallback((e: React.TouchEvent) => {
    const from = start.current;
    const committed = axis.current === "x";
    start.current = null;
    axis.current = "pending";
    if (!from || !committed) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dir = screenSwipeIntent(t.clientX - from.x);
    if (dir === "none") return;
    haptic(); // best-effort, never load-bearing
    latest.current.onSwipe(dir);
  }, []);

  return { onTouchStart, onTouchMove, onTouchEnd: finish, onTouchCancel: finish };
}
