"use client";

import { useMemo, useState, useTransition } from "react";
import { moveCardToBoardAction, setParentAction } from "@/app/actions";
import { isSentinelList } from "@/lib/lists";
import type { Item } from "@/lib/types";
import { Chevron } from "./Sheet";
import { movableLists, usePhoneBoardData } from "./phone-data";

// The two moves the phone had no verb for (backlog §B, "Move a card to another board
// / re-parent"). The Move-to chips above these change a card's COLUMN; these change
// what the card belongs to:
//
//   Inside — nest this card under another card on this board, or pop it back out.
//            `setParentAction`, the same action the desktop panel's "Inside" select
//            and the drag-a-sub-card-off-the-panel gesture run through, so the rules
//            (no cycles, no nesting the note, board-scoped ids) are enforced once, in
//            lib/nesting.ts, and a refusal comes back as a sentence we print.
//   Board  — move it, with everything inside it, to another board. `moveCardToBoardAction`.
//            That one is not an update: the card is archived here and recreated there
//            (lib/doorways.ts explains why), so it is the one move in this sheet that
//            asks before it happens.
//
// ROWS, not chips. A chip strip is for a closed set you can read in one glance —
// seven weekdays, five columns. The cards on a board and the boards in an account are
// neither closed nor short, and a name that matters is not something to read sideways
// through a scroll mask. So: the ledger row used everywhere else in this app, with the
// card's column (or its parent) as the caption, and depth said in WORDS rather than by
// indenting anything.

// How many candidate cards the Inside picker shows before it offers the rest. Six is
// about a thumb's worth of scrolling past the section above it; the full list is one
// tap away and stays in the same scroller, because a picker inside a sheet inside a
// drag-to-dismiss sheet is one nesting too many.
const COLLAPSED = 6;

type Candidate = { id: string; text: string; caption: string };

