"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  addChildAction,
  archiveItemAction,
  editDetailsAction,
  editItemAction,
  moveItemAction,
  setDailyDoneAction,
  setRecurrenceAction,
  toggleDoneAction,
} from "@/app/actions";
import { WEEKDAYS, effectiveDone, localToday, parseRecurrence } from "@/lib/recurrence";
import { daysWithLiveCheck, streakFor } from "@/lib/streaks";
import type { Item } from "@/lib/types";
import { usePhoneUI } from "./PhoneShell";
import { Sheet } from "./Sheet";
import { childrenOf, findItem, movableLists, usePhoneBoardData } from "./phone-data";
import { CARD_SNAP_POINTS, isExpanded, type SnapPoint } from "./sheetSnaps.ts";

// Card detail, as a SHEET and never a route (spec §2 D). Routing to a page would
// unmount the board and lose its scroll position, which is the opposite of what this
// app is for; a sheet leaves the board sitting right behind it.
//
// Two states, from the snap points:
//   peek (180px) — title, the sub-card count, and a full-width Done control, all in
//     the thumb zone. This is the state you're in for the common case: you tapped a
//     row to check what it says, you tick it, you flick it away.
//   full (0.92)  — details, sub-cards, recurrence, move-to. The editor, when you
//     actually want one.
//
// HISTORY DEPTH. Board.tsx mirrors its open-card depth onto the history stack so an
// iOS edge-swipe-back steps sub-card → parent → board instead of leaving the app.
// The same contract holds here, with the same shape but its OWN state key
// (`wmPhoneDepth`): each level this sheet drills into pushes one entry, back pops
// one level, and closing unwinds them all. Board.tsx's popstate handler is untouched
// and still reads `wmDepth`, which we preserve on every push — the two coexist
// because a phone never has the desktop panel open at the same time.

const DONE_LABEL = "Done";

function CountRing({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <span className="wm-ph-caption wm-ph-num" style={{ color: "var(--text-lo)" }}>
      {n} sub-card{n === 1 ? "" : "s"}
    </span>
  );
}

