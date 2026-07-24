"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item } from "@/lib/types";
import type { ListDef } from "@/lib/lists";
import ItemCard from "./ItemCard";

// Drag anywhere on the card to reorder; clicks still edit (sensor has a small
// activation distance, and inputs stop propagation).
//
// `nestTarget` means "releasing here would drop the dragged card INSIDE this one"
// (Board decides that from the pointer's position — see NEST_ZONE). It's drawn as a
// pointer-events-none overlay, deliberately NOT a droppable: an extra droppable takes
// `over` off the sortable list mid-drag, which collapses the make-space gap and makes
// every card jump.
export default function SortableItemCard(props: {
  item: Item;
  allLists: readonly ListDef[];
  childItems?: Item[];
  selected?: boolean;
  muted?: boolean;
  nestTarget?: boolean;
  onSelect?: (item: Item, mode: "toggle" | "range") => void;
  onOpenCard: (item: Item) => void;
}) {
  const { nestTarget, ...cardProps } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.item.id, data: { type: "card" } });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : undefined,
        zIndex: isDragging ? 20 : undefined,
        position: isDragging ? "relative" : undefined,
      }}
      className="relative cursor-grab touch-manipulation active:cursor-grabbing"
    >
      <ItemCard {...cardProps} />
      {nestTarget && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-end rounded-lg border-2 border-[var(--now)] bg-[var(--now-wash)] pr-1.5"
        >
          <span className="rounded-full bg-[var(--now)] px-1.5 py-[1px] text-[10px] font-medium leading-none text-[var(--bg-0)]">
            ↳ inside
          </span>
        </div>
      )}
    </div>
  );
}
