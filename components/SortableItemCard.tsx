"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item } from "@/lib/types";
import type { LISTS } from "@/lib/lists";
import ItemCard from "./ItemCard";

type ListDef = (typeof LISTS)[number];

// Drag anywhere on the card to reorder; clicks still edit (sensor has a small
// activation distance, and inputs stop propagation).
export default function SortableItemCard(props: {
  item: Item;
  allLists: readonly ListDef[];
  childItems?: Item[];
  onOpenCard: (item: Item) => void;
}) {
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
      className="cursor-grab touch-manipulation active:cursor-grabbing"
    >
      <ItemCard {...props} />
    </div>
  );
}
