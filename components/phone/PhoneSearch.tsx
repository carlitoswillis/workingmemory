"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getItemAction, searchArchivedAction } from "@/app/actions";
import { searchItems, type SearchHit } from "@/lib/search";
import { usePhoneUI } from "./PhoneShell";
import { Sheet, useSheetOpen } from "./Sheet";
import { usePhoneBoardData } from "./phone-data";

// Find (§2 E). The SAME search this app has always had, in a sheet: the ranking, the
// snippet windowing and the two layers are all lib/search.ts + searchArchivedAction,
// imported, not reimplemented. What's phone-specific is the shape — a full-height
// sheet, a 16px field, 56px result rows, and no ↑/↓/Enter affordances, because a
// phone has no arrow keys to advertise.
//
//   1. On the board — matched locally against the cards the browser already has, so
//      it's instant and needs no round-trip. Sub-cards included.
//   2. Archived — one debounced server action, and only once there are two characters
//      to ask about (a single letter drags back half the archive).
//
// Picking a result opens that card's sheet. A hit from the archive isn't on the live
// board, so it's fetched by id first — the same move Board.tsx's openById makes.

type Row = { kind: "board" | "archived"; hit: SearchHit };

function Highlight({ snippet, start, length }: SearchHit) {
  return (
    <>
      {snippet.slice(0, start)}
      <mark style={{ background: "transparent", color: "var(--now)" }}>
        {snippet.slice(start, start + length)}
      </mark>
      {snippet.slice(start + length)}
    </>
  );
}

export default function PhoneSearch() {
  const { close, open } = usePhoneUI();
  const { open: shown } = useSheetOpen();
  const { boardId, items, listLabels } = usePhoneBoardData();
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState<SearchHit[] | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const boardHits = useMemo(() => searchItems(items, q), [items, q]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setArchived(null);
      setArchiveLoading(false);
      return;
    }
    setArchiveLoading(true);
    let alive = true;
    const t = setTimeout(() => {
      searchArchivedAction(boardId, query)
        .then((res) => alive && setArchived(res))
        .finally(() => alive && setArchiveLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, boardId]);

  const rows: Row[] = useMemo(
    () => [
      ...boardHits.map((hit) => ({ kind: "board" as const, hit })),
      ...(archived ?? []).map((hit) => ({ kind: "archived" as const, hit })),
    ],
    [boardHits, archived],
  );

  async function pick(row: Row) {
    const id = row.hit.item.id;
    // An archived card isn't in `items`; make sure it exists before handing the card
    // sheet an id it can't resolve.
    if (row.kind === "archived") {
      const fetched = await getItemAction(boardId, id);
      if (!fetched) return;
    }
    open({ kind: "card", itemId: id });
  }

  const section = (i: number): string | null => {
    const kind = rows[i].kind;
    if (i > 0 && rows[i - 1].kind === kind) return null;
    return kind === "board" ? "On the board" : "Archived";
  };

  return (
    <Sheet
      open={shown}
      onOpenChange={(o) => !o && close()}
      label="Search cards"
      heightSvh={96}
      onOpenComplete={() => inputRef.current?.focus()}
    >
      <div className="wm-sheet__head" style={{ flexDirection: "column", gap: 8 }}>
        <input
          ref={inputRef}
          className="wm-ph-field"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a card by its title or details…"
          aria-label="Find a card by its title or details"
          enterKeyHint="search"
        />
      </div>

      <div className="wm-sheet__scroll">
        {!q.trim() ? (
          <p className="wm-ph-hint">Cards on the board, and in the archive.</p>
        ) : rows.length === 0 ? (
          <p className="wm-ph-hint">{archiveLoading ? "Looking…" : "No card matches that."}</p>
        ) : (
          <ul>
            {rows.map((row, i) => {
              const head = section(i);
              return (
                <li key={`${row.kind}-${row.hit.item.id}`}>
                  {head && (
                    <p
                      className="wm-ph-caption"
                      style={{
                        margin: "12px 0 4px",
                        textTransform: "uppercase",
                        letterSpacing: "0.14em",
                      }}
                    >
                      {head}
                    </p>
                  )}
                  <button type="button" className="wm-ph-row" onClick={() => pick(row)}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        className="wm-ph-body wm-ph-clamp2"
                        style={row.hit.item.done ? { color: "var(--text-lo)" } : undefined}
                      >
                        {row.hit.field === "text" ? (
                          <Highlight {...row.hit} />
                        ) : (
                          row.hit.item.text
                        )}
                      </span>
                      {row.hit.field === "details" && (
                        <span
                          className="wm-ph-caption wm-ph-clamp2"
                          style={{ display: "block", marginTop: 2 }}
                        >
                          <Highlight {...row.hit} />
                        </span>
                      )}
                      <span className="wm-ph-caption" style={{ display: "block", marginTop: 2 }}>
                        {listLabels[row.hit.item.list] ?? row.hit.item.list}
                        {row.kind === "archived" && " · archived"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
