"use client";

import { createContext, useContext } from "react";
import type { ListDef } from "@/lib/lists";
import type { Item } from "@/lib/types";

// The board the client is currently viewing, provided once by <Board> and read by
// any descendant that fires a server action (ItemCard, CardPanel, QuickCapture,
// NoteColumn). Every action takes this boardId so the server can verify membership
// and scope the write — passing it explicitly (over a "current board" cookie) is
// what keeps two tabs on two boards honest. Null off the hosted instance (local +
// demo), where the whole file is the board.
const BoardIdContext = createContext<string | null>(null);

export function BoardIdProvider({
  value,
  children,
}: {
  value: string | null;
  children: React.ReactNode;
}) {
  return <BoardIdContext.Provider value={value}>{children}</BoardIdContext.Provider>;
}

export function useBoardId(): string | null {
  return useContext(BoardIdContext);
}

// Card ↔ board doorways. Both halves are server-resolved and handed down once by
// <Board>, rather than drilled through Column/SortableItemCard, because the two
// consumers sit at opposite ends of the tree (a card's chip, and the panel's picker).
//
//  - `doorways`: linked board id -> { name, open }, ONLY for boards this viewer is a
//    member of (lib/doorways.ts#getDoorwayMeta). A card whose linked_board_id is
//    missing from this map draws the neutral, inert "Linked board" chip — no name,
//    no count, no navigation. That absence IS the non-member rendering.
//  - `myBoards`: the boards the viewer belongs to, for the "Opens board" picker.
//    Empty in local + demo mode, where the picker doesn't render at all.
export type DoorwayInfo = { name: string; open: number };
export type BoardOption = { id: string; name: string };

const DoorwaysContext = createContext<{
  doorways: Record<string, DoorwayInfo>;
  myBoards: BoardOption[];
}>({ doorways: {}, myBoards: [] });

export function DoorwaysProvider({
  doorways,
  myBoards,
  children,
}: {
  doorways: Record<string, DoorwayInfo>;
  myBoards: BoardOption[];
  children: React.ReactNode;
}) {
  return (
    <DoorwaysContext.Provider value={{ doorways, myBoards }}>
      {children}
    </DoorwaysContext.Provider>
  );
}

export function useDoorways() {
  return useContext(DoorwaysContext);
}

// The board itself, as data. The phone app (components/phone/) is a SIBLING of
// <Board>, not a descendant — one branch point in app/BoardScreen.tsx renders both
// shells and CSS picks — so it can't read Board's internal state, and the phone
// sheets sit several levels below the shell. One provider, the same server-resolved
// props the desktop tree already receives, so phone rows and sheets derive from the
// same items with no second data layer.
export type BoardData = {
  boardId: string | null;
  boardName: string | null;
  lists: readonly ListDef[];
  listLabels: Record<string, string>;
  items: Item[];
  actors: Record<string, string>;
};

const BoardDataContext = createContext<BoardData | null>(null);

export function BoardDataProvider({
  value,
  children,
}: {
  value: BoardData;
  children: React.ReactNode;
}) {
  return <BoardDataContext.Provider value={value}>{children}</BoardDataContext.Provider>;
}

export function useBoardData(): BoardData | null {
  return useContext(BoardDataContext);
}
