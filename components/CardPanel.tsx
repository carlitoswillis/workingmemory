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
import type { ListDef } from "@/lib/lists";
import {
  addChildAction,
  archiveItemAction,
  editDetailsAction,
  editItemAction,
  historyAction,
  reorderItemAction,
  unarchiveItemAction,
  setDailyDoneAction,
  setParentAction,
  setRecurrenceAction,
  toggleDoneAction,
} from "@/app/actions";
import {
  WEEKDAYS,
  addDays,
  describeRecurrence,
  effectiveDone,
  formatRecurrence,
  localToday,
  parseRecurrence,
  periodStart,
} from "@/lib/recurrence";
import { daysWithLiveCheck, prevDay, streakFor } from "@/lib/streaks";
import dynamic from "next/dynamic";
import SortableItemCard from "./SortableItemCard";
import { useBoardId } from "./board-context";

// Code-split the markdown renderer (react-markdown + remark-gfm, ~43kB): it's only
// needed once a card panel is open, so keep it out of the initial board bundle.
const Markdown = dynamic(() => import("./Markdown"), {
  ssr: false,
  loading: () => <span className="text-sm text-[var(--text-lo)]">rendering…</span>,
});

function describe(
  e: ItemEvent,
  labelOf: (id: string) => string,
  titleOf: (id: string) => string,
): string {
  switch (e.type) {
    case "created":
      return `Captured: “${e.new_value}”`;
    case "edited":
      return e.field === "details" ? "Edited details" : "Reworded";
    case "moved":
      // Two kinds of move: between columns, and in/out of another card (field 'parent').
      if (e.field === "parent") {
        if (e.new_value) return `Nested in “${titleOf(e.new_value)}”`;
        return `Moved out of “${titleOf(e.old_value ?? "")}” onto the board`;
      }
      return `Moved ${labelOf(e.old_value ?? "")} → ${labelOf(e.new_value ?? "")}`;
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
  listLabels,
  actors,
  allItems,
  childItems,
  childrenByParent,
  onOpenCard,
  onMove,
  onClose,
}: {
  item: Item;
  parent: Item | null;
  allLists: readonly ListDef[];
  listLabels: Record<string, string>;
  actors: Record<string, string>;
  allItems: Item[]; // every live card on the board — the "Inside" picker's candidates
  childItems: Item[];
  childrenByParent: Map<string, Item[]>;
  onOpenCard: (item: Item) => void;
  onMove: (id: string, list: string) => void;
  onClose: () => void;
}) {
  const labelOf = (id: string) => listLabels[id] ?? id;
  const titleOf = (id: string) => allItems.find((i) => i.id === id)?.text ?? "a card";
  const boardId = useBoardId();
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
  const [nestError, setNestError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // "Inside": move this card into another card, or back out onto the board. (Dragging
  // a card onto another card's ↳ edge does the same thing from the board.) Candidates
  // are every live card except this one and its own sub-tree — a card can't contain
  // itself. Listed per column, indented by depth, so a deep sub-card is pickable too.
  const subtree = new Set<string>([item.id]);
  (function collect(id: string) {
    for (const c of childrenByParent.get(id) ?? []) {
      subtree.add(c.id);
      collect(c.id);
    }
  })(item.id);

  function candidatesIn(listId: string): { id: string; text: string; depth: number }[] {
    const out: { id: string; text: string; depth: number }[] = [];
    (function walk(siblings: Item[], depth: number) {
      for (const it of siblings) {
        if (subtree.has(it.id)) continue; // skips its whole branch with it
        out.push({ id: it.id, text: it.text, depth });
        walk(childrenByParent.get(it.id) ?? [], depth + 1);
      }
    })(allItems.filter((i) => !i.parent_id && i.list === listId), 0);
    return out;
  }

  function chooseParent(value: string) {
    setNestError(null);
    const parentId = value || null;
    startTransition(async () => {
      // Popping out: land it in whatever column the List dropdown currently shows.
      const err = await setParentAction(
        boardId,
        [item.id],
        parentId,
        parentId ? undefined : listValue,
      );
      if (err) setNestError(err);
    });
  }

  const subDone = childItems.filter((c) => effectiveDone(c)).length;

  // Enter adds the sub-card; so does leaving the field with text in it (same
  // "deselecting commits" rule as the column capture box — see Column.tsx).
  function commitChild() {
    const t = childDraft.trim();
    if (!t) return;
    setChildDraft("");
    startTransition(() => addChildAction(boardId, item.id, t));
  }

  function addChild(e: React.FormEvent) {
    e.preventDefault();
    commitChild();
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
    startTransition(() => reorderItemAction(boardId, moved.id, moved.list, pos));
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
    historyAction(boardId, item.id).then((e) => alive && setEvents(e));
    return () => {
      alive = false;
    };
  }, [boardId, item.id, item.updated_at]);

  function saveTitle() {
    const t = title.trim();
    if (!t || t === item.text) return setTitle(item.text);
    startTransition(() => editItemAction(boardId, item.id, t));
  }
  function saveDetails() {
    if (details === item.details) return;
    startTransition(() => editDetailsAction(boardId, item.id, details));
  }

  const rec = parseRecurrence(item.recurrence);
  const repeats = rec.kind !== "none";
  const effDone = effectiveDone(item);

  // Streak + recent-history strip for a repeating card: the last 14 days (daily) or
  // the last 8 weeks (weekly). completed_days comes from the event log via
  // lib/queries.ts; the live checkbox is folded in so the display tracks an
  // optimistic toggle without waiting for the refetch.
  const today = localToday();
  const dayset = daysWithLiveCheck(
    item.completed_days ?? [],
    today,
    item.recurrence,
    effDone,
    item.completed_on,
  );
  const streak = streakFor(dayset, today, rec);
  const recent: { key: string; done: boolean; title: string }[] = [];
  if (rec.kind === "daily") {
    let d = today;
    for (let i = 0; i < 14; i++) {
      recent.unshift({ key: d, done: dayset.has(d), title: d });
      d = prevDay(d);
    }
  } else if (rec.kind === "weekly") {
    let start = periodStart(today, rec.weekday);
    for (let i = 0; i < 8; i++) {
      const done = Array.from({ length: 7 }, (_, k) => addDays(start, k)).some((d) =>
        dayset.has(d),
      );
      recent.unshift({ key: start, done, title: `week of ${start}` });
      start = addDays(start, -7);
    }
  }
  function toggleDone() {
    if (repeats) {
      startTransition(() => setDailyDoneAction(boardId, item.id, effDone ? null : localToday()));
    } else {
      startTransition(() => toggleDoneAction(boardId, item.id, !item.done));
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
            {effDone
              ? rec.kind === "daily"
                ? "Done today"
                : rec.kind === "weekly"
                  ? "Done this week"
                  : "Done"
              : "Mark done"}
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
              onBlur={commitChild}
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
          {/* Search can open an ARCHIVED card (from the archive or from a history
              hit), so the panel offers the way back rather than a second archive. */}
          {item.archived ? (
            <button
              onClick={() => startTransition(() => unarchiveItemAction(boardId, item.id))}
              title="Put this card back on the board"
              className="ml-auto rounded-md border border-[var(--veil)] px-2.5 py-1 text-xs text-[var(--text-mid)] transition-colors hover:border-[var(--now)] hover:text-[var(--now)]"
            >
              Restore
            </button>
          ) : (
            <button
              onClick={() => {
                startTransition(() => archiveItemAction(boardId, item.id));
                onClose();
              }}
              className="ml-auto rounded-md px-2 py-1 text-xs text-[var(--text-lo)] hover:bg-[var(--surface-2)] hover:text-[var(--text-mid)]"
            >
              Archive
            </button>
          )}
        </div>

        {item.list !== "note" && (
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <label className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-[var(--text-lo)]">
                Inside
              </label>
              <select
                value={item.parent_id ?? ""}
                onChange={(e) => chooseParent(e.target.value)}
                title="Move this card into another card, or back out onto the board"
                className="min-w-0 flex-1 rounded-md border border-[var(--veil-soft)] bg-[var(--bg-0)] px-2 py-1 text-xs text-[var(--text-mid)] focus:border-[var(--now)] focus:outline-none"
              >
                <option value="">— on the board —</option>
                {allLists.map((l) => {
                  const cands = candidatesIn(l.id);
                  if (cands.length === 0) return null;
                  return (
                    <optgroup key={l.id} label={l.label}>
                      {cands.map((c) => (
                        <option key={c.id} value={c.id}>
                          {"· ".repeat(c.depth)}
                          {c.text.length > 48 ? `${c.text.slice(0, 47)}…` : c.text}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </div>
            {nestError && (
              <p className="mt-1.5 px-1 text-[11px] text-[var(--now)]">{nestError}</p>
            )}
          </div>
        )}

        {/* Repeat: never / every day / a weekday. A weekly card checked off STAYS
            done until its weekday comes round again — the reset is derived from
            completed_on, so nothing has to run at midnight (lib/recurrence.ts). */}
        <div className="mt-3 flex items-center gap-2">
          <span
            aria-hidden
            className={repeats ? "text-[var(--now)]" : "text-[var(--text-lo)]"}
          >
            ↻
          </span>
          <label className="sr-only" htmlFor="wm-repeat">
            Repeat
          </label>
          <select
            id="wm-repeat"
            value={formatRecurrence(rec)}
            onChange={(e) =>
              startTransition(() => setRecurrenceAction(boardId, item.id, e.target.value))
            }
            className={`min-w-0 flex-1 rounded-md border border-[var(--veil-soft)] bg-[var(--bg-0)] px-2 py-1 text-xs focus:border-[var(--now)] focus:outline-none ${
              repeats ? "text-[var(--now)]" : "text-[var(--text-mid)]"
            }`}
          >
            <option value="none">{describeRecurrence({ kind: "none" })}</option>
            <option value="daily">{describeRecurrence({ kind: "daily" })}</option>
            {WEEKDAYS.map((w, i) => (
              <option key={w} value={`weekly:${i}`}>
                {describeRecurrence({ kind: "weekly", weekday: i })}
              </option>
            ))}
          </select>
        </div>

        {repeats && (
          <div className="mt-2 px-1">
            <p className="text-[11px] text-[var(--text-lo)]">
              {rec.kind === "daily"
                ? "Resets each morning."
                : `Stays done until ${WEEKDAYS[rec.weekday]}, then reopens.`}
            </p>
            <p className="mt-1 text-[11px] text-[var(--text-lo)]">
              {streak >= 2 ? (
                <>
                  Done{" "}
                  <span className="tabular-nums text-[var(--text-mid)]">
                    {streak} {rec.kind === "daily" ? "days" : "weeks"}
                  </span>{" "}
                  running
                </>
              ) : streak === 1 ? (
                rec.kind === "daily" ? "Done today — day 1" : "Done this week — week 1"
              ) : (
                "No streak yet — check it off to start one"
              )}
            </p>
            {/* Oldest → now: the last 14 days, or the last 8 weeks. Filled = done. */}
            <div className="mt-1.5 flex items-center gap-1">
              {recent.map((r) => (
                <span
                  key={r.key}
                  title={`${r.title}${r.done ? " — done" : ""}`}
                  className={`h-2 rounded-[3px] ${rec.kind === "weekly" ? "w-4" : "w-2"}`}
                  style={{
                    background: r.done ? "var(--done)" : "var(--surface-2)",
                    border: "1px solid var(--veil)",
                    opacity: r.done ? 0.9 : 0.6,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <p className="mt-3 px-1 text-[11px] text-[var(--text-lo)]">
          Captured {fmt(item.created_at)} · updated {fmt(item.updated_at)}
          {item.archived && (
            <span className="ml-1 text-[var(--text-mid)]">· archived</span>
          )}
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
                  <p className="text-sm text-[var(--text-hi)]">{describe(e, labelOf, titleOf)}</p>
                  {e.type === "edited" && (
                    <p className="mt-1 font-display text-xs italic leading-snug text-[var(--text-lo)]">
                      <span className="line-through">{e.old_value}</span>{" "}
                      <span className="text-[var(--text-mid)]">→ {e.new_value}</span>
                    </p>
                  )}
                  <p className="mt-1 text-[11px] tabular-nums text-[var(--text-lo)]">
                    {fmt(e.at)}
                    {e.actor_id && actors[e.actor_id] && (
                      <span className="ml-1 text-[var(--text-mid)]">· @{actors[e.actor_id]}</span>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}
