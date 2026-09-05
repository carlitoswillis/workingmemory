// STUB — replaced by package A
//
// The real PhoneShell (navigation, the Now feed, the Lists pager, the tab bar) is
// package A's file. This stub exists only so package B's sheets compile, type-check
// and can be exercised headlessly before the two halves merge. It implements exactly
// the interface frozen in spec §10 — the `PhoneSheet` / `PhoneUI` types and
// `usePhoneUI()` — and nothing else. At merge time A's version wins wholesale; the
// only thing B depends on is the contract below.

"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useKeyboardInset } from "./useKeyboardInset.ts";
import { PhoneSheetHost } from "./Sheet";

export type PhoneSheet =
  | { kind: "card"; itemId: string }
  | { kind: "capture"; listId?: string }
  | { kind: "search" }
  | { kind: "boards" }
  | { kind: "time" }
  | { kind: "review" }
  | { kind: "note" }
  | { kind: "more" };

export type PhoneUI = {
  tab: "now" | "lists" | "find" | "more";
  setTab(t: PhoneUI["tab"]): void;
  sheet: PhoneSheet | null;
  open(s: PhoneSheet): void;
  close(): void;
  listId: string | null; // active page in the Lists pager
  setListId(id: string): void;
  kbInset: number; // px, from visualViewport
};

const PhoneUIContext = createContext<PhoneUI | null>(null);

// Package B never constructs a PhoneUI in production — A's shell does. Reading the
// context outside a provider throws rather than silently no-opping, because a sheet
// that can't close is worse than a loud failure.
export const usePhoneUI: () => PhoneUI = () => {
  const ctx = useContext(PhoneUIContext);
  if (!ctx) throw new Error("usePhoneUI must be used inside <PhoneShell>");
  return ctx;
};

export function PhoneUIProvider({
  children,
  initialListId = null,
}: {
  children?: React.ReactNode;
  initialListId?: string | null;
}) {
  const [tab, setTab] = useState<PhoneUI["tab"]>("now");
  const [sheet, setSheet] = useState<PhoneSheet | null>(null);
  const [listId, setListId] = useState<string | null>(initialListId);
  const kbInset = useKeyboardInset();

  const value = useMemo<PhoneUI>(
    () => ({
      tab,
      setTab,
      sheet,
      open: setSheet,
      close: () => setSheet(null),
      listId,
      setListId,
      kbInset,
    }),
    [tab, sheet, listId, kbInset],
  );

  return <PhoneUIContext.Provider value={value}>{children}</PhoneUIContext.Provider>;
}

export default function PhoneShell({ children }: { children?: React.ReactNode }) {
  return (
    <PhoneUIProvider>
      {children}
      <PhoneSheetHost />
    </PhoneUIProvider>
  );
}
