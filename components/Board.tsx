"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import type { Item } from "@/lib/types";
import type { LISTS } from "@/lib/lists";
import type { BoardItemAt } from "@/lib/timetravel";
import { boardAtAction, saveListOrderAction } from "@/app/actions";
import SortableColumn from "./SortableColumn";
import CardPanel from "./CardPanel";
import TimeMachineBar from "./TimeMachineBar";

type ListDef = (typeof LISTS)[number];

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5";

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

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function applyTimeMachine() {
    if (!tmValue) return;
    setLoading(true);
    const iso = new Date(tmValue).toISOString();
    const result = await boardAtAction(iso);
    setSnapshot(result);
    setAsOf(iso);
    setLoading(false);
  }
  function backToNow() {
    setSnapshot(null);
    setAsOf(null);
  }

  function onColumnDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldI = listOrder.indexOf(String(active.id));
    const newI = listOrder.indexOf(String(over.id));
    if (oldI < 0 || newI < 0) return;
    const next = arrayMove(listOrder, oldI, newI);
    setListOrder(next);
    saveListOrderAction(next);
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onColumnDragEnd}>
          <SortableContext items={listOrder} strategy={rectSortingStrategy}>
            <div className={GRID}>
              {orderedLists.map((list) => (
                <SortableColumn
                  key={list.id}
                  list={list}
                  allLists={orderedLists}
                  items={items.filter((i) => i.list === list.id)}
                  onOpenCard={(item) => setOpenCardId(item.id)}
                />
              ))}
            </div>
          </SortableContext>
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
