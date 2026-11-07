"use client";

import { useState } from "react";
import { SortableContext } from "@dnd-kit/sortable";
import type { Item } from "@/lib/types";
import { MAX_LIST_LABEL, type ListDef } from "@/lib/lists";
import { stillStrategy } from "@/lib/dnd";
import { effectiveDone } from "@/lib/recurrence";
import ItemCard from "./ItemCard";
import SortableItemCard from "./SortableItemCard";

export default function Column({
  list,
  allLists,
  items,
  childrenByParent,
  selection,
  activeId,
  nestTargetId,
  dropLine,
  canDelete,
  onSelect,
  onOpenCard,
  onArchive,
  onAdd,
  onRename,
  onDelete,
  dragHandleProps,
}: {
  list: ListDef;
  allLists: readonly ListDef[];
  items: Item[];
  childrenByParent: Map<string, Item[]>;
  selection: Set<string>;
  activeId: string | null;
  nestTargetId: string | null; // the card a release would drop INTO, if any
  // Where the drop line goes in THIS column, if the drag is over it: above the named
  // card, or below the last one (beforeId null). Absent = the drag is somewhere else.
  dropLine?: { beforeId: string | null } | null;
  canDelete: boolean;
  onSelect: (item: Item, mode: "toggle" | "range") => void;
  onOpenCard: (item: Item) => void;
  onArchive: (item: Item) => void;
  onAdd: (listId: string, text: string) => void;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dragHandleProps?: any;
}) {
  // Inline rename: click the title (or the ✎) to edit it in place.
  const [renaming, setRenaming] = useState(false);
  const [draftLabel, setDraftLabel] = useState(list.label);
  function commitRename() {
    const name = draftLabel.trim();
    setRenaming(false);
    if (name && name !== list.label) onRename(list.id, name);
    else setDraftLabel(list.label);
  }
  // While dragging a multi-selection, dim the other selected cards (they'll snap to
  // the dropped block on release).
  const mutedId = (id: string) => activeId != null && id !== activeId && selection.has(id);
  const [draft, setDraft] = useState("");

  // Daily tasks done *today* count as done; tomorrow they're open again.
  const open = items.filter((i) => !effectiveDone(i));
  const done = items.filter((i) => effectiveDone(i));
  const openIds = open.map((i) => i.id);

  // Enter submits; so does leaving the field with something typed in it (owner call
  // 2026-07-23: "deselecting the text box should create the card / push enter for u").
  // A half-typed thought is never silently thrown away.
  function commitDraft() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onAdd(list.id, text); // optimistic insert lives in Board (owns the card lists)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    commitDraft();
  }

  const isNow = list.id === "today";

  return (
    <section
      data-drop-zone={list.id}
      className={`flex min-h-[220px] flex-col rounded-2xl border p-3 ${
        isNow ? "col-now" : "border-[var(--veil-soft)] bg-[var(--wash)]"
      }`}
    >
      <div className="group group/col mb-3 px-1.5 pt-1">
        <div className="flex items-baseline justify-between gap-1">
          {/* The handle hangs in the column's left padding, so the title and its hint
              share one left edge whether or not the handle is showing. */}
          <div className="relative flex min-w-0 flex-1 items-center">
            {dragHandleProps && (
              <button
                {...dragHandleProps}
                aria-label="Drag to reorder columns"
                title="Drag to reorder"
                className="card-actions absolute -left-4 top-1/2 -translate-y-1/2 cursor-grab touch-none px-0.5 leading-none text-[var(--text-lo)] hover:text-[var(--text-mid)] active:cursor-grabbing"
              >
                ⠿
              </button>
            )}
            {renaming ? (
              <input
                autoFocus
                value={draftLabel}
                maxLength={MAX_LIST_LABEL}
                onChange={(e) => setDraftLabel(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") {
                    setDraftLabel(list.label);
                    setRenaming(false);
                  }
                }}
                onBlur={commitRename}
                className="min-w-0 flex-1 rounded border border-[var(--veil)] bg-[var(--bg-0)] px-1 py-0.5 font-display text-[15px] font-medium tracking-tight text-[var(--text-hi)] focus:border-[var(--now)] focus:outline-none"
              />
            ) : (
              <button
                onClick={() => {
                  setDraftLabel(list.label);
                  setRenaming(true);
                }}
                title="Rename column"
                className="min-w-0 truncate text-left font-display text-[15px] font-medium tracking-tight text-[var(--text-hi)]"
              >
                {list.label}
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!renaming && (
              <div className="card-actions flex items-center gap-0.5">
                <button
                  onClick={() => {
                    setDraftLabel(list.label);
                    setRenaming(true);
                  }}
                  aria-label="Rename column"
                  title="Rename column"
                  className="rounded px-1 py-0.5 text-[11px] text-[var(--text-lo)] hover:bg-[var(--surface-2)] hover:text-[var(--text-mid)]"
                >
                  ✎
                </button>
                {canDelete && (
                  <button
                    onClick={() => onDelete(list.id)}
                    aria-label="Delete column"
                    title="Delete column"
                    className="rounded px-1 py-0.5 text-[11px] text-[var(--text-lo)] hover:bg-[var(--surface-2)] hover:text-[var(--text-hi)]"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
            <span className="font-grotesk text-[11px] tabular-nums text-[var(--text-lo)]">
              {open.length || ""}
            </span>
          </div>
        </div>
        {list.hint && (
          <p className="mt-0.5 text-[11px] leading-tight text-[var(--text-lo)]">{list.hint}</p>
        )}
      </div>

      {/* A line of the column until you use it: no box at rest, the field ground
          and hairline only on hover/focus. Always present, so touch can reach it. */}
      <form onSubmit={submit} className="wm-addline-wrap mb-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          placeholder="Add a card"
          aria-label={`Add a card to ${list.label}`}
          className="wm-addline"
        />
      </form>

      <div className="flex flex-1 flex-col gap-1.5">
        {/* Cards hold still under a drag (stillStrategy); the drop point is the line. */}
        <SortableContext items={openIds} strategy={stillStrategy}>
          <div className="flex min-h-[8px] flex-col gap-1.5">
            {open.map((item, i) => (
              <SortableItemCard
                key={item.id}
                item={item}
                allLists={allLists}
                childItems={childrenByParent.get(item.id)}
                selected={selection.has(item.id)}
                muted={mutedId(item.id)}
                nestTarget={nestTargetId === item.id}
                dropEdge={
                  !dropLine
                    ? undefined
                    : dropLine.beforeId === item.id
                      ? "top"
                      : dropLine.beforeId === null && i === open.length - 1
                        ? "bottom"
                        : undefined
                }
                onSelect={onSelect}
                onOpenCard={onOpenCard}
                onArchive={onArchive}
              />
            ))}
          </div>
        </SortableContext>
        {dropLine && open.length === 0 && (
          <div aria-hidden className="h-[2px] rounded-full bg-[var(--now)]" />
        )}

        {open.length === 0 && done.length === 0 && (
          <p className="px-2 pt-1 text-[11px] leading-4 text-[var(--text-lo)]">
            Nothing here yet.
          </p>
        )}
      </div>

      {done.length > 0 && (
        <div className="mt-4 border-t border-[var(--veil-soft)] pt-3">
          <p className="wm-label mb-2 flex gap-2 px-1.5">
            Done <span className="font-normal tabular-nums">{done.length}</span>
          </p>
          <div className="flex flex-col gap-1.5">
            {done.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                allLists={allLists}
                childItems={childrenByParent.get(item.id)}
                selected={selection.has(item.id)}
                onSelect={onSelect}
                onOpenCard={onOpenCard}
                onArchive={onArchive}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
