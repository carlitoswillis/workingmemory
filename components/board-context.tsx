"use client";

import { createContext, useContext } from "react";

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
