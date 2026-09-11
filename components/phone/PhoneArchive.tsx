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

// The last list this board answered with, kept across the component's own lifetime.
// Opening an archived card is an `asLevel` push (see the row below): PhoneSheetHost
// keys sheets on kind, so the archive UNMOUNTS while the card sheet is up and mounts
// again when the back gesture pops that level. Fetch-on-mount alone puts the sheet
// back on "Loading…" every time — and that refetch is issued from inside the popstate
// handler, where a dev server can drop it on the floor and leave the sheet loading
// forever with nothing to do but close it. So the list is seeded from here and the
// fetch only ever REPLACES what is already on screen. It is one board's rows, keyed by
// board id and only read back for that same board, so nothing crosses a board.
let cached: { boardId: string | null; items: Item[] } | null = null;

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
  const [items, setItems] = useState<Item[] | null>(() =>
    cached && cached.boardId === boardId ? cached.items : null,
  );
  const [q, setQ] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    setFailed(false);
    archivedItemsAction(boardId).then(
      (res) => {
        cached = { boardId, items: res };
        if (alive) setItems(res);
      },
      // A refused or aborted fetch must not leave the sheet on "Loading…" with no way
      // out: with nothing cached there is a line and a Try again, and with a cached
      // list the rows simply stay as they were.
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [boardId, attempt]);

  const shownItems = useMemo(
    () => (items && q.trim() ? searchItems(items, q, items.length).map((h) => h.item) : items),
    [items, q],
  );

  // Optimistic: the row leaves the list immediately, the write follows behind it —
  // the same pattern ArchiveView.tsx's restore() uses.
  function restore(id: string) {
    setItems((cur) => cur?.filter((i) => i.id !== id) ?? cur);
    // The seed for the next mount has to lose the row too, or a restored card comes
    // back to the archive on the way out of the card sheet.
    if (cached && cached.boardId === boardId) {
      cached = { boardId, items: cached.items.filter((i) => i.id !== id) };
    }
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
          failed ? (
            <div className="wm-ph-pad">
              <p className="wm-ph-hint" role="alert">
                The archive didn&apos;t load.
              </p>
              <button
                type="button"
                className="wm-ph-btn wm-ph-btn--auto"
                style={{ marginTop: 10 }}
                onClick={() => setAttempt((n) => n + 1)}
              >
                Try again
              </button>
            </div>
          ) : (
            <p className="wm-ph-hint wm-ph-pad">Loading…</p>
          )
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
