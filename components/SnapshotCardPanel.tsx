"use client";

import dynamic from "next/dynamic";
import type { BoardItemAt } from "@/lib/timetravel";

// Shared, code-split markdown renderer — only pulled in when a past card panel opens.
const Markdown = dynamic(() => import("./Markdown"), {
  ssr: false,
  loading: () => <span className="text-sm text-[var(--text-lo)]">rendering…</span>,
});

// A read-only slide-over for a card AS IT WAS at the rewind moment. Mirrors CardPanel's
// shape (title · details · sub-cards) but nothing is editable — the past can be explored,
// not changed. Sub-cards are reconstructed for the same moment; click one to dive in.
export default function SnapshotCardPanel({
  item,
  parent,
  listLabels,
  childItems,
  asOf,
  onOpenCard,
  onClose,
}: {
  item: BoardItemAt;
  parent: BoardItemAt | null;
  listLabels: Record<string, string>;
  childItems: BoardItemAt[];
  asOf: string | null;
  onOpenCard: (id: string) => void;
  onClose: () => void;
}) {
  const subDone = childItems.filter((c) => c.done).length;
  const hasDetails = item.details.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[2px]" />
      <aside
        onClick={(e) => e.stopPropagation()}
        className="memory-mode card-in relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-[var(--veil)] bg-[var(--bg-1)] p-6 shadow-2xl"
      >
        {parent && (
          <button
            onClick={() => onOpenCard(parent.id)}
            className="mb-3 flex max-w-full items-center gap-1 self-start truncate rounded-md px-1 py-0.5 text-xs text-[var(--text-lo)] hover:text-[var(--text-mid)]"
            title={`Back to “${parent.text}”`}
          >
            <span aria-hidden>↰</span>
            <span className="truncate">{parent.text}</span>
          </button>
        )}

        <div className="mb-5 flex items-center justify-between gap-3">
          <span
            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
              item.done
                ? "border-[var(--done)] text-[var(--done)]"
                : "border-[var(--veil)] text-[var(--text-mid)]"
            }`}
          >
            <span
              className="grid h-3.5 w-3.5 place-items-center rounded-full border"
              style={{
                borderColor: item.done ? "var(--done)" : "var(--text-lo)",
                background: item.done ? "var(--done)" : "transparent",
              }}
            >
              {item.done && (
                <svg viewBox="0 0 12 12" className="h-2 w-2 text-[var(--bg-0)]">
                  <path d="M2.5 6.3l2.1 2.1 4.9-4.9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            {item.done ? "Was done" : "Was open"}
          </span>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-[var(--text-lo)] hover:bg-[var(--surface-2)] hover:text-[var(--text-hi)]"
          >
            ✕
          </button>
        </div>

        {/* Title (display only) */}
        <h2 className="px-1 font-display text-xl font-medium leading-snug text-[var(--text-hi)]">
          {item.text}
        </h2>
        <p className="mt-1 px-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-lo)]">
          {listLabels[item.list] ?? item.list}
        </p>

        {/* Details (display only) */}
        <label className="mt-4 mb-1 block px-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-lo)]">
          Details
        </label>
        {hasDetails ? (
          <div className="rounded-lg border border-[var(--veil-soft)] bg-[var(--bg-0)] px-3 py-2.5">
            <Markdown source={item.details} />
          </div>
        ) : (
          <p className="px-1 font-display text-sm italic text-[var(--text-lo)]">— no details then —</p>
        )}

        {/* Sub-cards as of then */}
        <div className="mt-5">
          <div className="mb-1 flex items-baseline justify-between px-1">
            <label className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-lo)]">
              Sub-cards
            </label>
            {childItems.length > 0 && (
              <span className="text-[11px] tabular-nums text-[var(--text-lo)]">
                {subDone}/{childItems.length} done
              </span>
            )}
          </div>
          {childItems.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {childItems.map((child) => (
                <button
                  key={child.id}
                  onClick={() => onOpenCard(child.id)}
                  className="flex items-start gap-2 rounded-lg border border-[var(--veil-soft)] border-l-2 border-l-[var(--past)] bg-[var(--surface)] py-1.5 pl-2 pr-2 text-left text-[13.5px] leading-snug hover:bg-[var(--surface-2)]"
                  title={child.details.trim() ? `${child.text}\n\n${child.details}` : child.text}
                >
                  <span
                    className="mt-[3px] grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full border"
                    style={{
                      borderColor: child.done ? "var(--done)" : "var(--text-lo)",
                      background: child.done ? "var(--done)" : "transparent",
                    }}
                  >
                    {child.done && (
                      <svg viewBox="0 0 12 12" className="h-2 w-2 text-[var(--bg-0)]">
                        <path d="M2.5 6.3l2.1 2.1 4.9-4.9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className={child.done ? "text-[var(--text-lo)] line-through" : "text-[var(--text-mid)]"}>
                    {child.text}
                  </span>
                  {child.details.trim() && (
                    <span className="mt-[6px] ml-auto h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--past)" }} aria-hidden />
                  )}
                </button>
              ))}
            </div>
          ) : (
            <p className="px-1 font-display text-xs italic text-[var(--text-lo)]">— none then —</p>
          )}
        </div>

        <p className="mt-6 border-t border-[var(--veil-soft)] pt-4 font-display text-[11px] italic text-[var(--past)]">
          as it was · {asOf ? new Date(asOf).toLocaleString() : ""} · read-only
        </p>
      </aside>
    </div>
  );
}
