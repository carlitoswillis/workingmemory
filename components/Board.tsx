"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import type { Item } from "@/lib/types";
import type { LISTS, ListId } from "@/lib/lists";
import type { BoardItemAt } from "@/lib/timetravel";
import {
  boardAtAction,
  reorderItemAction,
  reorderItemsAction,
  saveListOrderAction,
} from "@/app/actions";
import SortableColumn from "./SortableColumn";
import CardPanel from "./CardPanel";
import NoteColumn from "./NoteColumn";
import TimeMachineBar from "./TimeMachineBar";

type ListDef = (typeof LISTS)[number];
type Grouped = Record<string, Item[]>;
type Move = { id: string; list: string; position: number };

// The daily note lives in items with this sentinel list (never a real board column).
const NOTE_LIST: string = "note";

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6";

// N evenly-spaced position values to drop a block of cards between two neighbors.
function spacedPositions(prev: number | undefined, next: number | undefined, n: number): number[] {
  if (prev != null && next != null) {
    const step = (next - prev) / (n + 1);
    return Array.from({ length: n }, (_, i) => prev + step * (i + 1));
  }
  if (prev != null) return Array.from({ length: n }, (_, i) => prev + 1000 * (i + 1));
  if (next != null) return Array.from({ length: n }, (_, i) => next - 1000 * (n - i));
  const base = Date.now();
  return Array.from({ length: n }, (_, i) => base + 1000 * i);
}

// Group TOP-LEVEL items into per-list arrays, preserving their (position-sorted)
// order. Sub-cards (parent_id set) never render as board cards — they live inside
// their parent's panel.
function groupItems(items: Item[], lists: readonly ListDef[]): Grouped {
  const by: Grouped = {};
  for (const l of lists) by[l.id] = [];
  for (const it of items) {
    if (it.parent_id) continue;
    if (it.list === NOTE_LIST) continue; // the note has its own column
    (by[it.list] ??= []).push(it);
  }
  return by;
}

// Map each parent id → its direct children, in board order.
function groupChildren(items: Item[]): Map<string, Item[]> {
  const by = new Map<string, Item[]>();
  for (const it of items) {
    if (!it.parent_id) continue;
    const arr = by.get(it.parent_id);
    if (arr) arr.push(it);
    else by.set(it.parent_id, [it]);
  }
  return by;
}

