"use client";

import { useEffect, useState, useTransition } from "react";
import type { Item } from "@/lib/types";
import type { LISTS } from "@/lib/lists";
import { setDailyDoneAction, toggleDoneAction } from "@/app/actions";
import { effectiveDone, localToday } from "@/lib/recurrence";

type ListDef = (typeof LISTS)[number];

// Recency → 0..1 (1 = touched just now). Halves roughly every ~4 days.
function recencyAmount(updatedAt: string): number {
  const ageHours = (Date.now() - new Date(updatedAt).getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours)) return 0;
  return Math.max(0, Math.min(1, Math.exp(-ageHours / 96)));
}
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

export default function ItemCard({
  item,
  childItems,
  selected = false,
  muted = false,
  onSelect,
  onOpenCard,
}: {
  item: Item;
  allLists: readonly ListDef[];
  childItems?: Item[];
  selected?: boolean;
  muted?: boolean;
  onSelect?: (item: Item, mode: "toggle" | "range") => void;
  onOpenCard: (item: Item) => void;
}) {
  const isDaily = item.recurrence === "daily";
  const [doneLocal, setDoneLocal] = useState(effectiveDone(item));
  useEffect(() => setDoneLocal(effectiveDone(item)), [item]);
  const [, startTransition] = useTransition();

  function toggleDone() {
    const next = !doneLocal;
    setDoneLocal(next);
    if (isDaily) {
      startTransition(() => setDailyDoneAction(item.id, next ? localToday() : null));
    } else {
      startTransition(() => toggleDoneAction(item.id, next));
    }
  }

  const hasDetails = item.details.trim().length > 0;
  const subTotal = childItems?.length ?? 0;
  const subDone = childItems?.filter((c) => effectiveDone(c)).length ?? 0;

  // Signature: a muted warm left edge that tracks recency (no glow; dim when done).
  const amt = recencyAmount(item.updated_at) * (doneLocal ? 0.18 : 1);
  const edge = `rgb(${lerp(35, 176, amt)}, ${lerp(43, 138, amt)}, ${lerp(69, 92, amt)})`;

  return (
    <div
      className={`card-in group rounded-lg border bg-[var(--surface)] transition-colors duration-150 ${
        selected
          ? "border-[var(--now)] bg-[var(--surface-2)] ring-1 ring-[var(--now)]"
          : "border-[var(--veil-soft)] hover:border-[var(--veil)] hover:bg-[var(--surface-2)]"
      } ${muted ? "opacity-40" : ""}`}
      style={{ borderLeft: `2px solid ${edge}` }}
    >
      <div className="flex items-start gap-2 py-1.5 pl-2 pr-2">
        <button
          aria-label={doneLocal ? "Mark not done" : "Mark done"}
          onClick={toggleDone}
          onKeyDown={(e) => e.stopPropagation()}
          className={`mt-[3px] grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full border transition-colors ${
            doneLocal
              ? "border-[var(--done)] bg-[var(--done)]"
              : "border-[var(--text-lo)] hover:border-[var(--now)]"
          }`}
        >
          {doneLocal && (
            <svg viewBox="0 0 12 12" className="check-pop h-2 w-2 text-[var(--bg-0)]">
              <path
                d="M2.5 6.3l2.1 2.1 4.9-4.9"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        <button
          onClick={(e) => {
            // ⌘/Ctrl-click toggles selection, Shift-click extends a range; a plain
            // click still opens the card. (Mac ⌘ or Windows/Linux Ctrl.)
            if (onSelect && (e.metaKey || e.ctrlKey)) onSelect(item, "toggle");
            else if (onSelect && e.shiftKey) onSelect(item, "range");
            else onOpenCard(item);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className={`min-w-0 flex-1 break-words text-left text-[13.5px] leading-snug ${
            doneLocal ? "text-[var(--text-lo)] line-through" : "text-[var(--text-hi)]"
          }`}
        >
          {item.text}
        </button>

        {subTotal > 0 && (
          <span
            className="mt-[1px] shrink-0 rounded-full border border-[var(--veil)] px-1.5 py-[1px] text-[10px] leading-none tabular-nums text-[var(--text-lo)]"
            title={`${subDone} of ${subTotal} sub-cards done`}
          >
            ↳ {subDone}/{subTotal}
          </span>
        )}
        {isDaily && (
          <span className="mt-[1px] shrink-0 text-[11px] leading-none text-[var(--text-lo)]" title="Repeats daily" aria-hidden>
            ↻
          </span>
        )}
        {hasDetails && (
          <span
            className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: "var(--past)" }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
