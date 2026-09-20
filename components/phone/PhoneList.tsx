"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "@/lib/types";
import type { ListDef } from "@/lib/lists";
import { effectiveDone, localToday } from "@/lib/recurrence";
import { usePhoneUI } from "./PhoneShell";
import PhoneReorderRows from "./PhoneReorderRows";
import PhoneRow from "./PhoneRow";
import { emptyCopyFor, pageIndexFor } from "./phone-logic";
import { childrenOf } from "./phone-data";
import { useScreenSwipe } from "./useScreenSwipe";

// Lists — one horizontal pager over the board's other columns, with a sticky
// segmented header that syncs both ways: tap a segment to jump, swipe to step to the
// neighbour. A swipe that starts on a CARD is the row's (complete / Snooze / Archive)
// and never the pager's — `.phone-row` narrows its own touch-action to `pan-y` to say
// so — and swiping right off the first page hands you back to Now. The pager is NATIVE scroll-snap (`scroll-snap-type: x mandatory` on the
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

  // Long-press the segmented header to manage columns (add / rename / delete /
  // reorder — PhoneListsManage). 500ms / 10px: long enough that swiping the strip
  // itself never fires it, and a fired press marks itself so the segment's own tap
  // handler (which jumps pages) doesn't ALSO run on release.
  const segPress = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; fired: boolean }>(
    { timer: null, x: 0, y: 0, fired: false },
  );
  const cancelSegPress = useCallback(() => {
    if (segPress.current.timer) clearTimeout(segPress.current.timer);
    segPress.current.timer = null;
  }, []);
  useEffect(() => cancelSegPress, [cancelSegPress]);
  const onSegPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      segPress.current.fired = false;
      segPress.current.x = e.clientX;
      segPress.current.y = e.clientY;
      segPress.current.timer = setTimeout(() => {
        segPress.current.fired = true;
        ui.open({ kind: "lists" });
      }, 500);
    },
    [ui],
  );
  const onSegPointerMove = useCallback((e: React.PointerEvent) => {
    if (!segPress.current.timer) return;
    if (Math.hypot(e.clientX - segPress.current.x, e.clientY - segPress.current.y) > 10) {
      cancelSegPress();
    }
  }, [cancelSegPress]);

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

  // Page-to-page is the track's own business (native snap). This is only what
  // happens when it runs out: parked against the left edge, a rightward swipe is the
  // way back to Now — the screen the bottom bar keeps to the left of Lists. Asking
  // at touch-down means a swipe back from page 3 steps one page instead, which is
  // what it looks like it should do.
  const swipe = useScreenSwipe(
    (dir) => {
      if (dir === "right") ui.setTab("now");
    },
    () => (trackRef.current?.scrollLeft ?? 0) <= 1,
  );

  const goTo = useCallback((i: number) => {
    const track = trackRef.current;
    if (!track) return;
    setIndex(i);
    track.scrollTo({ left: i * track.clientWidth, behavior: "smooth" });
  }, []);

  // A page full of cards is a page with no bare surface left to swipe from — the rows
  // own every pixel of it, deliberately. So the hint line under the segments is a
  // handle: it is only there when the page HAS cards, which is exactly when the page
  // itself has run out of room to be grabbed. Same gesture, stepped by hand because
  // this element is outside the pager's own scroller.
  const hintSwipe = useScreenSwipe((dir) => {
    if (dir === "left") goTo(Math.min(index + 1, pages.length - 1));
    else if (index > 0) goTo(index - 1);
    else ui.setTab("now");
  });

  return (
    <div className="phone-lists">
      <div
        className="phone-seg"
        role="tablist"
        aria-label="Lists"
        onPointerDown={onSegPointerDown}
        onPointerMove={onSegPointerMove}
        onPointerUp={cancelSegPress}
        onPointerCancel={cancelSegPress}
        onPointerLeave={cancelSegPress}
        onContextMenu={(e) => e.preventDefault()}
      >
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
            onClick={() => {
              if (segPress.current.fired) return; // the long-press already opened Lists
              goTo(i);
            }}
          >
            {page.label}
          </button>
        ))}
      </div>

      {/* The column's own hint — orientation for a list you're actually using, not
          furniture on an empty one you already know the point of. */}
      {pages[index] && (order[pages[index].id]?.length ?? 0) > 0 && (
        <p className="wm-ph-hint wm-ph-pad phone-lists__hint" style={{ marginTop: 8 }} {...hintSwipe}>
          {pages[index].hint}
        </p>
      )}

      <div className="phone-pager" ref={trackRef} {...swipe}>
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

