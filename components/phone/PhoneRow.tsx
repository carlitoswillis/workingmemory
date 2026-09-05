"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Item } from "@/lib/types";
import { archiveItemAction, moveItemAction, setDailyDoneAction, toggleDoneAction } from "@/app/actions";
import { effectiveDone, localToday, parseRecurrence } from "@/lib/recurrence";
import { daysWithLiveCheck, streakFor } from "@/lib/streaks";
import { useBoardId } from "../board-context";
import { usePhoneUI } from "./PhoneShell";
import { M, UNDO_MS, haptic, msOf } from "./phone-motion";
import {
  isMilestone,
  lockAxis,
  rowAriaLabel,
  rowHeldInPlace,
  rowInitial,
  rowNext,
  swipeIntent,
  withinSwipeZone,
  type RowEvent,
  type RowState,
} from "./phone-logic";

// The row is the phone app's unit — a column is a desktop spatial metaphor and a
// thumb has one axis. 56px tall, a 44px leading check zone (the glyph stays 18px;
// the rest is padding, per HIG 44pt / WCAG 2.5.8), the title clamped to two lines so
// it grows at accessibility text sizes instead of ellipsing, and the streak trailing
// in tabular-nums so the number doesn't dance when it ticks up.
//
// Completion is one tap, zero dialogs, optimistic: the flip happens in the handler
// BEFORE any await, the server action is fired after it and never gates the UI, and
// a failure pins itself on the row rather than floating away as a toast.
//
// This row has its OWN swipe (spec §5) — SwipeToArchive.tsx is tuned against the
// desktop board's sensor and is deliberately left alone.

