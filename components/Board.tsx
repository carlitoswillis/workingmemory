"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import type { Item, ItemEvent } from "@/lib/types";
import type { ListId, ListDef } from "@/lib/lists";
import { NOTE_LIST, MAX_LISTS } from "@/lib/lists";
import { reconstructBoardAt, type BoardItemAt } from "@/lib/timetravel";
import {
  addItemAction,
  addListAction,
  deleteListAction,
  getItemAction,
  moveItemAction,
  renameListAction,
  reorderItemAction,
  reorderItemsAction,
  reorderListsAction,
  setParentAction,
  timelineDataAction,
} from "@/app/actions";
import SortableColumn from "./SortableColumn";
import AddColumn from "./AddColumn";
import { BoardIdProvider } from "./board-context";
import CardPanel from "./CardPanel";
import SnapshotCardPanel from "./SnapshotCardPanel";
import NoteColumn from "./NoteColumn";
import TimeMachineBar from "./TimeMachineBar";
import QuickCapture from "./QuickCapture";
import SearchOverlay from "./SearchOverlay";

type Grouped = Record<string, Item[]>;
type Move = { id: string; list: string; position: number };

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6";

// N evenly-spaced position values to drop a block of cards between two neighbors.
function spacedPositions(prev: number | undefined, next: number | undefined, n: number): number[] {
  if (prev != null && next != null) {
    const step = (next - prev) / (n + 1);
    return Array.from({ length: n }, (_, i) => prev + step * (i + 1));
  }
  if (prev != null) return Array.from({ length: n }, (_, i) => prev + 1000 * (i + 1));
  if (next != null) return Array.from({ length: n }, (_, i) => next - 1000 * (n - i));
  const base = Date.now();
  return Array.from({ length: n }, (_, i) => base + 1000 * i);
}

// How far across a card you have to be for a drop to mean "put it INSIDE this one"
// rather than "put it next to this one". Nesting is decided from the pointer's
// position within the card you're already over — NOT from a droppable of its own.
// (v1 made the nest zone a real droppable; entering it took `over` off the sortable
// list, which collapsed dnd-kit's make-space gap and snapped every card back, moving
// the target out from under the cursor. Owner verdict: "realllyyy difficult". With no
// extra droppable the board behaves exactly as it always did while dragging, and only
// the release point decides.)
const NEST_ZONE = 0.55;

// Group TOP-LEVEL items into per-list arrays, preserving their (position-sorted)
// order. Sub-cards (parent_id set) never render as board cards — they live inside
// their parent's panel.
function groupItems(items: Item[], lists: readonly ListDef[]): Grouped {
  const by: Grouped = {};
  for (const l of lists) by[l.id] = [];
  for (const it of items) {
    if (it.parent_id) continue;
    if (it.list === NOTE_LIST) continue; // the note has its own column
    (by[it.list] ??= []).push(it);
  }
  return by;
}

// Map each parent id → its direct children, in board order.
function groupChildren(items: Item[]): Map<string, Item[]> {
  const by = new Map<string, Item[]>();
  for (const it of items) {
    if (!it.parent_id) continue;
    const arr = by.get(it.parent_id);
    if (arr) arr.push(it);
    else by.set(it.parent_id, [it]);
  }
  return by;
}

