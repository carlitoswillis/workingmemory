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
import { boardAtAction, reorderItemAction, saveListOrderAction } from "@/app/actions";
import SortableColumn from "./SortableColumn";
import CardPanel from "./CardPanel";
import TimeMachineBar from "./TimeMachineBar";

type ListDef = (typeof LISTS)[number];
type Grouped = Record<string, Item[]>;

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5";

// Group items into per-list arrays, preserving their (position-sorted) order.
function groupItems(items: Item[], lists: readonly ListDef[]): Grouped {
  const by: Grouped = {};
  for (const l of lists) by[l.id] = [];
  for (const it of items) (by[it.list] ??= []).push(it);
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

  const [, startTransition] = useTransition();

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
    setActiveId(String(e.active.id));
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
          {orderedLists.map((list) => (
            <SnapshotColumn
              key={list.id}
              list={list}
              items={snapshot.filter((i) => i.list === list.id)}
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
              {orderedLists.map((list) => (
                <SortableColumn
                  key={list.id}
                  list={list}
                  allLists={orderedLists}
                  items={itemsByList[list.id] ?? []}
                  onOpenCard={(item) => setOpenCardId(item.id)}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeItem ? (
              <div
                className="rounded-lg border border-[var(--veil)] bg-[var(--surface-2)] py-1.5 pl-2 pr-2 text-[13.5px] leading-snug text-[var(--text-hi)] shadow-2xl"
                style={{ borderLeft: "2px solid var(--now)" }}
              >
                {activeItem.text}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {openCard && (
        <CardPanel item={openCard} allLists={lists} onClose={() => setOpenCardId(null)} />
      )}
    </>
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
