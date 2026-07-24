"use client";

import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item } from "@/lib/types";
import type { ListDef } from "@/lib/lists";
import ItemCard from "./ItemCard";

// Drag anywhere on the card to reorder; clicks still edit (sensor has a small
// activation distance, and inputs stop propagation).
//
// `nestTarget` (set by Board while another card is being dragged) turns the card's
// right edge into a second drop zone: release there and the dragged card moves INSIDE
// this one instead of next to it. Board's collision detection only picks a nest strip
// when the pointer is literally inside it, so ordinary reordering is untouched.
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
  const nest = useDroppable({
    id: `nest:${props.item.id}`,
    disabled: !nestTarget,
    data: { type: "nest", itemId: props.item.id },
  });

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
          ref={nest.setNodeRef}
          aria-hidden
          title={`Drop inside “${props.item.text}”`}
          className={`absolute right-0 top-0 flex h-full w-11 items-center justify-center rounded-r-lg border-l text-[13px] transition-colors ${
            nest.isOver
              ? "border-l-[var(--now)] bg-[var(--now-wash)] text-[var(--now)]"
              : "border-l-[var(--veil-soft)] bg-[var(--surface-2)] text-[var(--text-lo)]"
          }`}
        >
          ↳
        </div>
      )}
    </div>
  );
}
