"use client";

import { useState, useTransition } from "react";
import type { Item } from "@/lib/types";
import { demoteToCardAction, promoteSubtreeAction, setLinkedBoardAction } from "@/app/actions";
import { createBoardFromCardAction } from "@/app/boards/actions";
import { useDoorways } from "../board-context";

// Card ↔ board doorways (spec 2026-08-30), the phone's "Opens" section — mirrors
// desktop CardPanel.tsx's picker + promote/demote/create verbs (~703-802), but in
// the phone's own idiom: a chip strip to pick the board (like Move to / Repeats),
// not a <select>, because this app's only board-destination control anywhere is a
// chip. Rendered inside the card sheet's expanded editor, which already gutters
// its content — this component adds no horizontal padding of its own.
//
// Self-contained: it reads `doorways`/`myBoards` itself off the same
// DoorwaysProvider the desktop tree reads, and owns its own busy/error state, so
// wiring it into PhoneCardSheet.tsx is one import + one render.
export default function PhoneCardDoorway({
  item,
  boardId,
  childCount,
  onChanged,
}: {
  item: Item;
  boardId: string | null;
  childCount: number;
  onChanged: () => void;
}) {
  const { doorways, myBoards } = useDoorways();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  // Same gates as the desktop picker: the daily note can't open a board, and local
  // + demo (no boards at all) render nothing rather than an inert control.
  if (item.list === "note" || myBoards.length === 0) return null;

  const linkedTo = item.linked_board_id;
  const linkedMeta = linkedTo ? doorways[linkedTo] ?? null : null;

  function run(work: () => Promise<string | null>) {
    setError(null);
    setBusy(true);
    startTransition(async () => {
      const err = await work();
      setBusy(false);
      if (err) setError(err);
      else onChanged();
    });
  }

  return (
    <>
      <p className="wm-ph-sect" style={{ padding: "18px 0 6px" }}>
        Opens
      </p>
      <div className="wm-ph-chips" style={{ marginTop: 6 }} role="group" aria-label="Opens board">
        <button
          type="button"
          className="wm-ph-chip"
          aria-pressed={!linkedTo}
          disabled={busy}
          onClick={() => run(() => setLinkedBoardAction(boardId, item.id, null))}
        >
          No board
        </button>
        {/* A card can't open the board it's already on. */}
        {myBoards
          .filter((b) => b.id !== boardId)
          .map((b) => (
            <button
              key={b.id}
              type="button"
              className="wm-ph-chip"
              aria-pressed={linkedTo === b.id}
              disabled={busy}
              onClick={() => run(() => setLinkedBoardAction(boardId, item.id, b.id))}
            >
              {b.name}
            </button>
          ))}
        {/* A board this viewer isn't on stays selectable-as-is but unnamed. */}
        {linkedTo && !myBoards.some((b) => b.id === linkedTo) && (
          <span className="wm-ph-chip" aria-pressed="true" style={{ opacity: 0.7 }}>
            a board you&apos;re not on
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {linkedTo ? (
          <>
            {linkedMeta && (
              <a
                href={`/b/${linkedTo}`}
                className="wm-ph-btn wm-ph-btn--ghost wm-ph-btn--auto"
              >
                Open &ldquo;{linkedMeta.name}&rdquo; ›
              </a>
            )}
            {childCount > 0 && (
              <button
                type="button"
                className="wm-ph-btn wm-ph-btn--ghost wm-ph-btn--auto"
                disabled={busy}
                title="Archive these sub-cards here and recreate them on that board, nesting and all"
                onClick={() => run(() => promoteSubtreeAction(boardId, item.id))}
              >
                Move sub-cards there
              </button>
            )}
            <button
              type="button"
              className="wm-ph-btn wm-ph-btn--ghost wm-ph-btn--auto"
              disabled={busy}
              title="Bring that board's cards back as sub-cards of this one. The board itself is left alone."
              onClick={() => run(() => demoteToCardAction(boardId, item.id))}
            >
              Convert back to card
            </button>
          </>
        ) : (
          <button
            type="button"
            className="wm-ph-btn wm-ph-btn--auto"
            disabled={busy}
            onClick={() => run(() => createBoardFromCardAction(boardId, item.id))}
          >
            New board from this card
          </button>
        )}
      </div>

      {linkedMeta && (
        <p className="wm-ph-hint" style={{ marginTop: 6 }}>
          <span className="wm-ph-num">{linkedMeta.open}</span> open{" "}
          {linkedMeta.open === 1 ? "card" : "cards"} behind this door.
        </p>
      )}
      {linkedTo && !linkedMeta && (
        <p className="wm-ph-hint" style={{ marginTop: 6 }}>
          This card opens a board you&apos;re not on.
        </p>
      )}
      {error && (
        <p className="wm-ph-hint" style={{ marginTop: 6, color: "var(--now)" }}>
          {error}
        </p>
      )}
    </>
  );
}
