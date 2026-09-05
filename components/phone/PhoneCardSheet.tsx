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
import PhoneRow from "./PhoneRow";
import { usePhoneUI } from "./PhoneShell";
import { Chevron, Sheet, fieldFocusProps, useSheetOpen } from "./Sheet";
import { childrenOf, findItem, movableLists, usePhoneBoardData } from "./phone-data";
import { CARD_SNAP_POINTS, isExpanded, type SnapPoint } from "./sheetSnaps.ts";

// `dense` and `onOpen` are PhoneRow props owned by the rows package; this cast keeps
// the file compiling against either revision of that file. A sub-card row is a row
// with no swipe and no ⋯ — the actions belong to the card you opened, not to the one
// you are glancing at inside it.
type SubRowProps = {
  item: Item;
  today?: string;
  dense?: boolean;
  onOpen?: (id: string) => void;
};
const SubRow = PhoneRow as unknown as React.ComponentType<SubRowProps>;

// Card detail, as a SHEET and never a route (spec §2 D). Routing to a page would
// unmount the board and lose its scroll position, which is the opposite of what this
// app is for; a sheet leaves the board sitting right behind it.
//
// Two states, from the snap points:
//   peek (180px, plus 56px per sub-card up to three) — title, meta, a full-width Done
//     control, and the card's sub-cards as ORDINARY ROWS. This is the state you're in
//     for the common case: you tapped a row to check what it says, you tick it (or
//     tick one of the things inside it), you flick it away. Two taps to complete a
//     sub-card from Now, two to open one; no indent, no ↳, no smaller type, because a
//     sub-card is the same object as its parent and the app's whole subject is that
//     cards nest.
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

