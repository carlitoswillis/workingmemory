"use client";

import { useState, useTransition } from "react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Item } from "@/lib/types";
import type { LISTS } from "@/lib/lists";
import { addItemAction } from "@/app/actions";
import { effectiveDone } from "@/lib/recurrence";
import ItemCard from "./ItemCard";
import SortableItemCard from "./SortableItemCard";

type ListDef = (typeof LISTS)[number];

export default function Column({
  list,
  allLists,
  items,
  onOpenCard,
  dragHandleProps,
}: {
  list: ListDef;
  allLists: readonly ListDef[];
  items: Item[];
  onOpenCard: (item: Item) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dragHandleProps?: any;
}) {
  const [draft, setDraft] = useState("");
  const [isPending, startTransition] = useTransition();

  // Daily tasks done *today* count as done; tomorrow they're open again.
  const open = items.filter((i) => !effectiveDone(i));
  const done = items.filter((i) => effectiveDone(i));
  const openIds = open.map((i) => i.id);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    startTransition(() => addItemAction(text, list.id));
  }

  const isNow = list.id === "today";

  return (
    <section
      className={`flex min-h-[220px] flex-col rounded-2xl border p-3 ${
        isNow ? "col-now" : "border-[var(--veil-soft)] bg-[rgba(20,26,46,0.35)]"
      }`}
    >
      <div className="mb-3 px-1.5 pt-1">
        <div className="flex items-baseline justify-between">
          <div className="flex items-center gap-1.5">
            {dragHandleProps && (
              <button
                {...dragHandleProps}
                aria-label="Drag to reorder columns"
                title="Drag to reorder"
                className="cursor-grab touch-none leading-none text-[var(--text-lo)] hover:text-[var(--text-mid)] active:cursor-grabbing"
              >
                ⠿
              </button>
            )}
            <h2 className="font-display text-[15px] font-medium tracking-tight text-[var(--text-hi)]">
              {list.label}
            </h2>
          </div>
          <span className="font-grotesk text-[11px] tabular-nums text-[var(--text-lo)]">
            {open.length || ""}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] leading-tight text-[var(--text-lo)]">{list.hint}</p>
      </div>

      <form onSubmit={submit} className="mb-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Capture a thought…"
          className="w-full rounded-xl border border-[var(--veil-soft)] bg-[rgba(8,10,18,0.5)] px-3 py-2 text-sm text-[var(--text-hi)] placeholder:text-[var(--text-lo)] transition-colors focus:border-[var(--now)] focus:outline-none"
          disabled={isPending}
        />
      </form>

      <div className="flex flex-1 flex-col gap-1.5">
        <SortableContext items={openIds} strategy={verticalListSortingStrategy}>
          <div className="flex min-h-[8px] flex-col gap-1.5">
            {open.map((item) => (
              <SortableItemCard
                key={item.id}
                item={item}
                allLists={allLists}
                onOpenCard={onOpenCard}
              />
            ))}
          </div>
        </SortableContext>

        {open.length === 0 && done.length === 0 && (
          <p className="px-1.5 pt-2 font-display text-xs italic text-[var(--text-lo)]">
            nothing here yet
          </p>
        )}
      </div>

      {done.length > 0 && (
        <div className="mt-4 border-t border-[var(--veil-soft)] pt-3">
          <p className="mb-2 px-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--text-lo)]">
            Done · {done.length}
          </p>
          <div className="flex flex-col gap-1.5">
            {done.map((item) => (
              <ItemCard key={item.id} item={item} allLists={allLists} onOpenCard={onOpenCard} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
