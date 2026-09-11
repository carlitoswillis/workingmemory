"use client";

import { useMemo, useState, useTransition } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item } from "@/lib/types";
import { reorderItemsAction } from "@/app/actions";
import { useBoardId } from "../board-context";
import PhoneRow from "./PhoneRow";
import { M, msOf } from "./phone-motion";
import { applyReorder, reassignPositions } from "./phone-logic";

// One reorderable <ul> of phone rows — the whole drag mechanic in one place, so Now
// and a Lists page cannot drift apart. It was written for the Lists pager and is now
// also what puts Today's open cards in the order you want them; the two screens differ
// only in which cards they hand over and what they call the list out loud.
//
// Reorder is LONG-PRESS ONLY (250ms / 5px). A long Backlog — or a long Today — must
// still scroll, so the first pixel of a finger is never claimed as a drag.
//
// Swipe-to-archive lives on the same rows and must not fight the drag: a row is only
// swipeable while nothing on the list is being dragged (PhoneRow's `canSwipe` is
// `swipeEnabled && !dragging`), and `touch-action: none` is set on the ACTIVE
// draggable alone so every other row keeps its native vertical scroll.

// Everything PhoneRow takes except the parts this component owns: the row's identity
// and its drag wiring. A screen supplies the rest (checkbox truth, sub-card counts,
// the collapse-on-done behaviour Now wants and a Lists page doesn't).
export type ReorderRowProps = Omit<
  React.ComponentProps<typeof PhoneRow>,
  "item" | "dragging" | "swipeEnabled" | "dragHandleProps" | "rootRef" | "rootStyle" | "rootProps"
>;

export default function PhoneReorderRows({
  cards,
  listId,
  listLabel,
  className = "phone-rows",
  rowProps,
  onReorder,
}: {
  // Position-ordered, and only the cards that are actually rows on this screen.
  cards: Item[];
  // The column every one of these cards is in — where the new positions are written.
  listId: string;
  // How the list is named in a drag announcement ("…of 6 in Today").
  listLabel: string;
  className?: string;
  rowProps: (item: Item) => ReorderRowProps;
  // The drop, applied locally, so the list settles under the finger instead of
  // waiting for the server.
  onReorder: (next: Item[]) => void;
}) {
  const boardId = useBoardId();
  const [, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);

  // Long-press only, on every input that has one. 250ms / 5px: a scroll never becomes
  // a drag, and a deliberate hold always does.
  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(MouseSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const announcements: Announcements = useMemo(
    () => ({
      onDragStart: ({ active }) => {
        const i = cards.findIndex((c) => c.id === active.id);
        return `Picked up ${cards[i]?.text ?? "card"}, card ${i + 1} of ${cards.length} in ${listLabel}.`;
      },
      onDragOver: ({ active, over }) => {
        if (!over) return;
        const i = cards.findIndex((c) => c.id === over.id);
        return `${cards.find((c) => c.id === active.id)?.text ?? "Card"} moved to position ${
          i + 1
        } of ${cards.length} in ${listLabel}.`;
      },
      onDragEnd: ({ active, over }) => {
        if (!over) return `Movement cancelled.`;
        const i = cards.findIndex((c) => c.id === over.id);
        return `${cards.find((c) => c.id === active.id)?.text ?? "Card"} dropped at position ${
          i + 1
        } of ${cards.length} in ${listLabel}.`;
      },
      onDragCancel: () => "Movement cancelled. The card is back where it was.",
    }),
    [cards, listLabel],
  );

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = cards.findIndex((c) => c.id === active.id);
    const to = cards.findIndex((c) => c.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(applyReorder(cards, from, to)); // settles locally first
    const updates = reassignPositions(cards, from, to, listId);
    if (updates.length) startTransition(() => void reorderItemsAction(boardId, updates));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ announcements }}
      autoScroll={{ threshold: { x: 0, y: 0.2 } }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul className={className}>
          {cards.map((item) => (
            <SortableRow
              key={item.id}
              item={item}
              dragging={activeId === item.id}
              anyDragging={activeId != null}
              rowProps={rowProps}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  item,
  dragging,
  anyDragging,
  rowProps,
}: {
  item: Item;
  dragging: boolean;
  anyDragging: boolean;
  rowProps: (item: Item) => ReorderRowProps;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    animateLayoutChanges: () => true,
  });

  return (
    <PhoneRow
      {...rowProps(item)}
      item={item}
      dragging={dragging || isDragging}
      // A swipe must never fight a drag that is already armed.
      swipeEnabled={!anyDragging}
      dragHandleProps={listeners as React.HTMLAttributes<HTMLElement>}
      rootRef={setNodeRef}
      rootStyle={{
        transform: CSS.Translate.toString(transform),
        transition: transition ?? `transform ${msOf("reorder")}ms ${M.reorder.ease}`,
        // `none` on the ACTIVE draggable only, and only once it is actually dragging —
        // everything else keeps its native vertical scroll.
        touchAction: isDragging ? "none" : "pan-y",
        zIndex: isDragging ? 2 : undefined,
      }}
      rootProps={{ ...attributes, "aria-roledescription": "sortable card" }}
    />
  );
}
