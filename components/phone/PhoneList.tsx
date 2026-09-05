"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import type { ListDef } from "@/lib/lists";
import { reorderItemsAction } from "@/app/actions";
import { localToday } from "@/lib/recurrence";
import { useBoardId } from "../board-context";
import { usePhoneUI } from "./PhoneShell";
import PhoneRow from "./PhoneRow";
import { M, msOf } from "./phone-motion";
import { applyReorder, emptyCopyFor, pageIndexFor, reassignPositions } from "./phone-logic";

// Lists — one horizontal pager over the board's other columns, with a sticky
// segmented header that syncs both ways: tap a segment to jump, swipe to step to the
// neighbour. The pager is NATIVE scroll-snap (`scroll-snap-type: x mandatory` on the
// track, one 100%-wide snap-aligned page each, each page its own vertical scroller),
// never a JS pan handler — that's what keeps it from racing iOS's edge-swipe-back.
// Position is read back with an IntersectionObserver, never a scroll listener.
//
// Reorder is LONG-PRESS ONLY (250ms / 5px). Scrolling a long Backlog must never be
// stolen by the first pixel of a drag.

export default function PhoneList({
  items,
  pages,
  snoozeListId = null,
}: {
  items: Item[];
  pages: readonly ListDef[];
  snoozeListId?: string | null;
}) {
  const ui = usePhoneUI();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const segRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [index, setIndex] = useState(0);
  const today = localToday();

  // Cards per page, position-ordered (the server hands `items` over sorted) with the
  // pending reorder folded in so a drop settles under the finger.
  const [order, setOrder] = useState<Record<string, Item[]>>({});
  // Sub-cards are not rows on a Lists page — they hang off their parent, exactly as
  // they do on Now, so a parent here carries the same "2/3 sub-cards" affordance and
  // the same tap into its sheet. Same map shape as PhoneHome's.
  const childrenByParent = useMemo(() => {
    const by = new Map<string, Item[]>();
    for (const it of items) {
      if (!it.parent_id) continue;
      const arr = by.get(it.parent_id);
      if (arr) arr.push(it);
      else by.set(it.parent_id, [it]);
    }
    return by;
  }, [items]);
  const grouped = useMemo(() => {
    const by: Record<string, Item[]> = {};
    for (const p of pages) by[p.id] = [];
    for (const it of items) {
      if (it.parent_id || it.archived) continue;
      if (by[it.list]) by[it.list].push(it);
    }
    return by;
  }, [items, pages]);
  useEffect(() => setOrder(grouped), [grouped]);

  // Follow the pager: which page is filling the track right now.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const pageEls = Array.from(track.querySelectorAll<HTMLElement>("[data-page-index]"));
    if (pageEls.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const i = Number((entry.target as HTMLElement).dataset.pageIndex);
          if (!Number.isNaN(i)) setIndex(i);
        }
      },
      { root: track, threshold: 0.6 },
    );
    for (const el of pageEls) io.observe(el);

    // `scrollend` (where it exists) is the authoritative settle — the observer can
    // miss a fast flick that crosses two pages.
    const onScrollEnd = () =>
      setIndex(pageIndexFor(track.scrollLeft, track.clientWidth, pageEls.length));
    track.addEventListener("scrollend", onScrollEnd);
    return () => {
      io.disconnect();
      track.removeEventListener("scrollend", onScrollEnd);
    };
  }, [pages.length]);

  // …and tell the shell, so a sheet ("capture into this list") knows where you are.
  useEffect(() => {
    const page = pages[index];
    if (page && page.id !== ui.listId) ui.setListId(page.id);
    segRefs.current[index]?.scrollIntoView({ inline: "center", block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, pages]);

  const goTo = useCallback((i: number) => {
    const track = trackRef.current;
    if (!track) return;
    setIndex(i);
    track.scrollTo({ left: i * track.clientWidth, behavior: "smooth" });
  }, []);

  return (
    <div className="phone-lists">
      <div className="phone-seg" role="tablist" aria-label="Lists">
        {pages.map((page, i) => (
          <button
            key={page.id}
            ref={(el) => {
              segRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-controls={`phone-page-${page.id}`}
            id={`phone-seg-${page.id}`}
            className={`phone-seg__btn${i === index ? " is-current" : ""}`}
            onClick={() => goTo(i)}
          >
            {page.label}
          </button>
        ))}
      </div>

      <div className="phone-pager" ref={trackRef}>
        {pages.map((page, i) => (
          <section
            key={page.id}
            id={`phone-page-${page.id}`}
            role="tabpanel"
            aria-labelledby={`phone-seg-${page.id}`}
            data-page-index={i}
            className="phone-page"
          >
            <Page
              list={page}
              cards={order[page.id] ?? []}
              childrenByParent={childrenByParent}
              today={today}
              snoozeListId={snoozeListId}
              onReorder={(next) => setOrder((prev) => ({ ...prev, [page.id]: next }))}
            />
          </section>
        ))}
        {pages.length === 0 && <p className="phone-empty">This board has only one column.</p>}
      </div>
    </div>
  );
}

function Page({
  list,
  cards,
  childrenByParent,
  today,
  snoozeListId,
  onReorder,
}: {
  list: ListDef;
  cards: Item[];
  childrenByParent: Map<string, Item[]>;
  today: string;
  snoozeListId: string | null;
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

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const i = cards.findIndex((c) => c.id === active.id);
      return `Picked up ${cards[i]?.text ?? "card"}, card ${i + 1} of ${cards.length} in ${list.label}.`;
    },
    onDragOver: ({ active, over }) => {
      if (!over) return;
      const i = cards.findIndex((c) => c.id === over.id);
      return `${cards.find((c) => c.id === active.id)?.text ?? "Card"} moved to position ${
        i + 1
      } of ${cards.length} in ${list.label}.`;
    },
    onDragEnd: ({ active, over }) => {
      if (!over) return `Movement cancelled.`;
      const i = cards.findIndex((c) => c.id === over.id);
      return `${cards.find((c) => c.id === active.id)?.text ?? "Card"} dropped at position ${
        i + 1
      } of ${cards.length} in ${list.label}.`;
    },
    onDragCancel: () => "Movement cancelled. The card is back where it was.",
  };

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
    const updates = reassignPositions(cards, from, to, list.id);
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
        <ul className="phone-rows phone-page__rows">
          {cards.map((item) => (
            <SortableRow
              key={item.id}
              item={item}
              childItems={childrenByParent.get(item.id)}
              today={today}
              snoozeListId={list.id === snoozeListId ? null : snoozeListId}
              dragging={activeId === item.id}
              anyDragging={activeId != null}
            />
          ))}
        </ul>
      </SortableContext>
      {cards.length === 0 && <p className="phone-empty">{emptyCopyFor(list.id)}</p>}
    </DndContext>
  );
}

function SortableRow({
  item,
  childItems,
  today,
  snoozeListId,
  dragging,
  anyDragging,
}: {
  item: Item;
  childItems?: Item[];
  today: string;
  snoozeListId: string | null;
  dragging: boolean;
  anyDragging: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    animateLayoutChanges: () => true,
  });

  return (
    <PhoneRow
      item={item}
      childItems={childItems}
      today={today}
      snoozeListId={snoozeListId}
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