export default function PhoneCardSheet({ itemId }: { itemId: string }) {
  const { close, open } = usePhoneUI();
  const { boardId, items, lists, listLabels, refresh } = usePhoneBoardData();
  const [snap, setSnap] = useState<SnapPoint | null>(CARD_SNAP_POINTS[0]);
  const [, startTransition] = useTransition();

  const item = findItem(items, itemId);
  const kids = useMemo(() => (item ? childrenOf(items, item.id) : []), [items, item]);
  const columns = useMemo(() => movableLists(lists), [lists]);
  const expanded = isExpanded(snap, CARD_SNAP_POINTS);

  // ---- history depth -------------------------------------------------------------
  // `stack` is the chain of cards this sheet has drilled through, bottom first. It's
  // a ref, not state, because the popstate handler must read the CURRENT chain and
  // popstate fires outside React's update cycle.
  const stack = useRef<string[]>([]);
  const openRef = useRef(open);
  const closeRef = useRef(close);
  openRef.current = open;
  closeRef.current = close;

  useEffect(() => {
    stack.current = [itemId];
    window.history.pushState({ ...window.history.state, wmPhoneDepth: 1 }, "");

    const onPop = (e: PopStateEvent) => {
      const depth = ((e.state as { wmPhoneDepth?: number } | null)?.wmPhoneDepth) ?? 0;
      const st = stack.current;
      if (st.length === 0) return; // already unwinding on close
      if (depth <= 0) {
        stack.current = [];
        closeRef.current();
        return;
      }
      if (depth < st.length) {
        stack.current = st.slice(0, depth);
        openRef.current({ kind: "card", itemId: stack.current[depth - 1] });
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed some other way (the shell swapped sheets): give the entries back so
      // the next back-gesture leaves the app rather than replaying dead depths.
      const n = stack.current.length;
      stack.current = [];
      if (n > 0) window.history.go(-n);
    };
    // Mount-only: the effect owns the whole sheet's history lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drilling into a sub-card (or back out via an in-sheet control) re-syncs the chain.
  useEffect(() => {
    const st = stack.current;
    if (st.length === 0 || st[st.length - 1] === itemId) return;
    const at = st.indexOf(itemId);
    if (at >= 0) {
      const back = st.length - 1 - at;
      stack.current = st.slice(0, at + 1);
      if (back > 0) window.history.go(-back);
    } else {
      stack.current = [...st, itemId];
      window.history.pushState(
        { ...window.history.state, wmPhoneDepth: stack.current.length },
        "",
      );
    }
    setSnap(CARD_SNAP_POINTS[0]); // a new card opens at the peek
  }, [itemId]);

  function requestClose(next: boolean) {
    if (next) return;
    const n = stack.current.length;
    stack.current = [];
    close();
    if (n > 0) window.history.go(-n);
  }

  if (!item) {
    // The card was archived or deleted out from under the sheet.
    return (
      <Sheet open onOpenChange={requestClose} label="Card" heightSvh={30}>
        <div className="wm-sheet__scroll">
          <p className="wm-ph-body" style={{ color: "var(--text-lo)" }}>
            That card isn&apos;t on the board any more.
          </p>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open
      onOpenChange={requestClose}
      snapPoints={CARD_SNAP_POINTS}
      activeSnapPoint={snap}
      onSnapPointChange={setSnap}
      label={item.text}
      className="wm-sheet--card"
    >
      <CardBody
        item={item}
        kids={kids}
        columns={columns}
        listLabels={listLabels}
        boardId={boardId}
        expanded={expanded}
        onExpand={() => setSnap(CARD_SNAP_POINTS[1])}
        onOpenChild={(id) => open({ kind: "card", itemId: id })}
        onChanged={refresh}
        onArchived={() => requestClose(false)}
        run={startTransition}
      />
    </Sheet>
  );
}

// The body is split out so the sheet above stays about snap points and history, and
// this stays about the card.
function CardBody({
  item,
  kids,
  columns,
  listLabels,
  boardId,
  expanded,
  onExpand,
  onOpenChild,
  onChanged,
  onArchived,
  run,
}: {
  item: Item;
  kids: Item[];
  columns: { id: string; label: string }[];
  listLabels: Record<string, string>;
  boardId: string | null;
  expanded: boolean;
  onExpand(): void;
  onOpenChild(id: string): void;
  onChanged(): void;
  onArchived(): void;
  run(fn: () => void): void;
}) {
  const today = localToday();
  const rec = parseRecurrence(item.recurrence);

  // Optimistic completion, exactly as §3 requires: the flip is local and immediate,
  // the write follows and is never awaited in the handler.
  const [doneLocal, setDoneLocal] = useState<boolean | null>(null);
  useEffect(() => setDoneLocal(null), [item.id, item.done, item.completed_on]);
  const done = doneLocal ?? effectiveDone(item, today);

  const streak = useMemo(() => {
    if (rec.kind === "none") return 0;
    const days = daysWithLiveCheck(
      item.completed_days ?? [],
      today,
      item.recurrence,
      done,
      item.completed_on,
    );
    return streakFor(days, today, rec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.completed_days, item.recurrence, item.completed_on, done, today]);

  function toggleDone() {
    const next = !done;
    setDoneLocal(next); // same frame, before any await (§3.2)
    try {
      navigator.vibrate?.(8); // best-effort, never load-bearing (§3.3)
    } catch {
      /* no haptics here; the state change is the feedback */
    }
    run(() => {
      if (rec.kind === "none") toggleDoneAction(boardId, item.id, next);
      else setDailyDoneAction(boardId, item.id, next ? today : null);
      onChanged();
    });
  }

  // Title + details are saved on blur, like the desktop note — no Save button to
  // miss, and no keystroke-by-keystroke writes into the history log.
  const [title, setTitle] = useState(item.text);
  const [details, setDetails] = useState(item.details ?? "");
  useEffect(() => setTitle(item.text), [item.id, item.text]);
  useEffect(() => setDetails(item.details ?? ""), [item.id, item.details]);

  const [childText, setChildText] = useState("");

  const doneName = `${item.text}${streak > 0 ? `, ${streak} ${rec.kind === "weekly" ? "week" : "day"} streak` : ""}, ${done ? "done" : "not done"}${rec.kind !== "none" ? " today" : ""}`;

  return (
    <>
      {/* ── peek: everything here has to fit inside 180px ───────────────── */}
      <div className="wm-sheet__head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className="wm-ph-title wm-ph-clamp2">{item.text}</p>
          <p className="wm-ph-caption" style={{ marginTop: 3 }}>
            {listLabels[item.list] ?? item.list}
            {kids.length > 0 && " · "}
            <CountRing n={kids.length} />
            {streak > 0 && (
              <>
                {" · "}
                <span className="wm-ph-num">{streak}</span> in a row
              </>
            )}
          </p>
        </div>
        {!expanded && (
          <button type="button" className="wm-ph-tap" onClick={onExpand} aria-label="Show card details">
            <span aria-hidden>⌃</span>
          </button>
        )}
      </div>

      <div style={{ flex: "none", padding: "0 16px 12px" }}>
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={doneName}
          onClick={toggleDone}
          className={`wm-ph-btn ${done ? "wm-ph-btn--done" : "wm-ph-btn--primary"}`}
        >
          {done ? `${DONE_LABEL} ✓` : DONE_LABEL}
        </button>
      </div>

      {/* ── full: the editor ────────────────────────────────────────────── */}
      {expanded && (
        <div className="wm-sheet__scroll">
          <label className="wm-ph-caption" htmlFor="wm-ph-card-title">
            Title
          </label>
          <textarea
            id="wm-ph-card-title"
            className="wm-ph-field"
            style={{ minHeight: 56, marginTop: 6 }}
            rows={2}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              const t = title.trim();
              if (!t || t === item.text) {
                setTitle(item.text);
                return;
              }
              run(() => {
                editItemAction(boardId, item.id, t);
                onChanged();
              });
            }}
          />

          <label
            className="wm-ph-caption"
            htmlFor="wm-ph-card-details"
            style={{ display: "block", marginTop: 16 }}
          >
            Details
          </label>
          <textarea
            id="wm-ph-card-details"
            className="wm-ph-field"
            style={{ marginTop: 6 }}
            value={details}
            placeholder="Anything worth remembering about this — markdown supported"
            onChange={(e) => setDetails(e.target.value)}
            onBlur={() => {
              if (details === (item.details ?? "")) return;
              run(() => {
                editDetailsAction(boardId, item.id, details);
                onChanged();
              });
            }}
          />

          {/* Sub-cards */}
          <p className="wm-ph-caption" style={{ marginTop: 18 }}>
            Sub-cards
          </p>
          <ul style={{ marginTop: 6 }}>
            {kids.map((k) => (
              <li key={k.id}>
                <button type="button" className="wm-ph-row" onClick={() => onOpenChild(k.id)}>
                  <span aria-hidden style={{ color: "var(--text-lo)" }}>
                    ↳
                  </span>
                  <span className="wm-ph-body wm-ph-clamp2" style={{ flex: 1 }}>
                    {k.text}
                  </span>
                </button>
              </li>
            ))}
            {kids.length === 0 && (
              <li className="wm-ph-hint" style={{ padding: "6px 12px" }}>
                Nothing inside this one yet.
              </li>
            )}
          </ul>
          <form
            style={{ display: "flex", gap: 8, marginTop: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              const t = childText.trim();
              if (!t) return;
              setChildText("");
              run(() => {
                addChildAction(boardId, item.id, t);
                onChanged();
              });
            }}
          >
            <input
              className="wm-ph-field"
              value={childText}
              onChange={(e) => setChildText(e.target.value)}
              placeholder="Add a sub-card…"
              aria-label="Add a sub-card"
            />
            <button type="submit" className="wm-ph-btn wm-ph-btn--auto" disabled={!childText.trim()}>
              Add
            </button>
          </form>

          {/* Recurrence */}
          <p className="wm-ph-caption" style={{ marginTop: 18 }}>
            Repeats
          </p>
          <div className="wm-ph-chips" style={{ marginTop: 6 }} role="group" aria-label="Repeats">
            {[
              { value: "none", label: "Doesn't repeat" },
              { value: "daily", label: "Every day" },
              ...WEEKDAYS.map((w, i) => ({ value: `weekly:${i}`, label: `Every ${w}` })),
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                className="wm-ph-chip"
                aria-pressed={item.recurrence === opt.value}
                onClick={() =>
                  run(() => {
                    setRecurrenceAction(boardId, item.id, opt.value);
                    onChanged();
                  })
                }
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Move to — the phone's ONLY way to move a card. Hover-hold nesting is a
              desktop gesture and is deliberately absent here (§5). */}
          <p className="wm-ph-caption" style={{ marginTop: 18 }}>
            Move to
          </p>
          <div className="wm-ph-chips" style={{ marginTop: 6 }} role="group" aria-label="Move to">
            {columns.map((l) => (
              <button
                key={l.id}
                type="button"
                className="wm-ph-chip"
                aria-pressed={item.list === l.id}
                onClick={() => {
                  if (item.list === l.id) return;
                  run(() => {
                    moveItemAction(boardId, item.id, l.id);
                    onChanged();
                  });
                }}
              >
                {l.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="wm-ph-btn"
            style={{ marginTop: 20 }}
            onClick={() => {
              run(() => {
                archiveItemAction(boardId, item.id);
                onChanged();
              });
              onArchived();
            }}
          >
            Archive this card
          </button>
          <p className="wm-ph-hint" style={{ marginTop: 8 }}>
            Archived cards keep their whole history — they come back from Archive on
            the desktop board.
          </p>
        </div>
      )}
    </>
  );
}
