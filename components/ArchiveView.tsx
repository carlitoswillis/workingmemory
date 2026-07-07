"use client";

import { useEffect, useState, useTransition } from "react";
import { archivedItemsAction, unarchiveItemAction } from "@/app/actions";
import type { Item } from "@/lib/types";

// Browse + restore archived items. Archiving is non-destructive (full history is
// kept) but had no UI — this is the "where did it go" drawer. Self-contained: owns
// its open state, loads archived items on open via a server action, and restores a
// row optimistically (unarchiveItemAction revalidates "/" so the board picks it back
// up; the restore is itself logged to history by a DB trigger — see lib/schema.ts).
const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function ArchiveView({
  boardId,
  listLabels,
}: {
  boardId: string | null;
  listLabels: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [, startTransition] = useTransition();

  function openView() {
    setOpen(true);
    setItems(null);
    archivedItemsAction(boardId).then(setItems);
  }

  function restore(id: string) {
    setItems((cur) => cur?.filter((i) => i.id !== id) ?? cur);
    startTransition(() => unarchiveItemAction(boardId, id));
  }

  // Esc closes while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={openView}
        title="Browse & restore archived items"
        className="flex items-center gap-1.5 rounded-lg border border-[var(--veil-soft)] px-3 py-1.5 text-xs text-[var(--text-mid)] transition-colors hover:border-[var(--text-lo)] hover:text-[var(--text-hi)]"
      >
        Archive
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[2px]" />
          <aside
            onClick={(e) => e.stopPropagation()}
            className="card-in relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-[var(--veil)] bg-[var(--bg-1)] p-6 shadow-2xl"
          >
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-medium tracking-tight text-[var(--text-hi)]">
                  Archive
                </h2>
                {items && items.length > 0 && (
                  <span className="text-[11px] tabular-nums text-[var(--text-lo)]">
                    {items.length}
                  </span>
                )}
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-sm text-[var(--text-lo)] hover:bg-[var(--surface-2)] hover:text-[var(--text-hi)]"
              >
                ✕
              </button>
            </div>

            <p className="mb-4 px-0.5 text-[11px] leading-relaxed text-[var(--text-lo)]">
              Archived items keep their full history. Restore one to put it back on the
              board, exactly where its list is now.
            </p>

            {items === null ? (
              <p className="px-0.5 font-display text-sm italic text-[var(--text-lo)]">
                Remembering…
              </p>
            ) : items.length === 0 ? (
              <p className="px-0.5 font-display text-sm italic text-[var(--text-lo)]">
                Nothing archived — the board is all there is.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((it) => {
                  const preview = it.details.trim();
                  return (
                    <li
                      key={it.id}
                      className="rounded-lg border border-[var(--veil-soft)] bg-[var(--surface)] p-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm leading-snug text-[var(--text-hi)]">
                            {it.text}
                          </p>
                          {preview && (
                            <p className="mt-1 line-clamp-2 font-display text-xs italic leading-snug text-[var(--text-lo)]">
                              {preview}
                            </p>
                          )}
                          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-lo)]">
                            <span className="rounded-full border border-[var(--veil)] px-1.5 py-[1px]">
                              {listLabels[it.list] ?? it.list}
                            </span>
                            <span>archived {fmt(it.updated_at)}</span>
                          </p>
                        </div>
                        <button
                          onClick={() => restore(it.id)}
                          className="shrink-0 rounded-md border border-[var(--veil)] px-2.5 py-1 text-xs text-[var(--text-mid)] transition-colors hover:border-[var(--now)] hover:text-[var(--now)]"
                        >
                          Restore
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
