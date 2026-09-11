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
import { useLevelStack } from "../useLevelStack";
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

/**
 * How `open()` treats a sheet that is already up.
 *
 * By default a different KIND replaces it: PhoneSheetHost keys each sheet on its kind,
 * so the outgoing sheet unmounts, and the levels it pushed are given back with it.
 *
 * `asLevel` stacks the new sheet ON TOP instead — one more history level, whose undo
 * puts the outgoing sheet back. That is what makes a card opened from the Archive a
 * step INTO the archive rather than a step past it: one back gesture returns to the
 * archive list, a second closes it.
 */
export type OpenOptions = { asLevel?: boolean };

export type PhoneUI = {
  tab: "now" | "lists" | "find" | "more";
  setTab(t: PhoneUI["tab"]): void;
  sheet: PhoneSheet | null;
  open(s: PhoneSheet, opts?: OpenOptions): void;
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
  // Every history entry the phone app pushes is a LEVEL on one stack: level 1 is "a
  // sheet is open", levels 2+ are a sheet that has drilled deeper (a card sheet inside
  // a sub-card, a snapshot opened from Time travel, a card opened from the Archive).
  // The stack — the push, the tag, the single popstate handler, and the rule that the
  // count lives in a ref rather than in history.state — is `useLevelStack`, shared with
  // the desktop panel in components/Board.tsx. Read the why there.
  const { pushLevel, goBackLevels, dropLevels, depth } = useLevelStack("wmPhoneLevel");

  const setTab = useCallback((t: PhoneUI["tab"]) => {
    if (t === "now" || t === "lists") baseTabRef.current = t;
    setTabState(t);
  }, []);

  // Forget the sheet WITHOUT touching history — what a popped level-1 entry means,
  // because the browser has already taken the entry back.
  const forgetSheet = useCallback(() => {
    setSheet(null);
    setTabState((prev) => (prev === "find" || prev === "more" ? baseTabRef.current : prev));
  }, []);

  // What is on screen right now, readable from a callback the browser runs. `sheet`
  // itself is state, and every caller of open() below is either an event handler or a
  // level's undo — both of which run after the render that set it.
  const sheetRef = useRef<PhoneSheet | null>(null);
  sheetRef.current = sheet;

  const open = useCallback(
    (s: PhoneSheet, opts?: OpenOptions) => {
      const cur = sheetRef.current;
      setSheet(s);

      // Nothing up yet: one entry for "a sheet is open".
      if (!cur || depth() === 0) {
        if (depth() === 0) pushLevel(forgetSheet);
        return;
      }

      // Stacked deliberately on top of what is up (the Archive opening a card): one
      // more level, whose undo puts the outgoing sheet back.
      if (opts?.asLevel) {
        pushLevel(() => setSheet(cur));
        return;
      }

      // Same kind, new subject (the card sheet drilling into a sub-card). The sheet
      // stays mounted — PhoneSheetHost keys on the kind — and owns those levels
      // itself, so the stack is none of our business here.
      if (cur.kind === s.kind) return;

      // A different KIND replaces what is up (More → Note, a card → Find). The
      // outgoing sheet unmounts, so the levels it pushed are now callbacks that would
      // reopen a sheet the user has left: a back gesture from Find used to reopen the
      // card you had drilled into. Give those entries back — without running their
      // undos, since what they would restore is already gone — so the incoming sheet
      // stands on the base level and ONE back gesture closes it.
      dropLevels(1);
    },
    [pushLevel, dropLevels, depth, forgetSheet],
  );

  // THE close path — the only one. A sheet that closes itself (Save, Archive, the
  // grip dragged down) lands here too, via Sheet's exit animation, so the entries are
  // given back exactly once, in one jump.
  const close = useCallback(() => {
    setSheet(null);
    setTabState(baseTabRef.current);
    dropLevels(0);
  }, [dropLevels]);

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