export default function PhoneCardMove({
  item,
  onChanged,
  onLeftBoard,
}: {
  item: Item;
  /** A write landed: tell the sheet to pick the board up again. */
  onChanged(): void;
  /** The card is no longer on this board — dismiss the sheet. */
  onLeftBoard(): void;
}) {
  const { boardId, items, lists, listLabels, boards } = usePhoneBoardData();
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // The board a tap has ARMED, not one anything has been done to yet.
  const [armed, setArmed] = useState<{ id: string; name: string } | null>(null);
  // Our own in-flight flag rather than useTransition's `pending`: these actions are
  // awaited for their refusal string, and a transition's pending state ends at the
  // first await, which is long before the write lands.
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const columns = useMemo(() => movableLists(lists), [lists]);
  const others = useMemo(() => boards.filter((b) => b.id !== boardId), [boards, boardId]);

  // Every live card on this board except this one and its own sub-tree — a card can't
  // go inside itself, and the branch under it travels with it. Walked in board order
  // (column order, then position) so the list reads the way the board does.
  const candidates = useMemo<Candidate[]>(() => {
    const kidsOf = new Map<string, Item[]>();
    for (const i of items) {
      if (i.archived || !i.parent_id) continue;
      const at = kidsOf.get(i.parent_id);
      if (at) at.push(i);
      else kidsOf.set(i.parent_id, [i]);
    }
    const mine = new Set<string>([item.id]);
    (function collect(id: string) {
      for (const c of kidsOf.get(id) ?? []) {
        mine.add(c.id);
        collect(c.id);
      }
    })(item.id);

    const out: Candidate[] = [];
    for (const l of columns) {
      const roots = items.filter((i) => !i.archived && !i.parent_id && i.list === l.id);
      (function walk(siblings: Item[], parent: Item | null) {
        for (const it of siblings) {
          if (mine.has(it.id)) continue; // skips its whole branch with it
          out.push({
            id: it.id,
            text: it.text,
            caption: parent ? `Inside ${parent.text}` : l.label,
          });
          walk(kidsOf.get(it.id) ?? [], it);
        }
      })(roots, null);
    }
    return out;
  }, [items, columns, item.id]);

  const parentId = item.parent_id ?? null;
  // Collapsed, the list still has to contain the answer to "where is this card now":
  // if the card it currently sits inside falls past the cut, it comes up to the top.
  const shown = useMemo(() => {
    if (showAll) return candidates;
    const head = candidates.slice(0, COLLAPSED);
    if (!parentId || head.some((c) => c.id === parentId)) return head;
    const here = candidates.find((c) => c.id === parentId);
    return here ? [here, ...head.slice(0, COLLAPSED - 1)] : head;
  }, [candidates, showAll, parentId]);

  function reparent(next: string | null) {
    if (busy || parentId === next) return;
    setError(null);
    setBusy(true);
    startTransition(async () => {
      // Popping out lands the card back in its own column, which is the one the
      // Move-to chips above are already showing as pressed.
      const err = await setParentAction(boardId, [item.id], next, next ? undefined : item.list);
      setBusy(false);
      if (err) setError(err);
      else onChanged();
    });
  }

  function moveToBoard(target: { id: string; name: string }) {
    if (busy) return;
    setError(null);
    setBusy(true);
    startTransition(async () => {
      const err = await moveCardToBoardAction(boardId, item.id, target.id);
      if (err) {
        setBusy(false);
        setArmed(null);
        setError(err);
        return;
      }
      onChanged();
      // It isn't on this board any more, so neither is the sheet that was showing it.
      // `busy` stays true: the sheet is on its way out, and there is nothing left
      // here to tap.
      onLeftBoard();
    });
  }

  // The note and the weekly review are sentinels, not cards: they can't be nested and
  // they don't leave their board. Nothing here applies to them.
  if (isSentinelList(item.list)) return null;

  return (
    <>
      <p className="wm-ph-sect" style={{ padding: "18px 0 6px" }}>
        Inside
      </p>
      <ul className="wm-ph-picker">
        <li>
          <button
            type="button"
            className="wm-ph-row"
            aria-pressed={parentId === null}
            aria-label={
              parentId === null ? "On the board, where this card is" : "Put this card back on the board"
            }
            disabled={busy}
            onClick={() => reparent(null)}
          >
            <span aria-hidden style={{ flex: 1, minWidth: 0 }}>
              <span className="wm-ph-body" style={{ display: "block" }}>
                On the board
              </span>
              <span className="wm-ph-caption" style={{ display: "block" }}>
                {listLabels[item.list] ?? item.list}
              </span>
            </span>
            {parentId === null && (
              <span aria-hidden className="wm-ph-caption">
                here
              </span>
            )}
          </button>
        </li>
        {shown.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="wm-ph-row"
              aria-pressed={parentId === c.id}
              aria-label={
                parentId === c.id
                  ? `Inside ${c.text}, where this card is`
                  : `Put this card inside ${c.text}`
              }
              disabled={busy}
              onClick={() => reparent(c.id)}
            >
              <span aria-hidden style={{ flex: 1, minWidth: 0 }}>
                <span className="wm-ph-body wm-ph-clamp2" style={{ display: "block" }}>
                  {c.text}
                </span>
                <span className="wm-ph-caption wm-ph-clamp2" style={{ display: "block" }}>
                  {c.caption}
                </span>
              </span>
              {parentId === c.id && (
                <span aria-hidden className="wm-ph-caption">
                  here
                </span>
              )}
            </button>
          </li>
        ))}
        {candidates.length === 0 && (
          <li className="wm-ph-hint" style={{ padding: "10px 16px" }}>
            There is no other card on this board to put it in.
          </li>
        )}
        {!showAll && candidates.length > COLLAPSED && (
          <li>
            <button
              type="button"
              className="wm-ph-row"
              onClick={() => setShowAll(true)}
              aria-label={`Show all ${candidates.length} cards`}
            >
              <span aria-hidden className="wm-ph-body" style={{ flex: 1 }}>
                Show all <span className="wm-ph-num">{candidates.length}</span> cards
              </span>
              <span aria-hidden style={{ color: "var(--text-lo)", display: "flex" }}>
                <Chevron />
              </span>
            </button>
          </li>
        )}
      </ul>

      {/* Boards exist only on the hosted instance with somewhere to move TO; a local
          or demo file has one board and this section would be an empty promise. */}
      {others.length > 0 && (
        <>
          <p className="wm-ph-sect" style={{ padding: "18px 0 6px" }}>
            Board
          </p>
          {armed ? (
            <div className="wm-ph-card" style={{ marginTop: 6 }}>
              <p className="wm-ph-body">Move this card to {armed.name}?</p>
              <p className="wm-ph-hint" style={{ marginTop: 6 }}>
                It arrives there with everything inside it, at the top of that board&apos;s
                backlog. What happened to it here stays here, in this board&apos;s archive.
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  className="wm-ph-btn wm-ph-btn--primary"
                  disabled={busy}
                  onClick={() => moveToBoard(armed)}
                >
                  {busy ? "Moving…" : "Move"}
                </button>
                <button
                  type="button"
                  className="wm-ph-btn wm-ph-btn--ghost"
                  disabled={busy}
                  onClick={() => setArmed(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <ul className="wm-ph-picker">
              {others.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className="wm-ph-row"
                    aria-label={`Move this card to ${b.name}`}
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setArmed({ id: b.id, name: b.name });
                    }}
                  >
                    <span aria-hidden className="wm-ph-body wm-ph-clamp2" style={{ flex: 1 }}>
                      {b.name}
                    </span>
                    <span aria-hidden style={{ color: "var(--text-lo)", display: "flex" }}>
                      <Chevron />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && (
        <p className="wm-ph-hint" style={{ marginTop: 8, color: "var(--now)" }} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
