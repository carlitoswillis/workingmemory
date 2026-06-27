"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item } from "@/lib/types";
import type { LISTS } from "@/lib/lists";
import Column from "./Column";

type ListDef = (typeof LISTS)[number];

// A column you can drag (by its header grip) to reorder the board.
export default function SortableColumn(props: {
  list: ListDef;
  allLists: readonly ListDef[];
  items: Item[];
  onOpenCard: (item: Item) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.list.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
        zIndex: isDragging ? 30 : undefined,
      }}
    >
      <Column {...props} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}
