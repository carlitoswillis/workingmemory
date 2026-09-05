"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "@/lib/types";
import type { ListDef } from "@/lib/lists";
import {
  BoardDataProvider,
  BoardIdProvider,
  DoorwaysProvider,
  type BoardOption,
  type DoorwayInfo,
} from "../board-context";
import { localToday } from "@/lib/recurrence";
import { pagerLists } from "./phone-logic";
import PhoneHome from "./PhoneHome";
import PhoneList from "./PhoneList";
import PhoneTabs from "./PhoneTabs";
import { PhoneSheetHost } from "./Sheet";
import { useKeyboardInset } from "./useKeyboardInset";

// The phone app's root. It is NOT the desktop board at 375px: the five columns
// become one Now feed plus one paged Lists screen, and everything you actually reach
// for lives in the bottom third (Hoober's thumb zone). Rendered as a sibling of the
// desktop tree from app/BoardScreen.tsx; a CSS switch at 768px picks one, so there
// is no measure-then-render and no hydration flash.
//
// This file owns navigation and *sheet intent* only — which sheet should be open, not
// what it looks like. `Sheet.tsx` (package B) reads that intent through usePhoneUI()
// and renders the surface. That split is the whole interface between the two halves.

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

export const usePhoneUI = (): PhoneUI => {
  const ui = useContext(PhoneUIContext);
  if (!ui) throw new Error("usePhoneUI() must be called inside <PhoneShell>");
  return ui;
};

export default function PhoneShell({
  boardId,
  boardName,
  lists,
  listLabels,
  items,
  actors,
  doorways,
  myBoards,
}: {
  boardId: string | null;
  boardName: string | null;
  lists: readonly ListDef[];
  listLabels: Record<string, string>;
  items: Item[];
  actors: Record<string, string>;
  doorways: Record<string, DoorwayInfo>;
  myBoards: BoardOption[];
}) {
  const [tab, setTabState] = useState<PhoneUI["tab"]>("now");
  const [sheet, setSheet] = useState<PhoneSheet | null>(null);
  // Which board tab is *behind* a sheet. Find and More are sheets over a screen, not
  // screens of their own, so closing one puts you back where you were rather than on
  // a blank fifth page.
  const baseTabRef = useRef<"now" | "lists">("now");

  // The Today column owns Now's top section, so the pager is every OTHER column.
  const todayListId = useMemo(
    () => lists.find((l) => l.id === "today")?.id ?? lists[0]?.id ?? "today",
    [lists],
  );
  const pages = useMemo(() => pagerLists(lists, todayListId), [lists, todayListId]);
  // Where a row's "Later" parks a card: the Waiting column when the board has one.
  const snoozeListId = useMemo(
    () => lists.find((l) => l.id === "waiting")?.id ?? null,
    [lists],
  );
  const [listId, setListId] = useState<string | null>(null);
  useEffect(() => {
    // Keep the active page real across a column rename/delete on another device.
    setListId((prev) => (prev && pages.some((p) => p.id === prev) ? prev : pages[0]?.id ?? null));
  }, [pages]);

  // One subscription for the whole app. The hook publishes --kb, --vvh and --vvh-top
  // on documentElement (NOT on the shell div — Vaul portals sheets to <body>, where a
  // variable scoped to the shell cannot be seen) and returns the keyboard inset for
  // the React side.
  const kbInset = useKeyboardInset();

  // A sheet is one history entry deep, so the iOS edge-swipe (and Android back)
  // dismisses it instead of leaving the app — the same rule Board.tsx's panel depth
  // follows on desktop. history.state is spread, never replaced, so Next's router
  // keeps its own bookkeeping.
  const pushedRef = useRef(false);

  const setTab = useCallback((t: PhoneUI["tab"]) => {
    if (t === "now" || t === "lists") baseTabRef.current = t;
    setTabState(t);
  }, []);

  const open = useCallback((s: PhoneSheet) => {
    setSheet(s);
    if (!pushedRef.current && typeof window !== "undefined") {
      try {
        window.history.pushState({ ...window.history.state, wmSheet: true }, "");
        pushedRef.current = true;
      } catch {
        /* history is best-effort; the sheet still opens */
      }
    }
  }, []);

  const close = useCallback(() => {
    setSheet(null);
    setTabState(baseTabRef.current);
    if (pushedRef.current && typeof window !== "undefined") {
      pushedRef.current = false;
      try {
        window.history.back();
      } catch {
        /* no-op */
      }
    }
  }, []);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const state = e.state as { wmSheet?: boolean } | null;
      if (!state?.wmSheet) {
        pushedRef.current = false;
        setSheet(null);
        setTabState((prev) => (prev === "find" || prev === "more" ? baseTabRef.current : prev));
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const ui = useMemo<PhoneUI>(
    () => ({ tab, setTab, sheet, open, close, listId, setListId, kbInset }),
    [tab, setTab, sheet, open, close, listId, kbInset],
  );

  const boardData = useMemo(
    () => ({ boardId, boardName, lists, listLabels, items, actors }),
    [boardId, boardName, lists, listLabels, items, actors],
  );

  // Find/More sit over the screen you were on, so the content behind a sheet is the
  // last board tab, not a fifth blank page.
  const screen = tab === "now" || tab === "lists" ? tab : baseTabRef.current;
  const today = localToday();

  return (
    <BoardIdProvider value={boardId}>
      <DoorwaysProvider doorways={doorways} myBoards={myBoards}>
        <BoardDataProvider value={boardData}>
          <PhoneUIContext.Provider value={ui}>
            <div data-shell="phone" className="phone-shell">
              {/* Orientation only — nothing here is a target you have to reach. */}
              <header className="phone-topbar">
                <p className="phone-eyebrow" suppressHydrationWarning>
                  {longDate(today)}
                </p>
                <h1 className="phone-title">{screen === "now" ? "Now" : "Lists"}</h1>
              </header>

              <main className="phone-content">
                {screen === "now" ? (
                  <PhoneHome
                    items={items}
                    todayListId={todayListId}
                    today={today}
                    snoozeListId={snoozeListId}
                  />
                ) : (
                  <PhoneList items={items} pages={pages} snoozeListId={snoozeListId} />
                )}
              </main>

              <PhoneTabs />
              <PhoneSheetHost />
            </div>
          </PhoneUIContext.Provider>
        </BoardDataProvider>
      </DoorwaysProvider>
    </BoardIdProvider>
  );
}

// "Friday 4 September" — the one piece of orientation the top of the screen owes you.
// Built from the YYYY-MM-DD parts (never Date.parse of a bare date, which is UTC).
function longDate(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}
