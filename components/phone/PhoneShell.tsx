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
import { PhoneDataProvider, type PhoneBoardValue } from "./phone-data";
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
  | { kind: "more" }
  | { kind: "archive" }
  | { kind: "lists" };

export type PhoneUI = {
  tab: "now" | "lists" | "find" | "more";
  setTab(t: PhoneUI["tab"]): void;
  sheet: PhoneSheet | null;
  open(s: PhoneSheet): void;
  close(): void;
  listId: string | null; // active page in the Lists pager
  setListId(id: string): void;
  kbInset: number; // px, from visualViewport
  // One browser history entry for one level of depth INSIDE the open sheet (a card
  // sheet drilled into a sub-card). `onPop` runs when the browser gives that entry
  // back — by the edge-swipe, the hardware back button, or goBackLevels() below.
  pushLevel(onPop: () => void): void;
  // Step back `n` of those levels. Always through the browser, so the gesture and the
  // in-sheet back arrow are one code path.
  goBackLevels(n: number): void;
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

  // ---- history ---------------------------------------------------------------
  // ONE owner for every history entry the phone app creates, so a back gesture has a
  // single handler and a single bookkeeper. Each entry we push is a LEVEL: level 1 is
  // "a sheet is open", levels 2+ are a card sheet drilled into a sub-card. Every level
  // carries the callback that undoes it, and the browser — never us — decides when
  // that callback runs.
  //
  // The level count lives in a REF and never in history.state. It has to: a server
  // action's revalidatePath makes Next's App Router call history.replaceState with
  // only its own router tree, so an entry we pushed can come back stateless at any
  // moment. Anything that read our depth out of the current entry would then conclude
  // "no sheet, depth 0" and unwind a stack the browser still holds — which is how one
  // sub-card tap used to leave an installed PWA on a dead entry until relaunch. We do
  // still TAG each entry (`wmPhoneLevel`), because the tag is the only way to know how
  // far a jump we did not issue travelled; when the tag has been wiped the count is
  // the answer, since a back gesture removes exactly one entry.
  const levelsRef = useRef<Array<() => void>>([]);
  // Where a history.go() WE issued is meant to land. Ours are the only jumps that can
  // cross more than one entry, so this is the whole of that ambiguity.
  const jumpRef = useRef<number | null>(null);

  const setTab = useCallback((t: PhoneUI["tab"]) => {
    if (t === "now" || t === "lists") baseTabRef.current = t;
    setTabState(t);
  }, []);

  // Count a level ONLY once the browser has actually taken the entry. pushState is
  // refusable — every engine rate-limits it (roughly 100 calls per half-minute, a
  // per-document budget Next's own router.replaceState spends out of too), and
  // restricted contexts throw outright. Counting first and pushing second would leave
  // the ref claiming an entry the session history does not hold, and since close() and
  // goToLevel() both measure their `history.go(-n)` off this array, the next back
  // gesture would travel one entry past the page the phone app opened on — the dead
  // entry this whole owner exists to prevent. So: push, then record.
  const pushLevel = useCallback((onPop: () => void) => {
    if (typeof window === "undefined") return;
    try {
      window.history.pushState(
        { ...window.history.state, wmPhoneLevel: levelsRef.current.length + 1 },
        "",
      );
    } catch {
      return; // history is best-effort; the sheet still opens, just without an entry
    }
    levelsRef.current = [...levelsRef.current, onPop];
  }, []);

  const goToLevel = useCallback((target: number) => {
    const back = levelsRef.current.length - target;
    if (back <= 0 || typeof window === "undefined") return;
    jumpRef.current = target;
    try {
      window.history.go(-back);
    } catch {
      jumpRef.current = null;
    }
  }, []);

  const goBackLevels = useCallback(
    (n: number) => goToLevel(Math.max(0, levelsRef.current.length - n)),
    [goToLevel],
  );

  // Forget the sheet WITHOUT touching history — what a popped level-1 entry means,
  // because the browser has already taken the entry back.
  const forgetSheet = useCallback(() => {
    setSheet(null);
    setTabState((prev) => (prev === "find" || prev === "more" ? baseTabRef.current : prev));
  }, []);

  const open = useCallback(
    (s: PhoneSheet) => {
      setSheet(s);
      // One entry for "a sheet is open", however often the sheet's KIND changes while
      // it is up (More → Note, Find → a card).
      if (levelsRef.current.length === 0) pushLevel(forgetSheet);
    },
    [pushLevel, forgetSheet],
  );

  // THE close path — the only one. A sheet that closes itself (Save, Archive, the
  // grip dragged down) lands here too, via Sheet's exit animation, so the entries are
  // given back exactly once.
  const close = useCallback(() => {
    setSheet(null);
    setTabState(baseTabRef.current);
    const n = levelsRef.current.length;
    if (n === 0 || typeof window === "undefined") return;
    // Drop the callbacks first: the sheet is already gone, so the entries the browser
    // is about to hand back have nothing left to undo.
    levelsRef.current = [];
    jumpRef.current = 0;
    try {
      window.history.go(-n);
    } catch {
      jumpRef.current = null;
    }
  }, []);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const jump = jumpRef.current;
      jumpRef.current = null;
      const depth = levelsRef.current.length;
      if (depth === 0) return; // not ours — Board.tsx or the router owns this one
      let target: number;
      if (jump !== null) {
        target = jump;
      } else {
        const tag = (e.state as { wmPhoneLevel?: number } | null)?.wmPhoneLevel;
        // A tag above our count is a FORWARD step into an entry we no longer stand
        // behind; leave the stack alone rather than popping a level for it.
        target = typeof tag === "number" ? Math.max(0, Math.min(tag, depth)) : depth - 1;
      }
      while (levelsRef.current.length > target) {
        const undo = levelsRef.current[levelsRef.current.length - 1];
        levelsRef.current = levelsRef.current.slice(0, -1);
        undo();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const ui = useMemo<PhoneUI>(
    () => ({
      tab,
      setTab,
      sheet,
      open,
      close,
      listId,
      setListId,
      kbInset,
      pushLevel,
      goBackLevels,
    }),
    [tab, setTab, sheet, open, close, listId, kbInset, pushLevel, goBackLevels],
  );

  const boardData = useMemo(
    () => ({ boardId, boardName, lists, listLabels, items, actors }),
    [boardId, boardName, lists, listLabels, items, actors],
  );

  // What every sheet reads (components/phone/phone-data.tsx). Derived from THIS
  // render's props and never snapshotted, so a router.refresh() — a server action's
  // revalidate, or the SSE poke Board.tsx debounces — reaches a sheet that is already
  // open. Without this the sheets took phone-data's standalone branch and refetched
  // the whole board on every open, which is why a card sheet first rendered "That card
  // isn't on the board any more".
  const phoneData = useMemo<PhoneBoardValue>(
    () => ({ boardId, items, lists: [...lists], listLabels, boards: myBoards }),
    [boardId, items, lists, listLabels, myBoards],
  );

  // Find/More sit over the screen you were on, so the content behind a sheet is the
  // last board tab, not a fifth blank page.
  const screen = tab === "now" || tab === "lists" ? tab : baseTabRef.current;
  const today = localToday();

  return (
    <BoardIdProvider value={boardId}>
      <DoorwaysProvider doorways={doorways} myBoards={myBoards}>
        <BoardDataProvider value={boardData}>
          <PhoneDataProvider value={phoneData}>
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
          </PhoneDataProvider>
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