export default function Board({
  boardId,
  lists,
  listLabels,
  actors,
  items,
}: {
  boardId: string | null;
  lists: readonly ListDef[];
  listLabels: Record<string, string>;
  actors: Record<string, string>; // actor_id -> username, for history attribution
  items: Item[];
}) {
  // Cards search dug up that aren't on the live board (archived ones, or the card
  // behind a history hit). Kept alongside `items` purely so the panel can open them;
  // once one is restored it comes back through `items` and that copy wins.
  const [found, setFound] = useState<Item[]>([]);
  const lookup = (id: string): Item | null =>
    items.find((i) => i.id === id) ?? found.find((i) => i.id === id) ?? null;

  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const openCard = openCardId ? lookup(openCardId) : null;

  // Quick-capture overlay: a keyboard-first "dump to Brain Dump" always in reach.
  const [captureOpen, setCaptureOpen] = useState(false);
  // Search overlay ("/"): find a card anywhere on the board, sub-cards included.
  const [searchOpen, setSearchOpen] = useState(false);
  const openParent = openCard?.parent_id ? lookup(openCard.parent_id) : null;

  // Direct children per parent — drives the panel's sub-cards and the board badge.
  const childrenByParent = groupChildren(items);

  // The single active daily note (if any).
  const note = items.find((i) => i.list === NOTE_LIST && !i.archived && !i.parent_id) ?? null;

  // Multi-select: a set of card ids. ⌘/Ctrl-click toggles, Shift-click extends a
  // range within a column. Dragging any selected card moves the whole set.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  function clearSelection() {
    setSelection((prev) => (prev.size ? new Set() : prev));
    anchorRef.current = null;
  }

  // The open-card panel's depth is mirrored onto the browser history stack, so a phone
  // swipe-back (or the browser/hardware back button — both fire `popstate`) steps back
  // through the panel exactly like the on-screen back arrow: sub-card → its parent →
  // the board. "Previous screen" is defined by the parent chain (see chainOf).
  //
  //  - Forward (open a card / drill into a sub-card): push ONE history entry tagged with
  //    the new depth, preserving Next's own history.state so routing keeps working.
  //  - Backward (tap the back arrow / ✕): history.go(-n); the popstate handler below then
  //    resolves openCardId from the entry we land on — one code path for gesture + button.
  function chainOf(id: string): string[] {
    const chain: string[] = [];
    let cur: Item | null = lookup(id);
    while (cur) {
      chain.unshift(cur.id);
      cur = cur.parent_id ? lookup(cur.parent_id) : null;
    }
    return chain;
  }
  function navigateTo(id: string | null) {
    const targetDepth = id ? chainOf(id).length : 0;
    const curDepth = openCardId ? chainOf(openCardId).length : 0;
    if (targetDepth > curDepth) {
      window.history.pushState({ ...window.history.state, wmDepth: targetDepth }, "");
      setOpenCardId(id);
    } else if (targetDepth < curDepth) {
      // Let popstate update openCardId as the entries unwind (handles gesture + button alike).
      window.history.go(targetDepth - curDepth);
    } else {
      window.history.replaceState({ ...window.history.state, wmDepth: targetDepth }, "");
      setOpenCardId(id);
    }
  }
  // Reassigned every render (like keyHandlerRef) so it always closes over fresh `items`.
  const popHandlerRef = useRef<(e: PopStateEvent) => void>(() => {});
  popHandlerRef.current = (e: PopStateEvent) => {
    const targetDepth = ((e.state as { wmDepth?: number } | null)?.wmDepth) ?? 0;
    setOpenCardId((prev) => {
      if (targetDepth === 0 || !prev) return null;
      return chainOf(prev)[targetDepth - 1] ?? null;
    });
  };
  useEffect(() => {
    const h = (e: PopStateEvent) => popHandlerRef.current(e);
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, []);

  function openCardFromBoard(item: Item) {
    clearSelection();
    navigateTo(item.id);
  }

  // Open a card by id — the search overlay's "pick", which may point at an archived
  // card or at whatever card a history hit belongs to. Anything not on the live board
  // is fetched once and parked in `found` so the panel has a row to render.
  async function openById(id: string) {
    if (!lookup(id)) {
      const fetched = await getItemAction(boardId, id);
      if (!fetched) return;
      setFound((prev) => [...prev.filter((p) => p.id !== id), fetched]);
    }
    navigateTo(id);
  }

  // Time machine. The full (small, single-user) event log is shipped to the client once,
  // so the scrubber reconstructs any past moment locally with no per-tick round-trip.
  const [timeline, setTimeline] = useState<{ items: Item[]; events: ItemEvent[] } | null>(null);
  const [now] = useState(() => Date.now());
  const [valueMs, setValueMs] = useState<number | null>(null); // null = live board
  const [snapshot, setSnapshot] = useState<BoardItemAt[] | null>(null);
  const [openSnapId, setOpenSnapId] = useState<string | null>(null);
  const loading = timeline === null;

  useEffect(() => {
    let alive = true;
    timelineDataAction(boardId).then((d) => alive && setTimeline(d));
    return () => {
      alive = false;
    };
  }, [items]); // refresh the timeline whenever the live board changes

  // Distinct moments the board actually changed — the scrubber's ticks + snap points.
  const markers = useMemo(() => {
    if (!timeline) return [] as number[];
    const set = new Set<number>();
    for (const e of timeline.events) set.add(new Date(e.at).getTime());
    return [...set].filter((m) => m <= now).sort((a, b) => a - b);
  }, [timeline, now]);
  const minMs = markers[0] ?? now;
  const asOf = valueMs != null ? new Date(valueMs).toISOString() : null;

  // Column order (optimistic; persisted per-board). Columns are user-created data now
  // (a `lists` table); `lists` arrives pre-ordered by position from the server.
  const [listOrder, setListOrder] = useState<string[]>(lists.map((l) => l.id));
  useEffect(() => setListOrder(lists.map((l) => l.id)), [lists]);
  const listById = new Map<string, ListDef>(lists.map((l) => [l.id, l]));
  const orderedLists = listOrder
    .map((id) => listById.get(id))
    .filter((l): l is ListDef => !!l);

  // Column CRUD. Add/rename/delete round-trip to the server and rely on revalidation
  // to reflect (columns change rarely; not worth the optimistic bookkeeping cards get).
  // Delete can be refused (last column / still holds cards) — surface the reason.
  // NOTE: these MUST run inside startTransition — that's what makes the action's
  // revalidatePath refresh the board on the client. Called bare, the soft-delete
  // lands on the server but the column lingers on screen until a reload.
  const [notice, setNotice] = useState<string | null>(null);
  function addColumn(label: string) {
    startTransition(async () => {
      const err = await addListAction(boardId, label);
      if (err) setNotice(err);
    });
  }
  function renameColumn(id: string, label: string) {
    startTransition(() => renameListAction(boardId, id, label));
  }
  function deleteColumn(id: string) {
    startTransition(async () => setNotice(await deleteListAction(boardId, id)));
  }

  // Cards grouped by list. A ref mirrors state so drag handlers never read stale data.
  const [itemsByList, setItemsByList] = useState<Grouped>(() => groupItems(items, lists));
  const itemsRef = useRef<Grouped>(itemsByList);
  useEffect(() => {
    const g = groupItems(items, lists);
    itemsRef.current = g;
    setItemsByList(g);
  }, [items, lists]);

  const [activeId, setActiveId] = useState<string | null>(null);
  // The card a release would drop INTO (see NEST_ZONE). Visual only — it's the card's
  // own sortable id, so no extra droppable disturbs the drag.
  const [nestTargetId, setNestTargetId] = useState<string | null>(null);
  // Where the finger/cursor actually is. dnd-kit's collisions work off the dragged
  // card's rect, but a person aims with the pointer, so nesting is judged by that.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const activeItem = activeId
    ? Object.values(itemsByList).flat().find((i) => i.id === activeId) ?? null
    : null;
  const dragCount =
    activeId && selection.has(activeId) && selection.size > 1 ? selection.size : 1;

  const [, startTransition] = useTransition();

  // Real-time (phase 2): a poke on the SSE stream triggers router.refresh(), which
  // re-renders the server board and flows into the same `items`/`lists` resync the
  // optimistic layer already uses. Mirror the two "don't yank the board now" states
  // into refs so the long-lived stream effect reads them without re-subscribing.
  const router = useRouter();
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;
  const timeTravelingRef = useRef(false);
  timeTravelingRef.current = snapshot !== null;

  // Undo for moves: capture each dragged card's origin (list+position) at drag start,
  // push a "put it back" step on a stack when the move lands, and ⌘/Ctrl-Z (or the Undo
  // pill) runs it. A step is a closure rather than a plain list of positions because
  // nesting has to undo two things (the parent AND where the card sat on the board).
  const dragOriginRef = useRef<Move[]>([]);
  const undoStack = useRef<{ label: string; run: () => void }[]>([]);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [undoHint, setUndoHint] = useState<string | null>(null);

  function captureOrigins(ids: string[]): Move[] {
    const c = itemsRef.current;
    const out: Move[] = [];
    for (const id of ids) {
      for (const k of Object.keys(c)) {
        const it = c[k].find((x) => x.id === id);
        if (it) {
          out.push({ id, list: k, position: it.position });
          break;
        }
      }
    }
    return out;
  }

  function pushUndo(label: string, run: () => void) {
    undoStack.current.push({ label, run });
    setUndoHint(label);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoHint(null), 6000);
  }

  // The common case: put these cards back where they were on the board.
  function pushMoveUndo(prev: Move[], label: string) {
    if (prev.length === 0) return;
    pushUndo(label, () => {
      applyMoves(prev);
      reorderItemsAction(boardId, prev);
    });
  }

  function applyMoves(moves: Move[]) {
    const c = itemsRef.current;
    const all = Object.values(c)
      .flat()
      .map((it) => {
        const m = moves.find((x) => x.id === it.id);
        return m ? { ...it, list: m.list as ListId, position: m.position } : it;
      })
      .sort((a, b) => a.position - b.position);
    const g = groupItems(all, lists);
    itemsRef.current = g;
    setItemsByList(g);
  }

  function performUndo() {
    const step = undoStack.current.pop();
    setUndoHint(null);
    if (!step) return;
    startTransition(() => step.run());
  }

  // Optimistic add: drop a temp card into its list immediately, then persist. When the
  // server revalidates, the `items`-driven resync (above) replaces the temp with the real
  // row (same end-of-list position), so the swap is seamless. Same manual-optimistic
  // pattern the drag handlers use — not useOptimistic, which would fight itemsRef.
  function addCard(listId: string, text: string) {
    const t = text.trim();
    if (!t || !listById.has(listId)) return;
    const nowIso = new Date().toISOString();
    const temp: Item = {
      id: `temp-${crypto.randomUUID()}`,
      text: t,
      details: "",
      list: listId,
      done: false,
      recurrence: "none",
      completed_on: null,
      parent_id: null,
      position: Date.now(),
      archived: false,
      created_at: nowIso,
      updated_at: nowIso,
    };
    const c = itemsRef.current;
    const next: Grouped = { ...c, [listId]: [...(c[listId] ?? []), temp] };
    itemsRef.current = next;
    setItemsByList(next);
    startTransition(() => addItemAction(boardId, t, listId));
  }

  // Optimistic cross-list move (the CardPanel dropdown; drag already does its own). Move
  // the card between lists locally, then persist. Sub-cards aren't in itemsByList — they
  // just fall through to the server action.
  function moveCardToList(id: string, toList: string) {
    if (!listById.has(toList)) return;
    const c = itemsRef.current;
    let moved: Item | undefined;
    const next: Grouped = {};
    for (const k of Object.keys(c)) {
      next[k] = c[k].filter((it) => {
        if (it.id === id) {
          moved = { ...it, list: toList };
          return false;
        }
        return true;
      });
    }
    if (moved) {
      next[toList] = [...(next[toList] ?? []), moved];
      itemsRef.current = next;
      setItemsByList(next);
    }
    startTransition(() => moveItemAction(boardId, id, toList));
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function containerOf(id: string): string | undefined {
    const c = itemsRef.current;
    if (c[id]) return id; // it's a column id
    return Object.keys(c).find((k) => c[k].some((i) => i.id === id));
  }

  function handleSelect(item: Item, mode: "toggle" | "range") {
    setSelection((prev) => {
      const next = new Set(prev);
      if (mode === "range" && anchorRef.current) {
        const list = containerOf(item.id);
        const anchorList = containerOf(anchorRef.current);
        if (list && list === anchorList) {
          const arr = itemsRef.current[list];
          const i1 = arr.findIndex((x) => x.id === anchorRef.current);
          const i2 = arr.findIndex((x) => x.id === item.id);
          if (i1 >= 0 && i2 >= 0) {
            const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1];
            for (let i = lo; i <= hi; i++) next.add(arr[i].id);
            return next;
          }
        }
      }
      // toggle (and the fallback when a range has no valid anchor)
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      anchorRef.current = item.id;
      return next;
    });
  }

  // Keyboard: Esc clears the selection, ⌘/Ctrl-Z undoes the last move. Ignore while
  // typing in a field so native text undo and Esc keep working there.
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    if (typing) return;
    // Quick-capture (live board only): ⌘/Ctrl-K or a bare "c". Not while time-traveling.
    const canCapture = snapshot === null && !captureOpen && !searchOpen;
    // Search: "/" — the same live-board rule (a past card has no panel to open).
    if (canCapture && e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setSearchOpen(true);
      return;
    }
    if (canCapture && (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      setCaptureOpen(true);
      return;
    }
    if (canCapture && e.key === "c" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setCaptureOpen(true);
      return;
    }
    if (e.key === "Escape") clearSelection();
    if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      performUndo();
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Real-time board stream. Only hosted account boards have other sessions to sync
  // with (local/demo boardId is null → skip). On a poke whose high-water mark is
  // newer than what we've seen, debounce a router.refresh() (a burst from one drag
  // becomes one refetch); hold off while the user is dragging or time-traveling.
  // EventSource reconnects itself on error — its first frame after a reconnect (a
  // higher mark than `lastSeen`) is exactly how we catch changes missed while away.
  useEffect(() => {
    if (!boardId) return;
    let lastSeen: number | null = null; // null until the baseline (first) frame
    let timer: ReturnType<typeof setTimeout> | null = null;
    let connected = false;

    const flush = () => {
      if (activeRef.current !== null || timeTravelingRef.current) {
        timer = setTimeout(flush, 500); // retry once the user is idle again
        return;
      }
      timer = null;
      router.refresh();
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 300);
    };

    const es = new EventSource(`/api/boards/${boardId}/stream`);
    es.onopen = () => {
      connected = true;
    };
    es.onmessage = (e) => {
      let h: unknown;
      try {
        h = JSON.parse(e.data).h;
      } catch {
        return;
      }
      if (typeof h !== "number") return;
      if (lastSeen === null) lastSeen = h; // baseline: don't refresh on connect
      else if (h > lastSeen) {
        lastSeen = h;
        schedule();
      }
    };
    es.onerror = () => {
      connected = false; // EventSource retries on its own; nothing to do
    };

    // Fallbacks: refetch on tab focus (covers the laptop-lid case + your own other
    // tab), and a slow interval ONLY while the stream is broken — no polling cost
    // in the healthy path.
    const onFocus = () => schedule();
    const onVisible = () => document.visibilityState === "visible" && schedule();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const fallback = setInterval(() => {
      if (!connected) schedule();
    }, 90_000);

    return () => {
      es.close();
      if (timer) clearTimeout(timer);
      clearInterval(fallback);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [boardId, router]);

  // Scrub to a moment: reconstruct the board locally (pure fn over the shipped log).
  function pickMoment(ms: number) {
    if (!timeline) return;
    const clamped = Math.max(minMs, Math.min(ms, now));
    setValueMs(clamped);
    setSnapshot(reconstructBoardAt(timeline.items, timeline.events, new Date(clamped).toISOString()));
  }
  function backToNow() {
    setValueMs(null);
    setSnapshot(null);
    setOpenSnapId(null);
  }

  // Snapshot lookups for the read-only past panel.
  const snapById = useMemo(() => {
    const m = new Map<string, BoardItemAt>();
    for (const s of snapshot ?? []) m.set(s.id, s);
    return m;
  }, [snapshot]);
  const snapChildren = useMemo(() => {
    const m = new Map<string, BoardItemAt[]>();
    for (const s of snapshot ?? []) {
      if (!s.parent_id) continue;
      const arr = m.get(s.parent_id);
      if (arr) arr.push(s);
      else m.set(s.parent_id, [s]);
    }
    return m;
  }, [snapshot]);
  const openSnap = openSnapId ? snapById.get(openSnapId) ?? null : null;
  const openSnapParent = openSnap?.parent_id ? snapById.get(openSnap.parent_id) ?? null : null;

  // Columns for a time-travel snapshot: the live columns, plus any since-deleted
  // column that still held a card at that past moment — so deleting a column never
  // erases it from history (its label survives via listLabels; the row is only
  // soft-archived). Live board obviously shows only live columns.
  const snapshotLists: ListDef[] = [...orderedLists];
  if (snapshot) {
    const known = new Set(orderedLists.map((l) => l.id));
    for (const s of snapshot) {
      if (s.parent_id || s.list === NOTE_LIST || known.has(s.list)) continue;
      known.add(s.list);
      snapshotLists.push({ id: s.list, label: listLabels[s.list] ?? s.list, hint: "" });
    }
  }

  // Track the pointer only while a drag is running (activeRef is set for the whole
  // drag), so the board isn't listening to every mouse move on an idle page.
  useEffect(() => {
    const fromPointer = (e: PointerEvent) => {
      if (activeRef.current) pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    const fromTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (activeRef.current && t) pointerRef.current = { x: t.clientX, y: t.clientY };
    };
    window.addEventListener("pointermove", fromPointer, { passive: true });
    window.addEventListener("touchmove", fromTouch, { passive: true });
    return () => {
      window.removeEventListener("pointermove", fromPointer);
      window.removeEventListener("touchmove", fromTouch);
    };
  }, []);

  // Mid-drag: is the pointer far enough across the card it's over to mean "inside"?
  // Requires the pointer to be within that card's box, so a collision with a card the
  // cursor isn't actually on can never nest.
  function onDragMove(e: DragMoveEvent) {
    const { active, over } = e;
    if (active.data.current?.type !== "card" || !over) return setNestTargetId(null);
    const overId = String(over.id);
    const p = pointerRef.current;
    const r = over.rect;
    if (!p || !r) return setNestTargetId(null);
    // Skip columns (they're droppables too), the card being dragged, and any card
    // travelling with it in a multi-select.
    if (itemsRef.current[overId] || overId === String(active.id) || selection.has(overId)) {
      return setNestTargetId(null);
    }
    const insideCard =
      p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height;
    setNestTargetId(insideCard && p.x >= r.left + r.width * NEST_ZONE ? overId : null);
  }

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setActiveId(id);
    setNestTargetId(null);
    if (e.active.data.current?.type === "card") {
      // Remember where the dragged card(s) started, for undo.
      const ids = selection.has(id) && selection.size > 1 ? [...selection] : [id];
      dragOriginRef.current = captureOrigins(ids);
      // Dragging a card that isn't part of the selection starts a clean single drag.
      if (!selection.has(id)) clearSelection();
    } else {
      dragOriginRef.current = [];
    }
  }

  // Mid-drag: move a card into whatever column it's hovering.
  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over || active.data.current?.type !== "card") return;
    const from = containerOf(String(active.id));
    const to = containerOf(String(over.id));
    if (!from || !to || from === to) return;

    const c = itemsRef.current;
    const fromItems = c[from];
    const toItems = c[to];
    const idx = fromItems.findIndex((i) => i.id === active.id);
    if (idx < 0) return;
    const moved = { ...fromItems[idx], list: to as ListId };
    let insertAt = toItems.findIndex((i) => i.id === over.id);
    if (insertAt < 0) insertAt = toItems.length;

    const next: Grouped = {
      ...c,
      [from]: fromItems.filter((i) => i.id !== active.id),
      [to]: [...toItems.slice(0, insertAt), moved, ...toItems.slice(insertAt)],
    };
    itemsRef.current = next;
    setItemsByList(next);
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const type = active.data.current?.type;
    const nestInto = nestTargetId;
    setActiveId(null);
    setNestTargetId(null);
    pointerRef.current = null;
    if (!over) return;

    if (type === "column") {
      const oldI = listOrder.indexOf(String(active.id));
      const newI = listOrder.indexOf(String(over.id));
      if (oldI >= 0 && newI >= 0 && oldI !== newI) {
        const nextOrder = arrayMove(listOrder, oldI, newI);
        setListOrder(nextOrder);
        reorderListsAction(boardId, nextOrder);
      }
      return;
    }

    const draggedId = String(active.id);
    const overId = String(over.id);

    // NEST: released on the right side of another card — the dragged card (or the
    // whole selection) moves INSIDE it and off the board's top level. Optimistically
    // pull the cards out of their columns; the server decides for real (it refuses
    // loops), and a refusal puts the board straight back.
    if (nestInto && nestInto !== draggedId) {
      const parentId = nestInto;
      const ids =
        selection.has(draggedId) && selection.size > 1 ? [...selection] : [draggedId];
      if (ids.includes(parentId)) return;
      const before = itemsRef.current;
      const next: Grouped = {};
      for (const k of Object.keys(before)) next[k] = before[k].filter((it) => !ids.includes(it.id));
      itemsRef.current = next;
      setItemsByList(next);
      clearSelection();

      const origins = dragOriginRef.current;
      const parentText = Object.values(before).flat().find((i) => i.id === parentId)?.text;
      pushUndo(
        ids.length > 1 ? `Nested ${ids.length} cards` : "Nested card",
        () => {
          // Two steps: back out onto the board, then back into the exact slot it left.
          setParentAction(boardId, ids, null).then(() => reorderItemsAction(boardId, origins));
        },
      );
      startTransition(async () => {
        const err = await setParentAction(boardId, ids, parentId);
        if (err) {
          itemsRef.current = before;
          setItemsByList(before);
          undoStack.current.pop();
          setUndoHint(null);
          setNotice(err);
        } else if (parentText) {
          setUndoHint(
            ids.length > 1 ? `Nested ${ids.length} cards in “${parentText}”` : `Nested in “${parentText}”`,
          );
        }
      });
      return;
    }

    // MULTI-SELECT: relocate the whole selected set as a contiguous block, in board
    // reading order, into the target list at the drop point.
    if (selection.has(draggedId) && selection.size > 1) {
      const c = itemsRef.current;
      const targetList = containerOf(draggedId);
      if (!targetList) return;

      const block: Item[] = [];
      for (const lid of listOrder) {
        for (const it of c[lid] ?? []) {
          if (selection.has(it.id)) block.push({ ...it, list: targetList as ListId });
        }
      }
      if (block.length === 0) return;

      // Insertion point = where `over` sits among the NON-selected cards of the list.
      const fullTarget = c[targetList];
      let anchorIndex = fullTarget.findIndex((it) => it.id === overId);
      if (anchorIndex < 0) anchorIndex = fullTarget.length; // dropped on an empty column
      let insertAt = 0;
      for (let i = 0; i < anchorIndex; i++) if (!selection.has(fullTarget[i].id)) insertAt++;

      const work: Grouped = {};
      for (const k of Object.keys(c)) work[k] = c[k].filter((it) => !selection.has(it.id));
      const rest = work[targetList];
      const merged = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];

      const positions = spacedPositions(
        merged[insertAt - 1]?.position,
        merged[insertAt + block.length]?.position,
        block.length,
      );
      for (let i = 0; i < block.length; i++) {
        block[i] = { ...block[i], position: positions[i] };
        merged[insertAt + i] = block[i];
      }
      work[targetList] = merged;

      itemsRef.current = work;
      setItemsByList(work);
      clearSelection();
      pushMoveUndo(dragOriginRef.current, `Moved ${block.length} cards`);
      startTransition(() =>
        reorderItemsAction(
          boardId,
          block.map((b) => ({ id: b.id, list: targetList, position: b.position })),
        ),
      );
      return;
    }

    // Card: finalize order within its (possibly new) column, then persist.
    const list = containerOf(String(active.id));
    if (!list) return;
    const c = itemsRef.current;
    const arr = c[list];
    const oldIndex = arr.findIndex((i) => i.id === active.id);
    let newIndex = arr.findIndex((i) => i.id === over.id);
    if (newIndex < 0) newIndex = arr.length - 1;
    const reordered = oldIndex === newIndex ? arr : arrayMove(arr, oldIndex, newIndex);

    const fi = reordered.findIndex((i) => i.id === active.id);
    const prevPos = reordered[fi - 1]?.position;
    const nextPos = reordered[fi + 1]?.position;
    let pos: number;
    if (prevPos != null && nextPos != null) pos = (prevPos + nextPos) / 2;
    else if (prevPos != null) pos = prevPos + 1000;
    else if (nextPos != null) pos = nextPos - 1000;
    else pos = Date.now();

    const next: Grouped = { ...c, [list]: reordered };
    itemsRef.current = next;
    setItemsByList(next);
    const origin = dragOriginRef.current[0];
    if (!origin || origin.list !== list || oldIndex !== newIndex) {
      pushMoveUndo(dragOriginRef.current, "Moved card");
    }
    startTransition(() => reorderItemAction(boardId, String(active.id), list, pos));
  }

  return (
    <BoardIdProvider value={boardId}>
      <TimeMachineBar
        markers={markers}
        minMs={minMs}
        nowMs={now}
        valueMs={valueMs}
        active={snapshot !== null}
        loading={loading}
        onPick={pickMoment}
        onLive={backToNow}
      />

      {snapshot ? (
        <div className={`memory-mode ${GRID}`}>
          <SnapshotNoteColumn
            body={snapshot.find((i) => i.list === NOTE_LIST && !i.parent_id)?.details ?? ""}
          />
          {snapshotLists.map((list) => (
            <SnapshotColumn
              key={list.id}
              list={list}
              items={snapshot.filter((i) => i.list === list.id && !i.parent_id)}
              childrenByParent={snapChildren}
              onOpenCard={setOpenSnapId}
            />
          ))}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setActiveId(null);
            setNestTargetId(null);
          }}
        >
          <SortableContext items={listOrder} strategy={rectSortingStrategy}>
            <div className={GRID}>
              <NoteColumn note={note} />
              {orderedLists.map((list) => (
                <SortableColumn
                  key={list.id}
                  list={list}
                  allLists={orderedLists}
                  items={itemsByList[list.id] ?? []}
                  childrenByParent={childrenByParent}
                  selection={selection}
                  activeId={activeId}
                  nestTargetId={nestTargetId}
                  canDelete={orderedLists.length > 1}
                  onSelect={handleSelect}
                  onOpenCard={openCardFromBoard}
                  onAdd={addCard}
                  onRename={renameColumn}
                  onDelete={deleteColumn}
                />
              ))}
              <AddColumn onAdd={addColumn} disabled={orderedLists.length >= MAX_LISTS} />
            </div>
          </SortableContext>
          <DragOverlay>
            {activeItem ? (
              <div className="relative">
                {dragCount > 1 && (
                  <div
                    aria-hidden
                    className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-lg border border-[var(--veil)] bg-[var(--surface)]"
                  />
                )}
                <div
                  className="relative rounded-lg border border-[var(--veil)] bg-[var(--surface-2)] py-1.5 pl-2 pr-2 text-[13.5px] leading-snug text-[var(--text-hi)] shadow-2xl"
                  style={{ borderLeft: "2px solid var(--now)" }}
                >
                  {activeItem.text}
                </div>
                {dragCount > 1 && (
                  <span className="absolute -right-2 -top-2 grid h-5 min-w-[20px] place-items-center rounded-full bg-[var(--now)] px-1 text-[11px] font-medium tabular-nums text-[var(--bg-0)] shadow-lg">
                    {dragCount}
                  </span>
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {!snapshot && selection.size > 0 && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--veil)] bg-[var(--bg-1)] py-2 pl-4 pr-2 shadow-2xl">
          <span className="text-sm text-[var(--text-hi)]">
            <span className="font-medium tabular-nums">{selection.size}</span> selected
          </span>
          <span className="hidden text-xs text-[var(--text-lo)] sm:inline">
            drag any one to move them together
          </span>
          <button
            onClick={clearSelection}
            className="rounded-full px-3 py-1 text-xs text-[var(--text-mid)] hover:bg-[var(--surface-2)] hover:text-[var(--text-hi)]"
          >
            Clear · Esc
          </button>
        </div>
      )}

      {!snapshot && selection.size === 0 && undoHint && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--veil)] bg-[var(--bg-1)] py-2 pl-4 pr-2 shadow-2xl">
          <span className="text-sm text-[var(--text-mid)]">{undoHint}</span>
          <button
            onClick={performUndo}
            className="rounded-full px-3 py-1 text-xs text-[var(--now)] hover:bg-[var(--surface-2)]"
          >
            Undo · ⌘Z
          </button>
        </div>
      )}

      {notice && (
        <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--veil)] bg-[var(--bg-1)] py-2 pl-4 pr-2 shadow-2xl">
          <span className="text-sm text-[var(--text-mid)]">{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="rounded-full px-3 py-1 text-xs text-[var(--text-lo)] hover:bg-[var(--surface-2)] hover:text-[var(--text-hi)]"
          >
            Dismiss
          </button>
        </div>
      )}

      {!snapshot && !captureOpen && !searchOpen && selection.size === 0 && (
        <div className="fixed bottom-5 right-5 z-40 flex items-center gap-2">
          <button
            onClick={() => setSearchOpen(true)}
            title="Search this board · /"
            aria-label="Search this board"
            className="flex h-11 items-center gap-2 rounded-full border border-[var(--veil)] bg-[var(--bg-1)] px-4 text-sm text-[var(--text-mid)] shadow-2xl transition-colors hover:text-[var(--text-hi)]"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Search
            <kbd className="hidden font-grotesk text-[11px] text-[var(--text-lo)] sm:inline">
              /
            </kbd>
          </button>
          <button
            onClick={() => setCaptureOpen(true)}
            title="Quick capture to Brain Dump · c"
            aria-label="Quick capture to Brain Dump"
            className="flex h-11 items-center gap-2 rounded-full border border-[var(--veil)] bg-[var(--bg-1)] pl-3.5 pr-4 text-sm text-[var(--text-mid)] shadow-2xl transition-colors hover:text-[var(--text-hi)]"
          >
            <span className="text-[var(--now)]" aria-hidden>
              ＋
            </span>
            Capture
            <kbd className="hidden font-grotesk text-[11px] text-[var(--text-lo)] sm:inline">
              c
            </kbd>
          </button>
        </div>
      )}

      <SearchOverlay
        open={searchOpen}
        items={items.filter((i) => i.list !== NOTE_LIST)}
        listLabels={listLabels}
        onPick={openById}
        onClose={() => setSearchOpen(false)}
      />

      <QuickCapture
        open={captureOpen}
        listId={
          listById.has("braindump")
            ? "braindump"
            : orderedLists[orderedLists.length - 1]?.id ?? ""
        }
        onClose={() => setCaptureOpen(false)}
      />

      {openCard && (
        <CardPanel
          item={openCard}
          parent={openParent}
          allLists={lists}
          listLabels={listLabels}
          actors={actors}
          allItems={items}
          childItems={childrenByParent.get(openCard.id) ?? []}
          childrenByParent={childrenByParent}
          onOpenCard={(item) => navigateTo(item.id)}
          onMove={moveCardToList}
          onClose={() => navigateTo(null)}
        />
      )}

      {snapshot && openSnap && (
        <SnapshotCardPanel
          item={openSnap}
          parent={openSnapParent}
          listLabels={listLabels}
          childItems={snapChildren.get(openSnap.id) ?? []}
          asOf={asOf}
          onOpenCard={setOpenSnapId}
          onClose={() => setOpenSnapId(null)}
        />
      )}
    </BoardIdProvider>
  );
}