export default function PhoneCardSheet({ itemId }: { itemId: string }) {
  const { close, open } = usePhoneUI();
  const { open: shown, dismiss } = useSheetOpen();
  const { boardId, items, lists, listLabels, refresh } = usePhoneBoardData();
  const [, startTransition] = useTransition();

  const item = findItem(items, itemId);
  const kids = useMemo(() => (item ? childrenOf(items, item.id) : []), [items, item]);
  const columns = useMemo(() => movableLists(lists), [lists]);

  // The peek is sized to what it has to hold. 180px carries the title, the meta line
  // and the full-width Done control; every sub-card past that is one ordinary 56px
  // row. Three is the cap — past three the peek would be most of the screen, and the
  // full state is the right place for a long list.
  const snapPoints = useMemo<SnapPoint[]>(
    () => [`${180 + 56 * Math.min(kids.length, 3)}px`, CARD_SNAP_POINTS[1]],
    [kids.length],
  );
  // Held as a boolean rather than as a snap VALUE, because the peek's value changes
  // with the sub-card count and a stale px string would read as "not expanded".
  const [expanded, setExpanded] = useState(false);
  const snap = expanded ? snapPoints[1] : snapPoints[0];
  const setSnap = (p: SnapPoint | null) => setExpanded(isExpanded(p, snapPoints));

  // ---- history depth -------------------------------------------------------------
  // `stack` is the chain of cards this sheet has drilled through, bottom first. It's
  // a ref, not state, because the popstate handler must read the CURRENT chain and
  // popstate fires outside React's update cycle.
  const stack = useRef<string[]>([]);
  // The same chain, as state, because the back affordance and the parent's name are
  // rendered from it and a ref never re-renders.
  const [chain, setChain] = useState<string[]>([itemId]);
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
        setChain([]);
        closeRef.current();
        return;
      }
      if (depth < st.length) {
        stack.current = st.slice(0, depth);
        setChain(stack.current);
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
      setChain(stack.current);
      if (back > 0) window.history.go(-back);
    } else {
      stack.current = [...st, itemId];
      setChain(stack.current);
      window.history.pushState(
        { ...window.history.state, wmPhoneDepth: stack.current.length },
        "",
      );
    }
    setExpanded(false); // a new card opens at the peek
  }, [itemId]);

  // Two halves, because closing a sheet and giving its history entries back are
  // different moments. `dismiss()` starts the exit animation; `Sheet` calls this back
  // once it's finished, and only then does the shell forget the sheet.
  function dropHistory() {
    const n = stack.current.length;
    stack.current = [];
    if (n > 0) window.history.go(-n);
  }
  function dismissSheet() {
    dropHistory();
    dismiss();
  }
  function onClosed(next: boolean) {
    if (next) return;
    dropHistory();
    close();
  }

  if (!item) {
    // The card was archived or deleted out from under the sheet.
    return (
      <Sheet open={shown} onOpenChange={onClosed} label="Card" heightSvh={30}>
        <div className="wm-sheet__scroll">
          <p className="wm-ph-body" style={{ color: "var(--text-lo)" }}>
            That card isn&apos;t on the board any more.
          </p>
        </div>
      </Sheet>
    );
  }

  const parent = chain.length > 1 ? findItem(items, chain[chain.length - 2]) : null;

  return (
    <Sheet
      open={shown}
      onOpenChange={onClosed}
      snapPoints={snapPoints}
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
        parentTitle={chain.length > 1 ? (parent?.text ?? "the card above") : null}
        onBack={() => window.history.go(-1)}
        onExpand={() => setExpanded(true)}
        onOpenChild={(id) => open({ kind: "card", itemId: id })}
        onChanged={refresh}
        onArchived={dismissSheet}
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
  parentTitle,
  onBack,
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
  parentTitle: string | null;
  onBack(): void;
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
      {/* ── peek: the card, its Done control, and the things inside it ───── */}
      <div className="wm-sheet__head">
        {parentTitle && (
          <button
            type="button"
            className="wm-ph-back"
            aria-label={`Back to ${parentTitle}`}
            onClick={onBack}
          >
            <Chevron dir="left" />
          </button>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Depth is stated once, in words, and never by indenting a row. */}
          {parentTitle && <p className="wm-ph-parent wm-ph-clamp2">{parentTitle}</p>}
          <p className="wm-ph-title wm-ph-clamp2">{item.text}</p>
          <p className="wm-ph-caption" style={{ marginTop: 3 }}>
            {listLabels[item.list] ?? item.list}
            {kids.length > 0 && (
              <>
                {", "}
                <span className="wm-ph-num">{kids.length}</span> sub-card
                {kids.length === 1 ? "" : "s"}
              </>
            )}
            {streak > 0 && (
              <>
                {", "}
                <span className="wm-ph-num">{streak}</span> in a row
              </>
            )}
          </p>
        </div>
        {!expanded && (
          <button
            type="button"
            className="wm-ph-tap"
            onClick={onExpand}
            aria-label="Show card details"
          >
            <Chevron dir="up" />
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

      {/* Sub-cards, in the peek, when the peek was grown to hold them. Byte for byte
          the row from Now: 56px, a 44px check zone, the same completion behaviour,
          the same typography — so completing one is two taps and opening one is two. */}
      {!expanded && kids.length > 0 && kids.length <= 3 && (
        <ul className="wm-ph-kids">
          {kids.map((k) => (
            <SubRow key={k.id} item={k} today={today} dense onOpen={onOpenChild} />
          ))}
        </ul>
      )}

      {/* ── full: the editor ────────────────────────────────────────────── */}
      {expanded && (
        <div className="wm-sheet__scroll">
          {/* No `Title` / `Details` captions: the first field holds the card's name,
              which is already written across the top of the sheet, and the second is
              the only other thing here. A label over a self-evident field is
              furniture. */}
          <textarea
            id="wm-ph-card-title"
            className="wm-ph-field"
            style={{ minHeight: 56 }}
            rows={2}
            aria-label="Card title"
            {...fieldFocusProps()}
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

          <textarea
            id="wm-ph-card-details"
            className="wm-ph-field"
            // Tall enough that a paragraph is not cut off by its own underline.
            style={{ marginTop: 14, minHeight: 140 }}
            value={details}
            aria-label="Details"
            placeholder="Anything worth remembering about this, markdown supported"
            {...fieldFocusProps()}
            onChange={(e) => setDetails(e.target.value)}
            onBlur={() => {
              if (details === (item.details ?? "")) return;
              run(() => {
                editDetailsAction(boardId, item.id, details);
                onChanged();
              });
            }}
          />

          {/* Sub-cards. The same row as the parent, at every depth: no indent, no
              arrow glyph, no smaller type. The negative margin lets the rows and
              their hairlines reach the sheet's edges through the scroller's gutter. */}
          <p className="wm-ph-sect" style={{ padding: "18px 0 6px" }}>
            Sub-cards
            {kids.length > 0 && (
              <span className="wm-ph-num" style={{ color: "var(--text-lo)" }}>
                {" "}
                {kids.length}
              </span>
            )}
          </p>
          <ul style={{ marginLeft: -16, marginRight: -16 }}>
            {kids.map((k) => (
              <SubRow key={k.id} item={k} today={today} dense onOpen={onOpenChild} />
            ))}
            {kids.length === 0 && (
              <li className="wm-ph-hint wm-ph-pad">Nothing inside this one yet.</li>
            )}
          </ul>
          <form
            style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-end" }}
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
              {...fieldFocusProps()}
            />
            <button
              type="submit"
              className="wm-ph-btn wm-ph-btn--ghost wm-ph-btn--auto"
              disabled={!childText.trim()}
            >
              Add
            </button>
          </form>

          {/* Recurrence */}
          <p className="wm-ph-sect" style={{ padding: "18px 0 6px" }}>
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
          <p className="wm-ph-sect" style={{ padding: "18px 0 6px" }}>
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
            Archived cards keep their whole history, and come back from Archive on the
            desktop board.
          </p>
        </div>
      )}
    </>
  );
}