export default function Board({
  lists,
  items,
}: {
  lists: readonly ListDef[];
  items: Item[];
}) {
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const openCard = openCardId ? items.find((i) => i.id === openCardId) ?? null : null;
  const openParent =
    openCard?.parent_id ? items.find((i) => i.id === openCard.parent_id) ?? null : null;

  // Direct children per parent — drives the panel's sub-cards and the board badge.
  const childrenByParent = groupChildren(items);

  // The single active daily note (if any).
  const note = items.find((i) => i.list === NOTE_LIST && !i.archived && !i.parent_id) ?? null;

  // Multi-select: a set of card ids. ⌘/Ctrl-click toggles, Shift-click extends a
  // range within a column. Dragging any selected card moves the whole set.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  function clearSelection() {
    setSelection((prev) => (prev.size ? new Set() : prev));
    anchorRef.current = null;
  }
  function openCardFromBoard(item: Item) {
    clearSelection();
    setOpenCardId(item.id);
  }

  // Time machine
  const [tmValue, setTmValue] = useState("");
  const [asOf, setAsOf] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<BoardItemAt[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Column order (optimistic; persisted per-user)
  const [listOrder, setListOrder] = useState<string[]>(lists.map((l) => l.id));
  useEffect(() => setListOrder(lists.map((l) => l.id)), [lists]);
  const listById = new Map<string, ListDef>(lists.map((l) => [l.id, l]));
  const orderedLists = listOrder
    .map((id) => listById.get(id))
    .filter((l): l is ListDef => !!l);

  // Cards grouped by list. A ref mirrors state so drag handlers never read stale data.
  const [itemsByList, setItemsByList] = useState<Grouped>(() => groupItems(items, lists));
  const itemsRef = useRef<Grouped>(itemsByList);
  useEffect(() => {
    const g = groupItems(items, lists);
    itemsRef.current = g;
    setItemsByList(g);
  }, [items, lists]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const activeItem = activeId
    ? Object.values(itemsByList).flat().find((i) => i.id === activeId) ?? null
    : null;
  const dragCount =
    activeId && selection.has(activeId) && selection.size > 1 ? selection.size : 1;

  const [, startTransition] = useTransition();

  // Undo for moves: capture each dragged card's origin (list+position) at drag start,
  // push it on a stack when the move lands, and ⌘/Ctrl-Z (or the Undo pill) restores it.
  const dragOriginRef = useRef<Move[]>([]);
  const undoStack = useRef<Move[][]>([]);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [undoHint, setUndoHint] = useState<string | null>(null);

  function captureOrigins(ids: string[]): Move[] {
    const c = itemsRef.current;
    const out: Move[] = [];
    for (const id of ids) {
      for (const k of Object.keys(c)) {
        const it = c[k].find((x) => x.id === id);
        if (it) {
          out.push({ id, list: k, position: it.position });
          break;
        }
      }
    }
    return out;
  }

  function pushUndo(prev: Move[], label: string) {
    if (prev.length === 0) return;
    undoStack.current.push(prev);
    setUndoHint(label);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoHint(null), 6000);
  }

  function applyMoves(moves: Move[]) {
    const c = itemsRef.current;
    const all = Object.values(c)
      .flat()
      .map((it) => {
        const m = moves.find((x) => x.id === it.id);
        return m ? { ...it, list: m.list as ListId, position: m.position } : it;
      })
      .sort((a, b) => a.position - b.position);
    const g = groupItems(all, lists);
    itemsRef.current = g;
    setItemsByList(g);
  }

  function performUndo() {
    const prev = undoStack.current.pop();
    setUndoHint(null);
    if (!prev || prev.length === 0) return;
    applyMoves(prev);
    startTransition(() => reorderItemsAction(prev));
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function containerOf(id: string): string | undefined {
    const c = itemsRef.current;
    if (c[id]) return id; // it's a column id
    return Object.keys(c).find((k) => c[k].some((i) => i.id === id));
  }

  function handleSelect(item: Item, mode: "toggle" | "range") {
    setSelection((prev) => {
      const next = new Set(prev);
      if (mode === "range" && anchorRef.current) {
        const list = containerOf(item.id);
        const anchorList = containerOf(anchorRef.current);
        if (list && list === anchorList) {
          const arr = itemsRef.current[list];
          const i1 = arr.findIndex((x) => x.id === anchorRef.current);
          const i2 = arr.findIndex((x) => x.id === item.id);
          if (i1 >= 0 && i2 >= 0) {
            const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1];
            for (let i = lo; i <= hi; i++) next.add(arr[i].id);
            return next;
          }
        }
      }
      // toggle (and the fallback when a range has no valid anchor)
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      anchorRef.current = item.id;
      return next;
    });
  }

  // Keyboard: Esc clears the selection, ⌘/Ctrl-Z undoes the last move. Ignore while
  // typing in a field so native text undo and Esc keep working there.
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    if (typing) return;
    if (e.key === "Escape") clearSelection();
    if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      performUndo();
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  async function applyTimeMachine() {
    if (!tmValue) return;
    setLoading(true);
    const iso = new Date(tmValue).toISOString();
    setSnapshot(await boardAtAction(iso));
    setAsOf(iso);
    setLoading(false);
  }
  function backToNow() {
    setSnapshot(null);
    setAsOf(null);
  }

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setActiveId(id);
    if (e.active.data.current?.type === "card") {
      // Remember where the dragged card(s) started, for undo.
      const ids = selection.has(id) && selection.size > 1 ? [...selection] : [id];
      dragOriginRef.current = captureOrigins(ids);
      // Dragging a card that isn't part of the selection starts a clean single drag.
      if (!selection.has(id)) clearSelection();
    } else {
      dragOriginRef.current = [];
    }
  }

  // Mid-drag: move a card into whatever column it's hovering.
  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over || active.data.current?.type !== "card") return;
    const from = containerOf(String(active.id));
    const to = containerOf(String(over.id));
    if (!from || !to || from === to) return;

    const c = itemsRef.current;
    const fromItems = c[from];
    const toItems = c[to];
    const idx = fromItems.findIndex((i) => i.id === active.id);
    if (idx < 0) return;
    const moved = { ...fromItems[idx], list: to as ListId };
    let insertAt = toItems.findIndex((i) => i.id === over.id);
    if (insertAt < 0) insertAt = toItems.length;

    const next: Grouped = {
      ...c,
      [from]: fromItems.filter((i) => i.id !== active.id),
      [to]: [...toItems.slice(0, insertAt), moved, ...toItems.slice(insertAt)],
    };
    itemsRef.current = next;
    setItemsByList(next);
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const type = active.data.current?.type;
    setActiveId(null);
    if (!over) return;

    if (type === "column") {
      const oldI = listOrder.indexOf(String(active.id));
      const newI = listOrder.indexOf(String(over.id));
      if (oldI >= 0 && newI >= 0 && oldI !== newI) {
        const nextOrder = arrayMove(listOrder, oldI, newI);
        setListOrder(nextOrder);
        saveListOrderAction(nextOrder);
      }
      return;
    }

    const draggedId = String(active.id);
    const overId = String(over.id);

    // MULTI-SELECT: relocate the whole selected set as a contiguous block, in board
    // reading order, into the target list at the drop point.
    if (selection.has(draggedId) && selection.size > 1) {
      const c = itemsRef.current;
      const targetList = containerOf(draggedId);
      if (!targetList) return;

      const block: Item[] = [];
      for (const lid of listOrder) {
        for (const it of c[lid] ?? []) {
          if (selection.has(it.id)) block.push({ ...it, list: targetList as ListId });
        }
      }
      if (block.length === 0) return;

      // Insertion point = where `over` sits among the NON-selected cards of the list.
      const fullTarget = c[targetList];
      let anchorIndex = fullTarget.findIndex((it) => it.id === overId);
      if (anchorIndex < 0) anchorIndex = fullTarget.length; // dropped on an empty column
      let insertAt = 0;
      for (let i = 0; i < anchorIndex; i++) if (!selection.has(fullTarget[i].id)) insertAt++;

      const work: Grouped = {};
      for (const k of Object.keys(c)) work[k] = c[k].filter((it) => !selection.has(it.id));
      const rest = work[targetList];
      const merged = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];

      const positions = spacedPositions(
        merged[insertAt - 1]?.position,
        merged[insertAt + block.length]?.position,
        block.length,
      );
      for (let i = 0; i < block.length; i++) {
        block[i] = { ...block[i], position: positions[i] };
        merged[insertAt + i] = block[i];
      }
      work[targetList] = merged;

      itemsRef.current = work;
      setItemsByList(work);
      clearSelection();
      pushUndo(dragOriginRef.current, `Moved ${block.length} cards`);
      startTransition(() =>
        reorderItemsAction(
          block.map((b) => ({ id: b.id, list: targetList, position: b.position })),
        ),
      );
      return;
    }

    // Card: finalize order within its (possibly new) column, then persist.
    const list = containerOf(String(active.id));
    if (!list) return;
    const c = itemsRef.current;
    const arr = c[list];
    const oldIndex = arr.findIndex((i) => i.id === active.id);
    let newIndex = arr.findIndex((i) => i.id === over.id);
    if (newIndex < 0) newIndex = arr.length - 1;
    const reordered = oldIndex === newIndex ? arr : arrayMove(arr, oldIndex, newIndex);

    const fi = reordered.findIndex((i) => i.id === active.id);
    const prevPos = reordered[fi - 1]?.position;
    const nextPos = reordered[fi + 1]?.position;
    let pos: number;
    if (prevPos != null && nextPos != null) pos = (prevPos + nextPos) / 2;
    else if (prevPos != null) pos = prevPos + 1000;
    else if (nextPos != null) pos = nextPos - 1000;
    else pos = Date.now();

    const next: Grouped = { ...c, [list]: reordered };
    itemsRef.current = next;
    setItemsByList(next);
    const origin = dragOriginRef.current[0];
    if (!origin || origin.list !== list || oldIndex !== newIndex) {
      pushUndo(dragOriginRef.current, "Moved card");
    }
    startTransition(() => reorderItemAction(String(active.id), list, pos));
  }

  return (
    <>
      <TimeMachineBar
        value={tmValue}
        onChange={setTmValue}
        onApply={applyTimeMachine}
        onLive={backToNow}
        loading={loading}
        active={snapshot !== null}
        asOf={asOf}
      />

      {snapshot ? (
        <div className={`memory-mode ${GRID}`}>
          <SnapshotNoteColumn
            body={snapshot.find((i) => i.list === NOTE_LIST && !i.parent_id)?.details ?? ""}
          />
          {orderedLists.map((list) => (
            <SnapshotColumn
              key={list.id}
              list={list}
              items={snapshot.filter((i) => i.list === list.id && !i.parent_id)}
            />
          ))}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={listOrder} strategy={rectSortingStrategy}>
            <div className={GRID}>
              <NoteColumn note={note} />
              {orderedLists.map((list) => (
                <SortableColumn
                  key={list.id}
                  list={list}
                  allLists={orderedLists}
                  items={itemsByList[list.id] ?? []}
                  childrenByParent={childrenByParent}
                  selection={selection}
                  activeId={activeId}
                  onSelect={handleSelect}
                  onOpenCard={openCardFromBoard}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeItem ? (
              <div className="relative">
                {dragCount > 1 && (
                  <div
                    aria-hidden
                    className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-lg border border-[var(--veil)] bg-[var(--surface)]"
                  />
                )}
                <div
                  className="relative rounded-lg border border-[var(--veil)] bg-[var(--surface-2)] py-1.5 pl-2 pr-2 text-[13.5px] leading-snug text-[var(--text-hi)] shadow-2xl"
                  style={{ borderLeft: "2px solid var(--now)" }}
                >
                  {activeItem.text}
                </div>
                {dragCount > 1 && (
                  <span className="absolute -right-2 -top-2 grid h-5 min-w-[20px] place-items-center rounded-full bg-[var(--now)] px-1 text-[11px] font-medium tabular-nums text-[var(--bg-0)] shadow-lg">
                    {dragCount}
                  </span>
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {!snapshot && selection.size > 0 && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--veil)] bg-[var(--bg-1)] py-2 pl-4 pr-2 shadow-2xl">
          <span className="text-sm text-[var(--text-hi)]">
            <span className="font-medium tabular-nums">{selection.size}</span> selected
          </span>
          <span className="hidden text-xs text-[var(--text-lo)] sm:inline">
            drag any one to move them together
          </span>
          <button
            onClick={clearSelection}
            className="rounded-full px-3 py-1 text-xs text-[var(--text-mid)] hover:bg-[var(--surface-2)] hover:text-[var(--text-hi)]"
          >
            Clear · Esc
          </button>
        </div>
      )}

      {!snapshot && selection.size === 0 && undoHint && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--veil)] bg-[var(--bg-1)] py-2 pl-4 pr-2 shadow-2xl">
          <span className="text-sm text-[var(--text-mid)]">{undoHint}</span>
          <button
            onClick={performUndo}
            className="rounded-full px-3 py-1 text-xs text-[var(--now)] hover:bg-[var(--surface-2)]"
          >
            Undo · ⌘Z
          </button>
        </div>
      )}

      {openCard && (
        <CardPanel
          item={openCard}
          parent={openParent}
          allLists={lists}
          childItems={childrenByParent.get(openCard.id) ?? []}
          childrenByParent={childrenByParent}
          onOpenCard={(item) => setOpenCardId(item.id)}
          onClose={() => setOpenCardId(null)}
        />
      )}
    </>
  );
}

// Read-only note for the time-machine snapshot (the journal, as of then).
function SnapshotNoteColumn({ body }: { body: string }) {
  return (
    <section
      className="flex min-h-[220px] flex-col rounded-2xl border border-[var(--veil-soft)] bg-[rgba(20,26,46,0.35)] p-3"
      style={{ borderLeft: "2px solid var(--past)" }}
    >
      <div className="mb-3 px-1.5 pt-1">
        <h2 className="font-display text-[15px] font-medium tracking-tight text-[var(--text-mid)]">
          Note
        </h2>
      </div>
      {body.trim() ? (
        <p className="whitespace-pre-wrap px-1 font-display text-sm italic leading-relaxed text-[var(--text-mid)]">
          {body}
        </p>
      ) : (
        <p className="px-1.5 font-display text-xs italic text-[var(--text-lo)]">— blank then —</p>
      )}
    </section>
  );
}

// Read-only thin column for the time-machine snapshot.
function SnapshotColumn({ list, items }: { list: ListDef; items: BoardItemAt[] }) {
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  return (
    <section className="flex min-h-[220px] flex-col rounded-2xl border border-[var(--veil-soft)] bg-[rgba(20,26,46,0.35)] p-3">
      <div className="mb-3 px-1.5 pt-1">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-[15px] font-medium tracking-tight text-[var(--text-mid)]">
            {list.label}
          </h2>
          <span className="text-[11px] tabular-nums text-[var(--text-lo)]">{open.length || ""}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {[...open, ...done].map((item) => (
          <div
            key={item.id}
            className="rounded-lg border border-[var(--veil-soft)] border-l-2 border-l-[var(--past)] bg-[var(--surface)] py-1.5 pl-2 pr-1.5 text-[13.5px] leading-snug"
            title={item.details.trim() ? `${item.text}\n\n${item.details}` : item.text}
          >
            <span className={item.done ? "text-[var(--text-lo)] line-through" : "text-[var(--text-mid)]"}>
              {item.text}
            </span>
          </div>
        ))}
        {items.length === 0 && (
          <p className="px-1.5 font-display text-xs italic text-[var(--text-lo)]">— empty then —</p>
        )}
      </div>
    </section>
  );
}