// Read-only note for the time-machine snapshot (the journal, as of then).
function SnapshotNoteColumn({ body }: { body: string }) {
  return (
    <section
      className="flex min-h-[220px] flex-col rounded-2xl border border-[var(--veil-soft)] bg-[var(--wash)] p-3"
      style={{ borderLeft: "2px solid var(--past)" }}
    >
      <div className="mb-3 px-1.5 pt-1">
        <h2 className="font-display text-[15px] font-medium tracking-tight text-[var(--text-mid)]">
          Note
        </h2>
      </div>
      {body.trim() ? (
        <p className="whitespace-pre-wrap px-1 font-display text-sm italic leading-relaxed text-[var(--text-mid)]">
          {body}
        </p>
      ) : (
        <p className="px-1.5 font-display text-xs italic text-[var(--text-lo)]">— blank then —</p>
      )}
    </section>
  );
}

// Read-only thin column for the time-machine snapshot. Cards click open a read-only
// past panel (details + sub-cards as of then); a ↳ badge counts reconstructed sub-cards.
function SnapshotColumn({
  list,
  items,
  childrenByParent,
  onOpenCard,
}: {
  list: ListDef;
  items: BoardItemAt[];
  childrenByParent: Map<string, BoardItemAt[]>;
  onOpenCard: (id: string) => void;
}) {
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  return (
    <section className="flex min-h-[220px] flex-col rounded-2xl border border-[var(--veil-soft)] bg-[var(--wash)] p-3">
      <div className="mb-3 px-1.5 pt-1">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-[15px] font-medium tracking-tight text-[var(--text-mid)]">
            {list.label}
          </h2>
          <span className="text-[11px] tabular-nums text-[var(--text-lo)]">{open.length || ""}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {[...open, ...done].map((item) => {
          const kids = childrenByParent.get(item.id) ?? [];
          const kidsDone = kids.filter((c) => c.done).length;
          const hasDetails = item.details.trim().length > 0;
          return (
            <button
              key={item.id}
              onClick={() => onOpenCard(item.id)}
              className="flex w-full items-start gap-2 rounded-lg border border-[var(--veil-soft)] border-l-2 border-l-[var(--past)] bg-[var(--surface)] py-1.5 pl-2 pr-1.5 text-left text-[13.5px] leading-snug transition-colors hover:bg-[var(--surface-2)]"
              title={item.details.trim() ? `${item.text}\n\n${item.details}` : item.text}
            >
              <span className={`min-w-0 flex-1 break-words ${item.done ? "text-[var(--text-lo)] line-through" : "text-[var(--text-mid)]"}`}>
                {item.text}
              </span>
              {kids.length > 0 && (
                <span
                  className="mt-[1px] shrink-0 rounded-full border border-[var(--veil)] px-1.5 py-[1px] text-[10px] leading-none tabular-nums text-[var(--text-lo)]"
                  title={`${kidsDone} of ${kids.length} sub-cards done then`}
                >
                  ↳ {kidsDone}/{kids.length}
                </span>
              )}
              {hasDetails && (
                <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--past)" }} aria-hidden />
              )}
            </button>
          );
        })}
        {items.length === 0 && (
          <p className="px-1.5 font-display text-xs italic text-[var(--text-lo)]">— empty then —</p>
        )}
      </div>
    </section>
  );
}
