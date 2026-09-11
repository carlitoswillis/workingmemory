"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { archivedItemsAction, unarchiveItemAction } from "@/app/actions";
import { searchItems } from "@/lib/search";
import type { Item } from "@/lib/types";
import { usePhoneUI } from "./PhoneShell";
import { Sheet, fieldFocusProps, useSheetOpen } from "./Sheet";
import { usePhoneBoardData } from "./phone-data";

// Archive (§A3 / §B of ai/plans/2026-09-10-phone-lost-features-and-bugs.md): every
// archived card on this board, newest-archived first, with a filter and a Restore
// action per row. Modeled on components/ArchiveView.tsx's behaviour — load once on
// open, filter locally with the board's own matcher, restore optimistically — but in
// the phone's row grammar (see PhoneBoards.tsx) rather than the desktop's card list.
// Tapping a row opens the card sheet to read it, same as a board row would.

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function PhoneArchive() {
  const { close, open } = usePhoneUI();
  const { open: shown } = useSheetOpen();
  const { boardId, listLabels } = usePhoneBoardData();
  const [items, setItems] = useState<Item[] | null>(null);
  const [q, setQ] = useState("");
  const [, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    archivedItemsAction(boardId).then((res) => {
      if (alive) setItems(res);
    });
    return () => {
      alive = false;
    };
  }, [boardId]);

  const shownItems = useMemo(
    () => (items && q.trim() ? searchItems(items, q, items.length).map((h) => h.item) : items),
    [items, q],
  );

  // Optimistic: the row leaves the list immediately, the write follows behind it —
  // the same pattern ArchiveView.tsx's restore() uses.
  function restore(id: string) {
    setItems((cur) => cur?.filter((i) => i.id !== id) ?? cur);
    startTransition(() => {
      unarchiveItemAction(boardId, id).catch(() => {});
    });
  }

  return (
    <Sheet
      open={shown}
      onOpenChange={(o) => !o && close()}
      label="Archive"
      heightSvh={88}
      className="wm-sheet--ledger"
    >
      <div className="wm-sheet__head">
        <p className="wm-ph-title" style={{ flex: 1 }}>
          Archive
        </p>
      </div>

      <div className="wm-sheet__scroll">
        {items && items.length > 0 && (
          <div className="wm-ph-pad" style={{ paddingBottom: 6 }}>
            <input
              className="wm-ph-field"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter the archive…"
              aria-label="Filter the archive"
              {...fieldFocusProps()}
            />
          </div>
        )}

        {items === null ? (
          <p className="wm-ph-hint wm-ph-pad">Loading…</p>
        ) : items.length === 0 ? (
          <p className="wm-ph-hint wm-ph-pad">Nothing archived — the board is all there is.</p>
        ) : shownItems && shownItems.length === 0 ? (
          <p className="wm-ph-hint wm-ph-pad">Nothing archived matches that.</p>
        ) : (
          <ul>
            {(shownItems ?? []).map((it) => (
              <li key={it.id} className="wm-ph-row wm-ph-row--ledger" style={{ gap: 8 }}>
                <button
                  type="button"
                  // A level ABOVE the archive, not a replacement for it: reading an
                  // archived card is a step into the list, so one back gesture comes
                  // straight back to it. Opening it flat closed the archive and left
                  // the board bare, and getting back meant More → Archive → scroll
                  // again for every card you wanted to look at.
                  onClick={() => open({ kind: "card", itemId: it.id }, { asLevel: true })}
                  aria-label={`Open ${it.text}, in ${listLabels[it.list] ?? it.list}, archived ${fmt(it.updated_at)}`}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    textAlign: "left",
                    background: "none",
                    border: 0,
                    padding: 0,
                    font: "inherit",
                    color: "inherit",
                  }}
                >
                  <span aria-hidden className="wm-ph-body wm-ph-clamp2" style={{ display: "block" }}>
                    {it.text}
                  </span>
                  <span aria-hidden className="wm-ph-caption" style={{ display: "block", marginTop: 2 }}>
                    {listLabels[it.list] ?? it.list}, archived {fmt(it.updated_at)}
                  </span>
                </button>
                <button
                  type="button"
                  className="wm-ph-chip"
                  aria-label={`Restore ${it.text}`}
                  onClick={() => restore(it.id)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
