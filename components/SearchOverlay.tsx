"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "@/lib/types";
import { searchItems, type HistoryHit, type SearchHit } from "@/lib/search";
import { deepSearchAction } from "@/app/actions";
import { useBoardId } from "./board-context";

// Find anything on this board: "/" (or the Search button) opens it, type, ↑/↓ to walk
// the results, Enter opens the card, Esc closes.
//
// Three layers, because the board is only the present tense:
//   1. On the board — matched locally against the cards the browser already has, so
//      it's instant and needs no server round-trip. Sub-cards included.
//   2. Archived — cards you put away; opening one gives you its panel + Restore.
//   3. In history — the append-only event log (lib/queries.ts#searchHistory): what a
//      card USED to say, including wording you've since edited away. This is the part
//      no other board app can do, and the reason search exists here at all.
// 2 and 3 are one debounced server action (deepSearchAction); 1 re-runs per keystroke.

type Row =
  | { kind: "board"; hit: SearchHit }
  | { kind: "archived"; hit: SearchHit }
  | { kind: "history"; hit: HistoryHit };

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function Highlight({
  snippet,
  start,
  length,
  className = "",
}: {
  snippet: string;
  start: number;
  length: number;
  className?: string;
}) {
  return (
    <>
      {snippet.slice(0, start)}
      <mark className={`bg-transparent text-[var(--now)] ${className}`}>
        {snippet.slice(start, start + length)}
      </mark>
      {snippet.slice(start + length)}
    </>
  );
}

