"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  moveItemAction,
  renameListAction,
  reorderItemAction,
  reorderItemsAction,
  reorderListsAction,
  timelineDataAction,
} from "@/app/actions";
import SortableColumn from "./SortableColumn";
import AddColumn from "./AddColumn";
import CardPanel from "./CardPanel";
import SnapshotCardPanel from "./SnapshotCardPanel";
import NoteColumn from "./NoteColumn";
import TimeMachineBar from "./TimeMachineBar";
import QuickCapture from "./QuickCapture";

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
  lists,
  listLabels,
  items,
}: {
  lists: readonly ListDef[];
  listLabels: Record<string, string>;
  items: Item[];
}) {
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const openCard = openCardId ? items.find((i) => i.id === openCardId) ?? null : null;

  // Quick-capture overlay: a keyboard-first "dump to Brain Dump" always in reach.
  const [captureOpen, setCaptureOpen] = useState(false);
  const openParent =
    openCard?.parent_id ? items.find((i) => i.id === openCard.parent_id) ?? null : null;

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
    let cur: Item | undefined = items.find((i) => i.id === id);
    while (cur) {
      chain.unshift(cur.id);
      cur = cur.parent_id ? items.find((i) => i.id === cur!.parent_id) : undefined;
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
    timelineDataAction().then((d) => alive && setTimeline(d));
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
  const [columnError, setColumnError] = useState<string | null>(null);
  async function addColumn(label: string) {
    const err = await addListAction(label);
    if (err) setColumnError(err);
  }
  function renameColumn(id: string, label: string) {
    renameListAction(id, label);
  }
  async function deleteColumn(id: string) {
    setColumnError(await deleteListAction(id)); // err | null (clears on success)
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
  const activeItem = activeId
    ? Object.values(itemsByList).flat().find((i) => i.id === activeId) ?? null
    : null;
  const dragCount =
    activeId && selection.has(activeId) && selection.size > 1 ? selection.size : 1;

  const [, startTransition] = useTransition();

  // Undo for moves: capture each dragged card's origin (list+position) at drag start,
  // push it on a stack when the move lands, and ⌘/Ctrl-Z (or the Undo pill) restores it.
  const dragOriginRef = useRef<Move[]>([]);
  const undoStack = useRef<Move[][]>([]);
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

  function pushUndo(prev: Move[], label: string) {
    if (prev.length === 0) return;
    undoStack.current.push(prev);
    setUndoHint(label);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoHint(null), 6000);
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
    const prev = undoStack.current.pop();
    setUndoHint(null);
    if (!prev || prev.length === 0) return;
    applyMoves(prev);
    startTransition(() => reorderItemsAction(prev));
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
    startTransition(() => addItemAction(t, listId));
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
    startTransition(() => moveItemAction(id, toList));
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
    const canCapture = snapshot === null && !captureOpen;
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

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setActiveId(id);
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
    setActiveId(null);
    if (!over) return;

    if (type === "column") {
      const oldI = listOrder.indexOf(String(active.id));
      const newI = listOrder.indexOf(String(over.id));
      if (oldI >= 0 && newI >= 0 && oldI !== newI) {
        const nextOrder = arrayMove(listOrder, oldI, newI);
        setListOrder(nextOrder);
        reorderListsAction(nextOrder);
      }
      return;
    }

    const draggedId = String(active.id);
    const overId = String(over.id);

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
      pushUndo(dragOriginRef.current, `Moved ${block.length} cards`);
      startTransition(() =>
        reorderItemsAction(
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
      pushUndo(dragOriginRef.current, "Moved card");
    }
    startTransition(() => reorderItemAction(String(active.id), list, pos));
  }

  return (
    <>
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
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
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

      {columnError && (
        <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--veil)] bg-[var(--bg-1)] py-2 pl-4 pr-2 shadow-2xl">
          <span className="text-sm text-[var(--text-mid)]">{columnError}</span>
          <button
            onClick={() => setColumnError(null)}
            className="rounded-full px-3 py-1 text-xs text-[var(--text-lo)] hover:bg-[var(--surface-2)] hover:text-[var(--text-hi)]"
          >
            Dismiss
          </button>
        </div>
      )}

      {!snapshot && !captureOpen && selection.size === 0 && (
        <button
          onClick={() => setCaptureOpen(true)}
          title="Quick capture to Brain Dump · c"
          aria-label="Quick capture to Brain Dump"
          className="fixed bottom-5 right-5 z-40 flex h-11 items-center gap-2 rounded-full border border-[var(--veil)] bg-[var(--bg-1)] pl-3.5 pr-4 text-sm text-[var(--text-mid)] shadow-2xl transition-colors hover:text-[var(--text-hi)]"
        >
          <span className="text-[var(--now)]" aria-hidden>
            ＋
          </span>
          Capture
          <kbd className="hidden font-grotesk text-[11px] text-[var(--text-lo)] sm:inline">
            c
          </kbd>
        </button>
      )}

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
    </>
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