export default function PhoneRow({
  item,
  checked,
  childItems,
  today,
  collapseOnDone = false,
  snoozeListId = null,
  swipeEnabled = true,
  onCheckedChange,
  onHold,
  onSettled,
  dragHandleProps,
  dragging = false,
  rootRef,
  rootStyle,
  rootProps,
}: {
  item: Item;
  // The parent's resolved truth for this row — its optimistic value while a write is
  // in flight, the server's derived `effectiveDone` otherwise.
  checked?: boolean;
  childItems?: Item[];
  today?: string;
  // Now collapses a checked row into "Done today"; a Lists page leaves it in place.
  collapseOnDone?: boolean;
  snoozeListId?: string | null;
  swipeEnabled?: boolean;
  onCheckedChange?: (id: string, checked: boolean) => void;
  onHold?: (id: string, held: boolean) => void;
  onSettled?: (id: string) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLElement>;
  dragging?: boolean;
  // The row IS the list item, so a sortable wrapper would put a <div> inside a <ul>.
  // dnd-kit's ref / transform / attributes land on this element instead.
  rootRef?: (el: HTMLLIElement | null) => void;
  rootStyle?: React.CSSProperties;
  rootProps?: React.HTMLAttributes<HTMLLIElement>;
}) {
  const boardId = useBoardId();
  const ui = usePhoneUI();
  const day = today ?? localToday();
  const rec = parseRecurrence(item.recurrence);
  const repeats = rec.kind !== "none";
  const truth = checked ?? effectiveDone(item, day);

  const [state, setState] = useState<RowState>(() => rowInitial(truth));
  const stateRef = useRef(state);
  const [, startTransition] = useTransition();

  // One place where an event becomes the next state — and where the parent is told
  // what changed. Kept out of the setState updater so React's double-invocation in
  // development can't fire a side effect twice.
  function apply(event: RowEvent) {
    const prev = stateRef.current;
    const next = rowNext(prev, event);
    if (next === prev) return;
    stateRef.current = next;
    setState(next);
    if (next.checked !== prev.checked) onCheckedChange?.(item.id, next.checked);
    if (rowHeldInPlace(next) !== rowHeldInPlace(prev)) onHold?.(item.id, rowHeldInPlace(next));
    if (next.phase === "gone" && prev.phase !== "gone") onSettled?.(item.id);
  }

  // Fresh server truth. The state machine drops it while a finger is mid-sequence, so
  // a revalidation can never yank a row out from under its own Undo.
  useEffect(() => {
    apply({ type: "sync", checked: truth });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truth]);

  // The 900ms window, then the collapse. Both are plain timers: CSS owns the motion,
  // this only owns the pacing (and reduced motion has already zeroed the durations).
  useEffect(() => {
    if (state.phase === "undo") {
      const t = setTimeout(() => apply({ type: "window-elapsed" }), UNDO_MS);
      return () => clearTimeout(t);
    }
    if (state.phase === "collapsing") {
      const t = setTimeout(() => apply({ type: "collapsed" }), collapseOnDone ? msOf("rowCollapse") : 0);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // Streak folds the optimistic checkbox in before counting, so the number moves with
  // the glyph rather than after the round-trip.
  const dayset = daysWithLiveCheck(
    item.completed_days ?? [],
    day,
    item.recurrence,
    state.checked,
    item.completed_on,
  );
  const streak = repeats ? streakFor(dayset, day, rec) : 0;

  // Milestones ONLY (7/30/100): one 400ms colour pulse on the number. Nothing on an
  // ordinary day — animation fatigue is what kills a high-frequency, low-novelty tick.
  const [pulse, setPulse] = useState(false);
  const prevStreak = useRef(streak);
  useEffect(() => {
    if (streak > prevStreak.current && isMilestone(streak)) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), msOf("milestone"));
      prevStreak.current = streak;
      return () => clearTimeout(t);
    }
    prevStreak.current = streak;
  }, [streak]);

  function fire(next: boolean) {
    const promise = repeats
      ? setDailyDoneAction(boardId, item.id, next ? day : null)
      : toggleDoneAction(boardId, item.id, next);
    startTransition(() => {
      promise.catch(() => apply({ type: "failed", message: "Couldn’t save — tap to retry" }));
    });
  }

  // THE completion moment. Everything visible happens in this handler, synchronously,
  // before the write is even started.
  function toggle() {
    const next = !stateRef.current.checked;
    apply({ type: "toggle" }); // state flips now — no await above this line
    haptic(); // best-effort, never load-bearing
    fire(next);
  }

  function undo() {
    const next = !stateRef.current.checked;
    apply({ type: "undo" });
    fire(next);
  }

  // ── Swipe (this row's own; see spec §5) ────────────────────────────────────
  // Right = complete (redundant with the tap — never the only path). Left = reveal
  // Snooze/Archive, which are also plain buttons behind the row's ⋯ so the gesture
  // stays a shortcut. Directional lock decides who owns the drag within the first
  // 15px; a touch starting inside 28px of either edge is iOS's, not ours.
  const [dx, setDx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const axisRef = useRef<"pending" | "x">("pending");
  const swipedRef = useRef(false);

  const canSwipe = swipeEnabled && !dragging;

  function onPointerDown(e: React.PointerEvent) {
    if (!canSwipe) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!withinSwipeZone(e.clientX, window.innerWidth)) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    axisRef.current = "pending";
  }

  function onPointerMove(e: React.PointerEvent) {
    const start = startRef.current;
    if (!start || !canSwipe) return;
    const ddx = e.clientX - start.x;
    const ddy = e.clientY - start.y;
    if (axisRef.current === "pending") {
      const axis = lockAxis(ddx, ddy);
      if (axis === "y") {
        startRef.current = null; // the scroller keeps it; we never look again
        return;
      }
      if (axis !== "x") return;
      axisRef.current = "x";
    }
    // Rubber-band past the action width so the row can't be dragged off screen.
    const clamped = Math.max(-120, Math.min(120, ddx));
    setDx(clamped);
  }

  function endSwipe() {
    const start = startRef.current;
    const travelled = axisRef.current === "x";
    startRef.current = null;
    axisRef.current = "pending";
    if (!start || !travelled) return;
    const intent = swipeIntent(dx);
    swipedRef.current = Math.abs(dx) > 6; // swallow the click this gesture would fire
    setDx(0);
    if (intent === "complete") {
      if (!stateRef.current.checked) toggle();
    } else if (intent === "reveal") {
      setRevealed(true);
    } else {
      setRevealed(false);
    }
  }

  function swallowClickAfterSwipe(e: React.MouseEvent) {
    if (!swipedRef.current) return;
    swipedRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }

  function snooze() {
    setRevealed(false);
    if (!snoozeListId) return;
    startTransition(() => {
      moveItemAction(boardId, item.id, snoozeListId).catch(() => {});
    });
  }
  function archive() {
    setRevealed(false);
    startTransition(() => {
      archiveItemAction(boardId, item.id).catch(() => {});
    });
  }

  const subTotal = childItems?.length ?? 0;
  const subDone = childItems?.filter((c) => effectiveDone(c, day)).length ?? 0;
  const collapsing = collapseOnDone && (state.phase === "collapsing" || state.phase === "gone");

  return (
    <li
      ref={rootRef}
      className={`phone-rowwrap${collapsing ? " is-collapsing" : ""}`}
      style={{ ["--row-collapse" as string]: `${msOf("rowCollapse")}ms`, ...rootStyle }}
      {...rootProps}
    >
      <div className="phone-rowwrap__inner">
        <div className="phone-rowline">
          <div
            className={`phone-row${state.checked ? " is-done" : ""}${dragging ? " is-dragging" : ""}`}
            style={{
              transform: dx ? `translateX(${dx}px)` : undefined,
              transition: dx ? "none" : `transform ${msOf("check")}ms ${M.tapScale.ease}`,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endSwipe}
            onPointerCancel={endSwipe}
            onClickCapture={swallowClickAfterSwipe}
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={state.checked}
              aria-label={rowAriaLabel(item.text, { checked: state.checked, streak, repeats })}
              onClick={toggle}
              className="phone-check"
            >
              <span className={`phone-check__glyph${state.checked ? " is-on" : ""}`} aria-hidden>
                <svg viewBox="0 0 18 18" width="18" height="18">
                  <circle
                    className="phone-check__ring"
                    cx="9"
                    cy="9"
                    r="7.6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    className="phone-check__tick"
                    d="M5.2 9.3l2.6 2.6 5-5.4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>

            <button
              type="button"
              className="phone-row__body"
              onClick={() => ui.open({ kind: "card", itemId: item.id })}
              {...dragHandleProps}
            >
              <span className="phone-row__title">{item.text}</span>
              {(subTotal > 0 || item.details.trim() || state.error) && (
                <span className="phone-row__meta">
                  {state.error ? (
                    <span className="phone-row__error">{state.error}</span>
                  ) : (
                    <>
                      {subTotal > 0 && (
                        <span className="tabular-nums">
                          {subDone}/{subTotal} sub-cards
                        </span>
                      )}
                      {item.details.trim() && <span aria-hidden>Notes</span>}
                    </>
                  )}
                </span>
              )}
            </button>

            {state.phase === "undo" ? (
              <button type="button" className="phone-row__undo" onClick={undo}>
                Undo
              </button>
            ) : (
              <>
                {repeats && streak > 0 && (
                  <span
                    className={`phone-row__streak${pulse ? " is-milestone" : ""}`}
                    style={{ ["--milestone" as string]: `${msOf("milestone")}ms` }}
                    aria-hidden
                  >
                    {streak}
                  </span>
                )}
                <button
                  type="button"
                  className="phone-row__more"
                  aria-label={`Actions for ${item.text}`}
                  aria-expanded={revealed}
                  onClick={() => setRevealed((v) => !v)}
                >
                  <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden>
                    <circle cx="4" cy="9" r="1.4" fill="currentColor" />
                    <circle cx="9" cy="9" r="1.4" fill="currentColor" />
                    <circle cx="14" cy="9" r="1.4" fill="currentColor" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>

        {/* The swipe's actions, mirrored as ordinary focusable buttons. A swipe is a
            shortcut; it is never the only way to reach anything. */}
        {revealed && (
          <div className="phone-row__actions">
            {snoozeListId && (
              <button type="button" className="phone-row__action" onClick={snooze}>
                Later
              </button>
            )}
            <button type="button" className="phone-row__action" onClick={archive}>
              Archive
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
