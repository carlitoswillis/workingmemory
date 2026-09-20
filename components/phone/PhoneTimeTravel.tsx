"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { timelineDataAction } from "@/app/actions";
import { isSentinelList } from "@/lib/lists";
import { localToday } from "@/lib/recurrence";
import {
  diffBoardSince,
  nothingChangedPhrase,
  reconstructBoardAt,
  type BoardDiff,
  type BoardItemAt,
} from "@/lib/timetravel";
import type { Item, ItemEvent } from "@/lib/types";
import Dateline, { Ruler } from "../Dateline";
import { usePhoneUI } from "./PhoneShell";
import PhoneSnapshotCard from "./PhoneSnapshotCard";
import { Sheet, useSheetOpen } from "./Sheet";
import { usePhoneBoardData } from "./phone-data";
import { markersOf, usePhoneTimeline } from "./phone-timeline";

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

// The relative jumps, as on the desktop bar (TimeMachineBar.tsx's chips). Dragging is
// how you browse; these are how you ASK — "where was this an hour ago" is a question,
// not a search, and freehand-dragging a scrubber to a specific hour on a 375px track
// is the wrong instrument for it. A jump lands on the same soft-snapped moment the
// scrubber would, and is clamped to the board's first recorded change, because there
// is nothing to show before that.
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const JUMPS = [
  { label: "1h ago", back: HOUR },
  { label: "6h ago", back: 6 * HOUR },
  { label: "Yesterday", back: DAY },
  { label: "Last week", back: 7 * DAY },
];

// Live, the head says what day it is, exactly as the Now screen's does. "As it was"
// over the word "Now" was a contradiction the first render caught.
const fmtToday = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