export default function SearchOverlay({
  open,
  items,
  listLabels,
  onPick,
  onClose,
}: {
  open: boolean;
  items: Item[];
  listLabels: Record<string, string>;
  onPick: (itemId: string) => void;
  onClose: () => void;
}) {
  const boardId = useBoardId();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [deep, setDeep] = useState<{ archived: SearchHit[]; history: HistoryHit[] } | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const boardHits = useMemo(() => searchItems(items, q), [items, q]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      setDeep(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);
  useEffect(() => setCursor(0), [q]);

  // The archive + history trip: debounced, and only once there's something worth
  // asking about (a single letter would match half the board's history).
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (query.length < 2) {
      setDeep(null);
      setDeepLoading(false);
      return;
    }
    setDeepLoading(true);
    let alive = true;
    const t = setTimeout(() => {
      deepSearchAction(boardId, query)
        .then((res) => alive && setDeep(res))
        .finally(() => alive && setDeepLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, q, boardId]);

  const rows: Row[] = useMemo(
    () => [
      ...boardHits.map((hit) => ({ kind: "board" as const, hit })),
      ...(deep?.archived ?? []).map((hit) => ({ kind: "archived" as const, hit })),
      ...(deep?.history ?? []).map((hit) => ({ kind: "history" as const, hit })),
    ],
    [boardHits, deep],
  );

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  function choose(row: Row) {
    onPick(row.kind === "history" ? row.hit.event.item_id : row.hit.item.id);
    onClose();
  }

  // Keep the overlay's keys away from Board's global handler (hotkeys / undo).
  function onKeyDown(e: React.KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (rows.length === 0 ? 0 : (c + 1) % rows.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (rows.length === 0 ? 0 : (c - 1 + rows.length) % rows.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[cursor];
      if (row) choose(row);
    }
  }

  const section = (i: number): string | null => {
    const kind = rows[i].kind;
    if (i > 0 && rows[i - 1].kind === kind) return null;
    if (kind === "board") return "On the board";
    if (kind === "archived") return "Archived";
    return "In history";
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]"
      style={{ background: "var(--scrim-deep)" }}
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Search cards"
    >
      <div
        className="card-in flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[var(--veil)] bg-[var(--surface)] shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="p-4 pb-3">
          <div className="mb-2.5 flex items-center gap-2 px-0.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--now)" }}
              aria-hidden
            />
            <span className="font-display text-sm font-medium tracking-tight text-[var(--text-mid)]">
              Search
            </span>
            <span className="text-[11px] text-[var(--text-lo)]">
              board, archive + everything it used to say
            </span>
          </div>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Find a card, or a thought you've since edited away…"
            className="w-full rounded-xl border border-[var(--veil-soft)] bg-[var(--field)] px-3.5 py-2.5 text-[15px] text-[var(--text-hi)] placeholder:text-[var(--text-lo)] transition-colors focus:border-[var(--now)] focus:outline-none"
          />
        </div>

        {q.trim() && (
          <div
            ref={listRef}
            className="max-h-[52vh] overflow-y-auto border-t border-[var(--veil-soft)] px-2 py-2"
          >
            {rows.length === 0 ? (
              <p className="px-2.5 py-2 font-display text-sm italic text-[var(--text-lo)]">
                {deepLoading ? "Remembering…" : "Nothing on this board matches that."}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {rows.map((row, i) => {
                  const head = section(i);
                  const active = i === cursor;
                  const key =
                    row.kind === "history"
                      ? `h-${row.hit.event.id}`
                      : `${row.kind}-${row.hit.item.id}`;
                  return (
                    <li key={key}>
                      {head && (
                        <p className="mb-1 mt-2 px-2.5 text-[10px] uppercase tracking-[0.14em] text-[var(--text-lo)] first:mt-0">
                          {head}
                        </p>
                      )}
                      <button
                        data-active={active}
                        onClick={() => choose(row)}
                        onMouseEnter={() => setCursor(i)}
                        className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                          active ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]"
                        }`}
                      >
                        {row.kind === "history" ? (
                          <>
                            <p className="break-words text-[13.5px] leading-snug text-[var(--text-hi)]">
                              {row.hit.event.item_text}
                            </p>
                            <p className="mt-0.5 break-words font-display text-xs italic leading-snug text-[var(--text-lo)]">
                              <Highlight {...row.hit} className="not-italic" />
                            </p>
                            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-lo)]">
                              <span className="rounded-full border border-[var(--veil)] px-1.5 py-[1px]">
                                {row.hit.side === "old"
                                  ? row.hit.event.type === "created"
                                    ? "as first captured"
                                    : "used to say"
                                  : row.hit.event.field === "details"
                                    ? "written in details"
                                    : "renamed to"}
                              </span>
                              <span>{fmtDay(row.hit.event.at)}</span>
                              {row.hit.event.item_archived ? <span>· archived</span> : null}
                            </p>
                          </>
                        ) : (
                          <>
                            <p
                              className={`break-words text-[13.5px] leading-snug ${
                                row.hit.item.done
                                  ? "text-[var(--text-lo)] line-through"
                                  : "text-[var(--text-hi)]"
                              }`}
                            >
                              {row.hit.field === "text" ? (
                                <Highlight {...row.hit} />
                              ) : (
                                row.hit.item.text
                              )}
                            </p>
                            {row.hit.field === "details" && (
                              <p className="mt-0.5 break-words font-display text-xs italic leading-snug text-[var(--text-lo)]">
                                <Highlight {...row.hit} className="not-italic" />
                              </p>
                            )}
                            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-lo)]">
                              <span className="rounded-full border border-[var(--veil)] px-1.5 py-[1px]">
                                {listLabels[row.hit.item.list] ?? row.hit.item.list}
                              </span>
                              {row.kind === "archived" && <span>archived</span>}
                              {row.hit.item.parent_id && byId.get(row.hit.item.parent_id) && (
                                <span className="truncate">
                                  ↳ in “{byId.get(row.hit.item.parent_id)!.text}”
                                </span>
                              )}
                            </p>
                          </>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-[var(--veil-soft)] px-4 py-2 text-[11px] text-[var(--text-lo)]">
          <span>
            <kbd className="font-grotesk text-[var(--text-mid)]">↑↓</kbd> to move ·{" "}
            <kbd className="font-grotesk text-[var(--text-mid)]">Enter</kbd> to open ·{" "}
            <kbd className="font-grotesk text-[var(--text-mid)]">Esc</kbd> to close
          </span>
          {q.trim() && (
            <span className="tabular-nums">
              {deepLoading ? "searching the past…" : rows.length > 0 ? `${rows.length} found` : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
