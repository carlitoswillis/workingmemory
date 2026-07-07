"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item } from "@/lib/types";
import type { ListDef } from "@/lib/lists";
import Column from "./Column";

// A column you can drag (by its header grip) to reorder the board.
export default function SortableColumn(props: {
  list: ListDef;
  allLists: readonly ListDef[];
  items: Item[];
  childrenByParent: Map<string, Item[]>;
  selection: Set<string>;
  activeId: string | null;
  canDelete: boolean;
  onSelect: (item: Item, mode: "toggle" | "range") => void;
  onOpenCard: (item: Item) => void;
  onAdd: (listId: string, text: string) => void;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.list.id, data: { type: "column" } });

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
