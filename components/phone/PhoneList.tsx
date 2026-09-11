"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "@/lib/types";
import type { ListDef } from "@/lib/lists";
import { localToday } from "@/lib/recurrence";
import { usePhoneUI } from "./PhoneShell";
import PhoneReorderRows from "./PhoneReorderRows";
import { emptyCopyFor, pageIndexFor } from "./phone-logic";
import { childrenOf } from "./phone-data";

// Lists — one horizontal pager over the board's other columns, with a sticky
// segmented header that syncs both ways: tap a segment to jump, swipe to step to the
// neighbour. The pager is NATIVE scroll-snap (`scroll-snap-type: x mandatory` on the
// track, one 100%-wide snap-aligned page each, each page its own vertical scroller),
// never a JS pan handler — that's what keeps it from racing iOS's edge-swipe-back.
// Position is read back with an IntersectionObserver, never a scroll listener.
//
// Reorder is LONG-PRESS ONLY (250ms / 5px) and lives in PhoneReorderRows, shared with
// Now's Today section. Scrolling a long Backlog must never be stolen by the first
// pixel of a drag.

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
  // Use childrenOf to ensure archived children are not counted (matches the sheet).
  const childrenByParent = useMemo(() => {
    const by = new Map<string, Item[]>();
    const parents = new Set<string>();
    for (const it of items) {
      if (it.parent_id) parents.add(it.parent_id);
    }
    for (const parentId of parents) {
      by.set(parentId, childrenOf(items, parentId));
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
    // Clamp index if pages have shrunk
    const clampedIndex = Math.min(index, Math.max(0, pages.length - 1));
    if (clampedIndex !== index) setIndex(clampedIndex);

    const page = pages[clampedIndex];
    if (page && page.id !== ui.listId) ui.setListId(page.id);
    segRefs.current[clampedIndex]?.scrollIntoView({ inline: "center", block: "nearest" });
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
  // The drag mechanic itself lives in PhoneReorderRows, which Now's Today section
  // shares — see the note at the top of that file. A page supplies only its cards,
  // the column they belong to, and what each row needs to render.
  const rowProps = useCallback(
    (item: Item) => ({
      childItems: childrenByParent.get(item.id),
      today,
      snoozeListId: list.id === snoozeListId ? null : snoozeListId,
    }),
    [childrenByParent, today, list.id, snoozeListId],
  );

  return (
    <>
      <PhoneReorderRows
        cards={cards}
        listId={list.id}
        listLabel={list.label}
        className="phone-rows phone-page__rows"
        rowProps={rowProps}
        onReorder={onReorder}
      />
      {cards.length === 0 && <p className="phone-empty">{emptyCopyFor(list.id)}</p>}
    </>
  );
}
