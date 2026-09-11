"use client";

import { useEffect, useMemo, useState } from "react";
import { timelineDataAction } from "@/app/actions";
import { isSentinelList } from "@/lib/lists";
import { reconstructBoardAt, type BoardItemAt } from "@/lib/timetravel";
import type { Item, ItemEvent } from "@/lib/types";
import { usePhoneUI } from "./PhoneShell";
import PhoneSnapshotCard from "./PhoneSnapshotCard";
import { Sheet, useSheetOpen } from "./Sheet";
import { usePhoneBoardData } from "./phone-data";

// Time travel gets its OWN MODE SCREEN on the phone (§2 G), not the desktop
// TimeMachineBar squeezed under the board. That bar's ‹ › steppers are 24×24 — under
// the 44pt floor, and sitting right beside a track that wraps on a narrow screen, so
// on a phone every one of the three controls is a mis-tap waiting to happen.
//
// What replaces it: the date you're looking at across the top, the board as it was
// filling the middle (read-only — nothing here writes), a full-width scrubber whose
// thumb is 44px sitting in the thumb zone, and one big "Return to now".
//
// Reconstruction is the same client-side replay the desktop does: the whole (small,
// per-board) event log ships once via timelineDataAction, and every scrub position is
// resolved locally by lib/timetravel.ts — no round-trip per tick.