// Which of a page's two trays a card is standing in.
type Tray = "open" | "done";

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
  //
  // Reorder is over the OPEN cards only. The done ones are collapsed to a count until
  // you ask for them — a receipt, not a workspace, exactly like Now's "Done today"
  // (PhoneHome.tsx) — and where a done card sits in the list stopped mattering the
  // moment it was tucked away.
  //
  // Which means this page owns optimistic completion for exactly the reason Now does:
  // the two trays are two different parents, so a row split on server truth alone is
  // UNMOUNTED the instant the revalidation lands — well inside the 900ms window — and
  // its Undo, its pop and its error go with it. Same two maps as PhoneHome:
  //
  //   optimistic — id → the checkbox's local truth, until the server agrees;
  //   held       — id → the tray it was tapped in, until its collapse finishes.
  const [showDone, setShowDone] = useState(false);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [held, setHeld] = useState<Map<string, Tray>>(new Map());
  // Where each row is standing right now, read at the moment one is tapped. A ref,
  // because the callbacks below outlive any single render.
  const trayRef = useRef<Map<string, Tray>>(new Map());

  const open: Item[] = [];
  const done: Item[] = [];
  const placement = new Map<string, Tray>();
  // The count is derived WITHOUT the pin: `held` keeps a just-tapped row where the
  // thumb left it for 900ms, but the count is a receipt and has to agree with the tap
  // in the same frame.
  let doneCount = 0;
  for (const card of cards) {
    const natural: Tray = (optimistic[card.id] ?? effectiveDone(card, today)) ? "done" : "open";
    if (natural === "done") doneCount++;
    const tray = held.get(card.id) ?? natural;
    placement.set(card.id, tray);
    (tray === "done" ? done : open).push(card);
  }
  trayRef.current = placement;

  // A row that has settled back onto the server's answer no longer needs an override,
  // so the map stays the size of what is actually in flight.
  useEffect(() => {
    setOptimistic((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const [id, value] of Object.entries(prev)) {
        const card = cards.find((c) => c.id === id);
        if (card && effectiveDone(card, today) === value) changed = true;
        else next[id] = value;
      }
      return changed ? next : prev;
    });
  }, [cards, today]);

  const onCheckedChange = useCallback((id: string, checked: boolean) => {
    setOptimistic((prev) => (prev[id] === checked ? prev : { ...prev, [id]: checked }));
  }, []);

  const onHold = useCallback(
    (id: string, holding: boolean) => {
      setHeld((prev) => {
        const next = new Map(prev);
        if (holding) {
          const tray = trayRef.current.get(id);
          if (tray) next.set(id, tray);
          else return prev;
        } else {
          if (!next.has(id)) return prev;
          next.delete(id);
        }
        return next;
      });
    },
    [], // trayRef is a ref: always current, never a dependency
  );

  const rowProps = useCallback(
    (item: Item) => ({
      checked: optimistic[item.id] ?? effectiveDone(item, today),
      childItems: childrenByParent.get(item.id),
      today,
      snoozeListId: list.id === snoozeListId ? null : snoozeListId,
      // A page has a Done tray now, so a ticked row collapses into it rather than
      // staying put — the same move Now makes.
      collapseOnDone: true,
      onCheckedChange,
      onHold,
      onSettled: (id: string) => onHold(id, false),
    }),
    [childrenByParent, today, list.id, snoozeListId, optimistic, onCheckedChange, onHold],
  );

  return (
    <>
      <PhoneReorderRows
        cards={open}
        listId={list.id}
        listLabel={list.label}
        className="phone-rows phone-page__rows"
        rowProps={rowProps}
        // The page's stored order is every card on it, so the settled open cards go
        // back with the done ones still behind them.
        onReorder={(next) => onReorder([...next, ...done])}
      />
      {cards.length === 0 && <p className="phone-empty">{emptyCopyFor(list.id)}</p>}

      {(doneCount > 0 || done.length > 0) && (
        <section className="phone-section">
          <button
            type="button"
            className="phone-section__toggle"
            aria-expanded={showDone}
            onClick={() => setShowDone((v) => !v)}
          >
            <span className="phone-section__title">Done</span>
            <span className="phone-section__count tabular-nums">{doneCount}</span>
            <span className={`phone-chevron${showDone ? " is-open" : ""}`} aria-hidden>
              <svg viewBox="0 0 16 16" width="14" height="14">
                <path
                  d="M5.5 3.5L10.5 8l-5 4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
          {showDone && (
            <ul className="phone-rows phone-page__rows">
              {done.map((item) => (
                <PhoneRow key={item.id} item={item} {...rowProps(item)} />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
