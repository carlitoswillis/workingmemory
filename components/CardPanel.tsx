"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Item, ItemEvent } from "@/lib/types";
import type { LISTS } from "@/lib/lists";
import { listLabel } from "@/lib/lists";
import {
  addChildAction,
  archiveItemAction,
  editDetailsAction,
  editItemAction,
  historyAction,
  reorderItemAction,
  setDailyDoneAction,
  setRecurrenceAction,
  toggleDoneAction,
} from "@/app/actions";
import { effectiveDone, localToday } from "@/lib/recurrence";
import { currentStreak, prevDay } from "@/lib/streaks";
import dynamic from "next/dynamic";
import SortableItemCard from "./SortableItemCard";

// Code-split the markdown renderer (react-markdown + remark-gfm, ~43kB): it's only
// needed once a card panel is open, so keep it out of the initial board bundle.
const Markdown = dynamic(() => import("./Markdown"), {
  ssr: false,
  loading: () => <span className="text-sm text-[var(--text-lo)]">rendering…</span>,
});

type ListDef = (typeof LISTS)[number];

function describe(e: ItemEvent): string {
  switch (e.type) {
    case "created":
      return `Captured: “${e.new_value}”`;
    case "edited":
      return e.field === "details" ? "Edited details" : "Reworded";
    case "moved":
      return `Moved ${listLabel(e.old_value ?? "")} → ${listLabel(e.new_value ?? "")}`;
    case "completed":
      return e.field === "completed_on" ? `Checked off for ${e.new_value}` : "Marked done";
    case "reopened":
      if (e.field === "completed_on") return `Unchecked ${e.old_value}`;
      if (e.field === "archived") return "Restored from archive";
      return "Reopened";
    case "archived":
      return "Archived";
    default:
      return e.type;
  }
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function CardPanel({
  item,
  parent,
  allLists,
  childItems,
  childrenByParent,
  onOpenCard,
  onMove,
  onClose,
}: {
  item: Item;
  parent: Item | null;
  allLists: readonly ListDef[];
  childItems: Item[];
  childrenByParent: Map<string, Item[]>;
  onOpenCard: (item: Item) => void;
  onMove: (id: string, list: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(item.text);
  const [details, setDetails] = useState(item.details);
  // Optimistic list value so the dropdown reflects the pick instantly; Board moves the
  // card on the board optimistically too (onMove). Resyncs from the row on revalidate.
  const [listValue, setListValue] = useState<string>(item.list);
  // Details render as markdown at rest; click to drop into the raw textarea (editing
  // stays plain text, still change-tracked). Empty details always show the editor.
  const [editingDetails, setEditingDetails] = useState(false);
  const detailsRef = useRef<HTMLTextAreaElement>(null);
  const [childDraft, setChildDraft] = useState("");
  const [events, setEvents] = useState<ItemEvent[] | null>(null);
  const [, startTransition] = useTransition();

  const subDone = childItems.filter((c) => effectiveDone(c)).length;

  function addChild(e: React.FormEvent) {
    e.preventDefault();
    const t = childDraft.trim();
    if (!t) return;
    setChildDraft("");
    startTransition(() => addChildAction(item.id, t));
  }

  // Local (optimistic) order of the sub-cards so drag-reorder feels instant; re-syncs
  // whenever the server order/positions actually change.
  const [kids, setKids] = useState<Item[]>(childItems);
  const kidsSig = childItems.map((c) => `${c.id}:${c.position}`).join("|");
  useEffect(() => setKids(childItems), [kidsSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const childSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onChildDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldI = kids.findIndex((k) => k.id === active.id);
    const newI = kids.findIndex((k) => k.id === over.id);
    if (oldI < 0 || newI < 0) return;
    const reordered = arrayMove(kids, oldI, newI);
    setKids(reordered);
    const prev = reordered[newI - 1]?.position;
    const next = reordered[newI + 1]?.position;
    let pos: number;
    if (prev != null && next != null) pos = (prev + next) / 2;
    else if (prev != null) pos = prev + 1000;
    else if (next != null) pos = next - 1000;
    else pos = Date.now();
    const moved = reordered[newI];
    startTransition(() => reorderItemAction(moved.id, moved.list, pos));
  }

  useEffect(() => setTitle(item.text), [item.text]);
  useEffect(() => setDetails(item.details), [item.details]);
  useEffect(() => setListValue(item.list), [item.list]);
  useEffect(() => setEditingDetails(false), [item.id]); // back to preview on card switch
  useEffect(() => {
    if (editingDetails) detailsRef.current?.focus();
  }, [editingDetails]);
  useEffect(() => {
    let alive = true;
    historyAction(item.id).then((e) => alive && setEvents(e));
    return () => {
      alive = false;
    };
  }, [item.id, item.updated_at]);

  function saveTitle() {
    const t = title.trim();
    if (!t || t === item.text) return setTitle(item.text);
    startTransition(() => editItemAction(item.id, t));
  }
  function saveDetails() {
    if (details === item.details) return;
    startTransition(() => editDetailsAction(item.id, details));
  }

  const isDaily = item.recurrence === "daily";
  const effDone = effectiveDone(item);

  // Streak + last-14-days strip (daily tasks). completed_days comes from the
  // event log via lib/queries.ts; fold in the live checkbox so the display
  // tracks an optimistic toggle without waiting for the refetch.
  const today = localToday();
  const dayset = new Set(item.completed_days ?? []);
  if (isDaily) {
    if (effDone) dayset.add(today);
    else dayset.delete(today);
  }
  const streak = isDaily ? currentStreak(dayset, today) : 0;
  const recentDays: { day: string; done: boolean }[] = [];
  if (isDaily) {
    let d = today;
    for (let i = 0; i < 14; i++) {
      recentDays.unshift({ day: d, done: dayset.has(d) });
      d = prevDay(d);
    }
  }
  function toggleDone() {
    if (isDaily) {
      startTransition(() => setDailyDoneAction(item.id, effDone ? null : localToday()));
    } else {
      startTransition(() => toggleDoneAction(item.id, !item.done));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[2px]" />
      <aside
        onClick={(e) => e.stopPropagation()}
        className="card-in relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-[var(--veil)] bg-[var(--bg-1)] p-6 shadow-2xl"
      >
        {/* Back arrow (left) + close (right). Back steps to the parent card's panel, or
            to the board for a top-level card — the same move as a phone swipe-back or the
            browser back button (Board mirrors the panel depth onto history). ✕ dismisses
            the whole panel straight to the board. */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <button
            onClick={() => (parent ? onOpenCard(parent) : onClose())}
            className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-[var(--text-lo)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-mid)]"
            aria-label={parent ? `Back to ${parent.text}` : "Back to board"}
            title={parent ? `Back to “${parent.text}”` : "Back to board"}
          >
            <span aria-hidden className="text-base leading-none">‹</span>
            <span className="truncate">{parent ? parent.text : "Board"}</span>
          </button>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-sm text-[var(--text-lo)] hover:bg-[var(--surface-2)] hover:text-[var(--text-hi)]"
          >
            ✕
          </button>
        </div>

        <div className="mb-5">
          <button
            onClick={toggleDone}
            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors ${
              effDone
                ? "border-[var(--done)] text-[var(--done)]"
                : "border-[var(--veil)] text-[var(--text-mid)] hover:border-[var(--text-lo)]"
            }`}
          >
            <span
              className="grid h-3.5 w-3.5 place-items-center rounded-full border"
              style={{
                borderColor: effDone ? "var(--done)" : "var(--text-lo)",
                background: effDone ? "var(--done)" : "transparent",
              }}
            >
              {effDone && (
                <svg viewBox="0 0 12 12" className="h-2 w-2 text-[var(--bg-0)]">
                  <path d="M2.5 6.3l2.1 2.1 4.9-4.9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            {effDone ? (isDaily ? "Done today" : "Done") : "Mark done"}
          </button>
        </div>

        {/* Title */}
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          rows={2}
          className="w-full shrink-0 resize-none rounded-lg border border-transparent bg-transparent px-1 py-1 font-display text-xl font-medium leading-snug text-[var(--text-hi)] hover:border-[var(--veil-soft)] focus:border-[var(--now)] focus:bg-[var(--bg-0)] focus:outline-none"
        />

        {/* Details — rendered markdown at rest, raw textarea when editing */}
        <div className="mt-4 mb-1 flex items-baseline justify-between px-1">
          <label className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-lo)]">
            Details
          </label>
          {details.trim() && (
            <button
              onClick={() => {
                if (editingDetails) {
                  saveDetails();
                  setEditingDetails(false);
                } else {
                  setEditingDetails(true);
                }
              }}
              className="text-[11px] text-[var(--text-lo)] transition-colors hover:text-[var(--text-mid)]"
            >
              {editingDetails ? "Preview" : "Edit ✎"}
            </button>
          )}
        </div>
        {editingDetails || !details.trim() ? (
          <textarea
            ref={detailsRef}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            onFocus={() => setEditingDetails(true)}
            onBlur={() => {
              saveDetails();
              setEditingDetails(false);
            }}
            placeholder="Add context, links, the why… — markdown supported (Enter for a new line)"
            rows={6}
            className="w-full shrink-0 resize-y rounded-lg border border-[var(--veil-soft)] bg-[var(--bg-0)] px-3 py-2.5 text-sm leading-relaxed text-[var(--text-hi)] placeholder:text-[var(--text-lo)] focus:border-[var(--now)] focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingDetails(true)}
            title="Click to edit"
            className="block w-full rounded-lg border border-[var(--veil-soft)] bg-[var(--bg-0)] px-3 py-2.5 text-left transition-colors hover:border-[var(--veil)]"
          >
            <Markdown source={details} />
          </button>
        )}

        {/* Sub-cards: each is a real item (own panel + history). Click one to dive in. */}
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

          {kids.length > 0 && (
            <DndContext
              sensors={childSensors}
              collisionDetection={closestCenter}
              onDragEnd={onChildDragEnd}
            >
              <SortableContext
                items={kids.map((k) => k.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="mb-2 flex flex-col gap-1.5">
                  {kids.map((child) => (
                    <SortableItemCard
                      key={child.id}
                      item={child}
                      allLists={allLists}
                      childItems={childrenByParent.get(child.id)}
                      onOpenCard={onOpenCard}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          <form onSubmit={addChild}>
            <input
              value={childDraft}
              onChange={(e) => setChildDraft(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Add a sub-card…"
              className="w-full rounded-lg border border-[var(--veil-soft)] bg-[var(--bg-0)] px-3 py-2 text-sm text-[var(--text-hi)] placeholder:text-[var(--text-lo)] focus:border-[var(--now)] focus:outline-none"
            />
          </form>
        </div>

        {/* List + archive */}
        <div className="mt-4 flex items-center gap-2">
          <label className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-lo)]">List</label>
          <select
            value={listValue}
            onChange={(e) => {
              setListValue(e.target.value);
              onMove(item.id, e.target.value);
            }}
            className="rounded-md border border-[var(--veil-soft)] bg-[var(--bg-0)] px-2 py-1 text-xs text-[var(--text-mid)] focus:border-[var(--now)] focus:outline-none"
          >
            {allLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              startTransition(() => archiveItemAction(item.id));
              onClose();
            }}
            className="ml-auto rounded-md px-2 py-1 text-xs text-[var(--text-lo)] hover:bg-[var(--surface-2)] hover:text-[var(--text-mid)]"
          >
            Archive
          </button>
        </div>

        <button
          onClick={() => startTransition(() => setRecurrenceAction(item.id, isDaily ? "none" : "daily"))}
          className={`mt-3 flex items-center gap-2 rounded-md px-1 py-1 text-xs transition-colors ${
            isDaily ? "text-[var(--now)]" : "text-[var(--text-lo)] hover:text-[var(--text-mid)]"
          }`}
        >
          <span aria-hidden>↻</span>
          {isDaily ? "Repeats daily — resets each morning" : "Repeat daily"}
        </button>

        {isDaily && (
          <div className="mt-2 px-1">
            <p className="text-[11px] text-[var(--text-lo)]">
              {streak >= 2 ? (
                <>
                  Done{" "}
                  <span className="tabular-nums text-[var(--text-mid)]">{streak} days</span>{" "}
                  running
                </>
              ) : streak === 1 ? (
                "Done today — day 1"
              ) : (
                "No streak yet — check it off to start one"
              )}
            </p>
            {/* Last 14 days, oldest → today. Filled = checked off that day. */}
            <div className="mt-1.5 flex items-center gap-1">
              {recentDays.map((d) => (
                <span
                  key={d.day}
                  title={`${d.day}${d.done ? " — done" : ""}`}
                  className="h-2 w-2 rounded-[3px]"
                  style={{
                    background: d.done ? "var(--done)" : "var(--surface-2)",
                    border: "1px solid var(--veil)",
                    opacity: d.done ? 0.9 : 0.6,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <p className="mt-3 px-1 text-[11px] text-[var(--text-lo)]">
          Captured {fmt(item.created_at)} · updated {fmt(item.updated_at)}
        </p>

        {/* History */}
        <div className="mt-6 border-t border-[var(--veil-soft)] pt-5">
          <p className="mb-4 font-display text-[11px] italic text-[var(--past)]">a memory of this thought</p>
          {events === null ? (
            <p className="font-display text-sm italic text-[var(--text-lo)]">Remembering…</p>
          ) : (
            <ol className="relative ml-1 border-l border-[var(--veil)] pl-5">
              {events.map((e, i) => (
                <li key={e.id} className="mb-4 last:mb-0">
                  <span
                    className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border"
                    style={{
                      borderColor: "var(--veil)",
                      background: i === events.length - 1 ? "var(--now)" : "var(--surface)",
                    }}
                  />
                  <p className="text-sm text-[var(--text-hi)]">{describe(e)}</p>
                  {e.type === "edited" && (
                    <p className="mt-1 font-display text-xs italic leading-snug text-[var(--text-lo)]">
                      <span className="line-through">{e.old_value}</span>{" "}
                      <span className="text-[var(--text-mid)]">→ {e.new_value}</span>
                    </p>
                  )}
                  <p className="mt-1 text-[11px] tabular-nums text-[var(--text-lo)]">{fmt(e.at)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}