const fmtMoment = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function PhoneTimeTravel() {
  const { close } = usePhoneUI();
  const { open, dismiss } = useSheetOpen();
  const { boardId, listLabels } = usePhoneBoardData();
  const [timeline, setTimeline] = useState<{ items: Item[]; events: ItemEvent[] } | null>(null);
  const [now] = useState(() => Date.now());
  const [valueMs, setValueMs] = useState<number | null>(null); // null = live

  useEffect(() => {
    let alive = true;
    timelineDataAction(boardId).then((d) => alive && setTimeline(d));
    return () => {
      alive = false;
    };
  }, [boardId]);

  // Every distinct moment the board actually changed: the scrubber's snap points.
  const markers = useMemo(() => {
    if (!timeline) return [] as number[];
    const set = new Set<number>();
    for (const e of timeline.events) set.add(new Date(e.at).getTime());
    return [...set].filter((m) => m <= now).sort((a, b) => a - b);
  }, [timeline, now]);

  const minMs = markers[0] ?? now;
  const range = Math.max(1, now - minMs);
  const current = valueMs ?? now;
  const active = valueMs != null;

  // Soft-snap to the nearest real change within ~1.5% of the timeline, so letting go
  // lands on a moment the board actually had rather than between two of them.
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

  const snapshot: BoardItemAt[] = useMemo(() => {
    if (!timeline || !active) return [];
    return reconstructBoardAt(timeline.items, timeline.events, new Date(current).toISOString());
  }, [timeline, active, current]);

  // Every card that existed at this moment, by id — the read-only detail sheet and
  // the parent breadcrumb both resolve through this rather than a second lookup.
  const byId = useMemo(() => {
    const m = new Map<string, BoardItemAt>();
    for (const it of snapshot) m.set(it.id, it);
    return m;
  }, [snapshot]);

  // Sub-cards as of then, keyed by their parent — nested under the parent's row
  // instead of filtered out, so what a card contained at that moment is visible
  // without a second trip.
  const childrenByParent = useMemo(() => {
    const by = new Map<string, BoardItemAt[]>();
    for (const it of snapshot) {
      if (!it.parent_id) continue;
      const arr = by.get(it.parent_id);
      if (arr) arr.push(it);
      else by.set(it.parent_id, [it]);
    }
    return by;
  }, [snapshot]);

  // Grouped the way the phone reads a board: one list after another, top-level only
  // (sub-cards hang off their parent's row, same as the live board never rendering
  // them as rows of their own).
  const grouped = useMemo(() => {
    const by = new Map<string, BoardItemAt[]>();
    for (const it of snapshot) {
      if (it.parent_id) continue;
      if (isSentinelList(it.list)) continue;
      const arr = by.get(it.list);
      if (arr) arr.push(it);
      else by.set(it.list, [it]);
    }
    return [...by.entries()];
  }, [snapshot]);

  // The read-only detail sheet's current subject. Unlike PhoneCardSheet's chain,
  // there's nothing to unwind on an edge-swipe-back — a snapshot is only ever
  // dismissed by ✕ or by drilling to a different card, and its parent is always
  // just whatever `parent_id` says, so one id is enough.
  const [openId, setOpenId] = useState<string | null>(null);
  const openItem = openId ? (byId.get(openId) ?? null) : null;
  const openParent = openItem?.parent_id ? (byId.get(openItem.parent_id) ?? null) : null;
  useEffect(() => {
    if (!active) setOpenId(null);
  }, [active]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()} label="Time travel" heightSvh={96}>
      <div className="wm-sheet__head" style={{ flexDirection: "column", gap: 2 }}>
        <p className="wm-ph-caption">{active ? "As it was" : "Time travel"}</p>
        <p className="wm-ph-title wm-ph-num">
          {timeline == null ? "Loading the timeline…" : active ? fmtMoment(current) : "Now"}
        </p>
      </div>

      {/* The board, read-only, behind the control. Nothing in here is a button. */}
      <div className="wm-sheet__scroll">
        {!active ? (
          <p className="wm-ph-hint">
            Drag the scrubber to rewind. The board redraws as it was at that moment,
            reading only, so nothing you see here can be changed.
          </p>
        ) : grouped.length === 0 ? (
          <p className="wm-ph-hint">The board was empty then.</p>
        ) : (
          grouped.map(([list, rows]) => (
            <section key={list} style={{ marginTop: 18 }}>
              <p className="wm-ph-sect" style={{ padding: 0, display: "flex", gap: 8 }}>
                <span>{listLabels[list] ?? list}</span>
                <span className="wm-ph-num" style={{ color: "var(--text-lo)" }}>
                  {rows.length}
                </span>
              </p>
              <ul style={{ marginTop: 6, marginLeft: -16, marginRight: -16 }}>
                {rows.map((r) => {
                  const kids = childrenByParent.get(r.id) ?? [];
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="wm-ph-past"
                        style={{ width: "100%", textAlign: "left" }}
                        onClick={() => setOpenId(r.id)}
                      >
                        <p
                          className="wm-ph-body wm-ph-clamp2"
                          style={r.done ? { color: "var(--text-lo)" } : undefined}
                        >
                          {r.text}
                        </p>
                        {kids.length > 0 && (
                          <p className="wm-ph-caption" style={{ marginTop: 2 }}>
                            <span className="wm-ph-num">{kids.length}</span> sub-card
                            {kids.length === 1 ? "" : "s"}
                          </p>
                        )}
                      </button>
                      {/* Sub-cards as of then, under their parent — never filtered
                          out, and never their own row on this list either. */}
                      {kids.length > 0 && (
                        <ul>
                          {kids.map((k) => (
                            <li key={k.id}>
                              <button
                                type="button"
                                className="wm-ph-past"
                                style={{
                                  width: "100%",
                                  textAlign: "left",
                                  paddingLeft: 28,
                                  borderLeftColor: "var(--veil)",
                                }}
                                onClick={() => setOpenId(k.id)}
                              >
                                <p
                                  className="wm-ph-body wm-ph-clamp2"
                                  style={k.done ? { color: "var(--text-lo)" } : undefined}
                                >
                                  {k.text}
                                </p>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      {openItem && (
        <PhoneSnapshotCard
          item={openItem}
          parent={openParent}
          listLabels={listLabels}
          childItems={childrenByParent.get(openItem.id) ?? []}
          asOf={active ? new Date(current).toISOString() : null}
          onOpenCard={(id) => setOpenId(id)}
          onClose={() => setOpenId(null)}
        />
      )}

      {/* The control, in the thumb zone. */}
      <div className="wm-sheet__bar" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <input
          type="range"
          className="wm-ph-scrub"
          min={minMs}
          max={now}
          step={Math.max(1000, Math.round(range / 1000))}
          value={current}
          disabled={timeline == null}
          onChange={(e) => setValueMs(Number(e.target.value))}
          onPointerUp={(e) => setValueMs(snap(Number((e.target as HTMLInputElement).value)))}
          onKeyUp={(e) => setValueMs(snap(Number((e.target as HTMLInputElement).value)))}
          aria-label="Rewind the board"
          aria-valuetext={active ? fmtMoment(current) : "Now"}
        />
        <button
          type="button"
          className={`wm-ph-btn ${active ? "wm-ph-btn--primary" : ""}`}
          onClick={() => (active ? setValueMs(null) : dismiss())}
        >
          {active ? "Return to now" : "Close"}
        </button>
      </div>
    </Sheet>
  );
}