const fmtMoment = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function PhoneTimeTravel() {
  const { close, pushLevel, goBackLevels } = usePhoneUI();
  const { open } = useSheetOpen();
  const { boardId, listLabels } = usePhoneBoardData();
  const shared = usePhoneTimeline();
  const [own, setOwn] = useState<{ items: Item[]; events: ItemEvent[] } | null>(null);
  const timeline = shared.provided ? shared.timeline : own;
  const [now] = useState(() => Date.now());
  const [valueMs, setValueMs] = useState<number | null>(null); // null = live
  // "Board then" vs "What changed" — a view of the same scrubbed moment, not a
  // second control. Plain state: the sheet remounts fresh every time it opens
  // (PhoneSheetHost), which is exactly "persists for the sheet's life only".
  const [mode, setMode] = useState<"then" | "diff">("then");

  useEffect(() => {
    if (shared.provided) return; // the shell already fetched it
    let alive = true;
    timelineDataAction(boardId).then((d) => alive && setOwn(d));
    return () => {
      alive = false;
    };
  }, [boardId, shared.provided]);

  // Every distinct moment the board actually changed: the ruler's ticks and the
  // scrubber's snap points.
  const markers = useMemo(() => markersOf(timeline, now), [timeline, now]);

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

  // Reconstructed at `current` whether or not you have moved: with the thumb at the
  // right-hand end that IS the board as it is, so the sheet opens onto the board you
  // were just looking at rather than onto a paragraph explaining the scrubber.
  const snapshot: BoardItemAt[] = useMemo(() => {
    if (!timeline) return [];
    return reconstructBoardAt(timeline.items, timeline.events, new Date(current).toISOString());
  }, [timeline, current]);

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

  // "What changed": the ledger between the scrubbed moment and now. Same inputs the
  // snapshot above reconstructs from — diffBoardSince does its own before/after
  // reconstruction internally, so this is the only other place the timeline is read.
  const diff: BoardDiff | null = useMemo(() => {
    if (!timeline) return null;
    return diffBoardSince(
      timeline.items,
      timeline.events,
      new Date(current).toISOString(),
      new Date(now).toISOString(),
      { listLabels, today: localToday() },
    );
  }, [timeline, current, now, listLabels]);

  // ---- the read-only detail card, and its history -------------------------------
  // Drilling into a past card is a step FORWARD, so it owes the browser an entry:
  // without one, the single back gesture that should have put the snapshot away closed
  // the whole Time travel sheet instead, and the moment you had scrubbed to went with
  // it. So this plays by the same rules the card sheet does (PhoneCardSheet's chain) —
  // the shell owns every entry, this file only says what a level undoes, and nothing
  // here reads or writes `history.state` itself.
  //
  // `snapStack` is the cards drilled through, bottom first: a ref because the shell
  // runs these callbacks outside React's update cycle, and each level's undo restores
  // the chain as it was before that card was opened.
  const snapStack = useRef<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const openItem = openId ? (byId.get(openId) ?? null) : null;
  const openParent = openItem?.parent_id ? (byId.get(openItem.parent_id) ?? null) : null;

  const openSnapshot = useCallback(
    (id: string) => {
      const prev = snapStack.current;
      // Tapping the breadcrumb goes BACK to a card already in the chain; let the
      // browser unwind those entries so the gesture and the button are one path.
      const at = prev.indexOf(id);
      if (at >= 0) {
        goBackLevels(prev.length - 1 - at);
        return;
      }
      snapStack.current = [...prev, id];
      setOpenId(id);
      pushLevel(() => {
        snapStack.current = prev;
        setOpenId(prev.length > 0 ? prev[prev.length - 1] : null);
      });
    },
    [pushLevel, goBackLevels],
  );

  // ✕ gives every snapshot entry back at once and leaves the Time travel sheet up.
  const closeSnapshot = useCallback(() => {
    if (snapStack.current.length > 0) goBackLevels(snapStack.current.length);
    else setOpenId(null);
  }, [goBackLevels]);

  // "Return to now" empties the snapshot, so anything open on top of it has no subject
  // left. Close it the same way ✕ does rather than just blanking the state, or its
  // levels would sit on the stack pointing at a card that no longer exists.
  useEffect(() => {
    if (!active) closeSnapshot();
  }, [active, closeSnapshot]);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && close()}
      label="Time travel"
      heightSvh={96}
      className="wm-sheet--time"
    >
      {/* The head IS the readout: eyebrow, then the moment at 26px — roman while the
          thumb sits at now, italic the instant you rewind. The ruler itself lives in
          the bar below, where your thumb already is; stating it twice was the
          duplicate readout this redesign deleted from the desktop. */}
      <div className="wm-sheet__head" style={{ flexDirection: "column", gap: 0 }}>
        <Dateline
          size="phone"
          ruler={false}
          eyebrow={mode === "diff" ? "What changed" : active ? "As it was" : fmtToday(now)}
          moment={active ? fmtMoment(current) : "Now"}
          nowMs={now}
          minMs={minMs}
          markers={markers}
          valueMs={valueMs}
        />
        <div className="wm-ph-diffseg" role="radiogroup" aria-label="Time travel view">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "then"}
            className="wm-ph-diffseg__btn"
            onClick={() => setMode("then")}
          >
            Board then
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "diff"}
            className="wm-ph-diffseg__btn"
            onClick={() => setMode("diff")}
          >
            What changed
          </button>
        </div>
      </div>

      {/* The board, read-only, behind the control. Nothing in here is a button. */}
      <div className="wm-sheet__scroll">
        {mode === "diff" ? (
          !diff || diff.entries.length === 0 ? (
            <p className="wm-ph-then-line">{nothingChangedPhrase(fmtMoment(current))}</p>
          ) : (
            <>
              <p className="wm-ph-diff-summary">
                Since {fmtMoment(current)}: {diff.summary.map((s) => s.phrase).join(", ")}
              </p>
              <ul style={{ marginLeft: -16, marginRight: -16 }}>
                {diff.entries.map((entry) => {
                  const canOpen = byId.has(entry.id);
                  return (
                    <li key={entry.id}>
                      {canOpen ? (
                        <button
                          type="button"
                          className="wm-ph-row wm-ph-row--ledger"
                          aria-label={`${entry.title}. ${entry.phrase}`}
                          onClick={() => openSnapshot(entry.id)}
                        >
                          <span aria-hidden style={{ flex: 1, minWidth: 0 }}>
                            <span className="wm-ph-body wm-ph-clamp2" style={{ display: "block" }}>
                              {entry.title}
                            </span>
                            <span className="wm-ph-caption" style={{ display: "block", marginTop: 2 }}>
                              {entry.phrase}
                            </span>
                          </span>
                        </button>
                      ) : (
                        // Nothing to open: the card didn't exist (or wasn't on the
                        // board) at T, so there is no past card behind this line —
                        // same rule the "Board then" list uses to decide what shows.
                        <div className="wm-ph-row wm-ph-row--ledger wm-ph-row--shut">
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p className="wm-ph-body wm-ph-clamp2">{entry.title}</p>
                            <p className="wm-ph-caption" style={{ marginTop: 2 }}>
                              {entry.phrase}
                            </p>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )
        ) : grouped.length === 0 ? (
          <p className="wm-ph-then-line">{active ? "— the board was empty then —" : "— the board is empty —"}</p>
        ) : (
          grouped.map(([list, rows]) => (
            <section key={list} style={{ marginTop: 32 }}>
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
                        className={`wm-ph-past${active ? " wm-ph-past--then" : ""}`}
                        style={{ width: "100%", textAlign: "left" }}
                        onClick={() => openSnapshot(r.id)}
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
                                className={`wm-ph-past${active ? " wm-ph-past--then" : ""}`}
                                style={{ width: "100%", textAlign: "left", paddingLeft: 32 }}
                                onClick={() => openSnapshot(k.id)}
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
          onOpenCard={openSnapshot}
          onClose={closeSnapshot}
        />
      )}

      {/* The control, in the thumb zone. */}
      <div className="wm-sheet__bar" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <div className="wm-ph-chips" role="group" aria-label="Jump back">
          {JUMPS.map((j) => {
            const target = Math.max(minMs, now - j.back);
            return (
              <button
                key={j.label}
                type="button"
                className="wm-ph-chip"
                disabled={timeline == null}
                onClick={() => setValueMs(snap(target))}
              >
                {j.label}
              </button>
            );
          })}
        </div>
        <Ruler
          size="phone"
          nowMs={now}
          minMs={minMs}
          markers={markers}
          valueMs={valueMs}
          disabled={timeline == null}
          onPick={(ms) => setValueMs(ms)}
          onSnap={(ms) => setValueMs(snap(ms))}
          valueText={active ? fmtMoment(current) : "Now"}
        />
        {active && (
          <button type="button" className="wm-ph-btn wm-ph-btn--return" onClick={() => setValueMs(null)}>
            <span className="wm-dl-return__dot" aria-hidden />
            Return to now
          </button>
        )}
      </div>
    </Sheet>
  );
}
