"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { timelineDataAction } from "@/app/actions";
import type { Item, ItemEvent } from "@/lib/types";
import { useBoardId } from "../board-context";
import { timelineRevision } from "./phone-logic";

// The board's event log, fetched after paint and again whenever the live board changes, shared.
//
// It used to be the time sheet's private business, because the sheet was the only
// thing that knew the board had a history. Now the Now screen's topbar IS the
// dateline — eyebrow, moment, and a ruler of every real change — so the shell needs
// the same markers the sheet scrubs. One fetch, after paint, read by both; without
// a provider the sheet still fetches for itself, so it stays correct standing alone.

export type Timeline = { items: Item[]; events: ItemEvent[] } | null;

const TimelineContext = createContext<{ timeline: Timeline; provided: boolean; now: number }>({
  timeline: null,
  provided: false,
  now: 0,
});

export function PhoneTimelineProvider({
  children,
  items,
}: {
  children: React.ReactNode;
  items: { id: string; updated_at: string }[];
}) {
  const boardId = useBoardId();
  const [timeline, setTimeline] = useState<Timeline>(null);
  // "Now" is the moment the log was last fetched, so the right-hand end of the ruler
  // and "Board then" at its end include everything done this session.
  const [now, setNow] = useState(() => Date.now());
  const revision = timelineRevision(items);
  useEffect(() => {
    // `null` is a legitimate board id here — it means "the board this request already
    // resolved", which is exactly the case on the demo board. Guarding on it is how
    // the ruler came up with no ticks the first time.
    let alive = true;
    timelineDataAction(boardId).then((d) => {
      if (!alive) return;
      setTimeline(d);
      setNow(Date.now());
    });
    return () => {
      alive = false;
    };
  }, [boardId, revision]);
  const value = useMemo(() => ({ timeline, provided: true, now }), [timeline, now]);
  return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>;
}

export function usePhoneTimeline(): { timeline: Timeline; provided: boolean; now: number } {
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
