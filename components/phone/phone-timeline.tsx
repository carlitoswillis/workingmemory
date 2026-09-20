"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { timelineDataAction } from "@/app/actions";
import type { Item, ItemEvent } from "@/lib/types";
import { useBoardId } from "../board-context";

// The board's event log, fetched once per phone session and shared.
//
// It used to be the time sheet's private business, because the sheet was the only
// thing that knew the board had a history. Now the Now screen's topbar IS the
// dateline — eyebrow, moment, and a ruler of every real change — so the shell needs
// the same markers the sheet scrubs. One fetch, after paint, read by both; without
// a provider the sheet still fetches for itself, so it stays correct standing alone.

export type Timeline = { items: Item[]; events: ItemEvent[] } | null;

const TimelineContext = createContext<{ timeline: Timeline; provided: boolean }>({
  timeline: null,
  provided: false,
});

export function PhoneTimelineProvider({ children }: { children: React.ReactNode }) {
  const boardId = useBoardId();
  const [timeline, setTimeline] = useState<Timeline>(null);
  useEffect(() => {
    // `null` is a legitimate board id here — it means "the board this request already
    // resolved", which is exactly the case on the demo board. Guarding on it is how
    // the ruler came up with no ticks the first time.
    let alive = true;
    timelineDataAction(boardId).then((d) => alive && setTimeline(d));
    return () => {
      alive = false;
    };
  }, [boardId]);
  const value = useMemo(() => ({ timeline, provided: true }), [timeline]);
  return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>;
}

export function usePhoneTimeline(): { timeline: Timeline; provided: boolean } {
  return useContext(TimelineContext);
}

// Every distinct moment the board actually changed, at or before `now`: the ruler's
// ticks and the scrubber's snap points, derived the one way.
export function markersOf(timeline: Timeline, now: number): number[] {
  if (!timeline) return [];
  const set = new Set<number>();
  for (const e of timeline.events) set.add(new Date(e.at).getTime());
  return [...set].filter((m) => m <= now).sort((a, b) => a - b);
}
