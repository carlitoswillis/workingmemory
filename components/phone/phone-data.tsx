"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Item } from "@/lib/types";
import type { ListDef } from "@/lib/lists";
import { NOTE_LIST, REVIEW_LIST, isSentinelList } from "@/lib/lists";
import { phoneBoardDataAction } from "@/app/actions";
import { useBoardId } from "../board-context";

// What the phone sheets read. Deliberately NOT a second data layer: these are the
// exact rows lib/queries.ts already hands the desktop board, and every derivation
// below (the note, the weekly review, a card's children) is the same predicate the
// desktop components use — just applied here instead of imported from them, because
// ReviewColumn/NoteColumn/CardPanel are off-limits to this package (spec §10).
//
// Two ways in, in this order:
//
//   1. <PhoneDataProvider> — the phone shell already has the board (it was rendered
//      with it) and hands it down. Nothing is fetched.
//   2. No provider — the sheets fetch the board themselves, once, through
//      phoneBoardDataAction. This is what makes package B correct standing alone,
//      before the shell exists to provide anything.
//
// Sheets should call `refresh()` after a mutation. Under a provider that's a no-op
// (the server action's own revalidatePath re-renders the tree that owns the data);
// under the fallback it's the refetch.

export type PhoneBoardData = {
  boardId: string | null;
  items: Item[];
  lists: ListDef[];
  listLabels: Record<string, string>;
  boards: { id: string; name: string }[];
  loading: boolean;
  refresh(): void;
};

export type PhoneBoardValue = Omit<PhoneBoardData, "loading" | "refresh">;

const PhoneDataContext = createContext<PhoneBoardValue | null>(null);

export function PhoneDataProvider({
  value,
  children,
}: {
  value: PhoneBoardValue;
  children: React.ReactNode;
}) {
  return <PhoneDataContext.Provider value={value}>{children}</PhoneDataContext.Provider>;
}

const EMPTY: PhoneBoardValue = {
  boardId: null,
  items: [],
  lists: [],
  listLabels: {},
  boards: [],
};

export function usePhoneBoardData(): PhoneBoardData {
  const provided = useContext(PhoneDataContext);
  const boardId = useBoardId();
  const [fetched, setFetched] = useState<PhoneBoardValue | null>(null);
  const [nonce, setNonce] = useState(0);

  // Hooks run unconditionally (rules of hooks); the effect simply does nothing when
  // a provider is supplying the data.
  useEffect(() => {
    if (provided) return;
    let alive = true;
    phoneBoardDataAction(boardId)
      .then((d) => alive && setFetched({ boardId, ...d }))
      .catch(() => alive && setFetched({ ...EMPTY, boardId }));
    return () => {
      alive = false;
    };
  }, [provided, boardId, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  if (provided) return { ...provided, loading: false, refresh };
  return { ...(fetched ?? { ...EMPTY, boardId }), loading: fetched === null, refresh };
}

// ---- derivations, shared by the sheets ------------------------------------------
// Same predicates Board.tsx uses to pick the note and the review out of `items`
// (one pinned, unarchived, top-level item per sentinel list), so the phone can
// never disagree with the desktop about which row is "the note".

export function findNote(items: Item[]): Item | null {
  return items.find((i) => i.list === NOTE_LIST && !i.archived && !i.parent_id) ?? null;
}

export function findReview(items: Item[]): Item | null {
  return items.find((i) => i.list === REVIEW_LIST && !i.archived && !i.parent_id) ?? null;
}

/** A card's direct children, in board order. Sub-cards never appear as board rows. */
export function childrenOf(items: Item[], parentId: string): Item[] {
  return items.filter((i) => i.parent_id === parentId && !i.archived);
}

/** The columns a card can actually be moved to — the note and the review aren't. */
export function movableLists(lists: ListDef[]): ListDef[] {
  return lists.filter((l) => !isSentinelList(l.id));
}

export function findItem(items: Item[], id: string | null | undefined): Item | null {
  if (!id) return null;
  return items.find((i) => i.id === id) ?? null;
}
