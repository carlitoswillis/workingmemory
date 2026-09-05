import { getItems } from "@/lib/queries";
import { ensureLists, getLists, getListLabels } from "@/lib/columns";
import { getBoardContext, getMainDb, isDemoRequest } from "@/lib/db";
import { getUsername } from "@/lib/users";
import { getUserBoards, getBoardName, getBoardMembers, getMemberUsernames } from "@/lib/boards";
import { getDoorwayMeta } from "@/lib/doorways";
import Board from "@/components/Board";
import PhoneShell from "@/components/phone/PhoneShell";
import ArchiveView from "@/components/ArchiveView";
import ThemeToggle from "@/components/ThemeToggle";
import BoardSwitcher from "@/components/BoardSwitcher";

// The board for the current request. Rendered at "/" (the signed-in user's personal
// board, local mode, or a demo visitor's throwaway DB) and at "/b/[boardId]" for any
// other board the user is a member of. `boardId` comes from the /b/ route; omit it
// for "/". getBoardContext verifies membership (404s a non-member) and resolves the
// scope; everything below is scoped to that board.
export default function BoardScreen({
  boardId,
  openCardId,
}: {
  boardId?: string;
  // ?card=<id> — how "view original" reaches an archived card on ANOTHER board
  // across a promote/demote seam. The panel opens on it once, on arrival.
  openCardId?: string;
}) {
  const { db, userId, boardId: bid } = getBoardContext(boardId);
  // Seed the five default columns on a board's first render (idempotent), then read
  // the live columns + a label map (incl. deleted columns) for history/archive views.
  ensureLists(db, bid);
  const items = getItems(db, bid);
  const lists = getLists(db, bid);
  const listLabels = getListLabels(db, bid);
  const demo = isDemoRequest();

  // Account context: the switcher (boards you belong to), this board's name +
  // members, and an actor_id -> username map so history can say who did what.
  const main = userId ? getMainDb() : null;
  const username = userId ? getUsername(main!, userId) : null;
  const boards = userId ? getUserBoards(main!, userId) : [];
  const boardName = userId && bid ? getBoardName(main!, bid) : null;
  const members = userId && bid ? getBoardMembers(main!, bid) : [];
  const myRole = members.find((m) => m.userId === userId)?.role ?? null;
  const actors = userId && bid ? getMemberUsernames(main!, bid) : {};

  // Doorways: for each distinct board a card on this page opens into, resolve its
  // name + live open count — but ONLY for boards this viewer is a member of. Cards
  // pointing anywhere else come back absent from the map, and render as a neutral
  // "Linked board" chip that says nothing and goes nowhere. One query per distinct
  // linked board; a board has few doorways. Local + demo have no boards at all.
  const linkedIds = [...new Set(items.map((i) => i.linked_board_id).filter(Boolean))] as string[];
  const doorways = main && userId ? getDoorwayMeta(main, userId, linkedIds) : {};

  // TWO SHELLS, ONE BRANCH. The phone app (components/phone/) is not this layout at
  // 375px — it is its own instrument: one Now feed plus a paged Lists screen, rows
  // instead of columns, everything in the thumb zone. Both trees are rendered and CSS
  // picks between them at 768px (the `/* phone shell */` block in globals.css), so
  // there is no measure-then-render, no hydration flash, and a headless check can
  // assert which one is live by viewport width alone. Both read the SAME server data
  // resolved above — no second query, no second data layer.
  return (
    <>
      <div data-shell="desktop">
    <main className="mx-auto max-w-[1640px] px-6 py-10 sm:px-10">
      {demo && (
        <div
          className="mb-6 flex items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm"
          style={{
            borderColor: "var(--veil)",
            background: "var(--surface)",
            color: "var(--text-lo)",
          }}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: "var(--past)" }}
            aria-hidden
          />
          <p>
            This is a <span className="text-[var(--text-mid)]">demo board</span> — yours
            alone, pre-loaded with three weeks of history so the{" "}
            <span className="text-[var(--text-mid)]">time machine</span> has a past to
            scrub through. Edit anything; it resets after a day of inactivity.{" "}
            <a href="/signup" className="underline text-[var(--text-mid)]">
              Create an account
            </a>{" "}
            to keep a board of your own.
          </p>
        </div>
      )}
      <header className="mb-9 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--now)" }}
              aria-hidden
            />
            <h1 className="font-display text-3xl font-medium leading-none tracking-tight text-[var(--text-hi)]">
              Working Memory
            </h1>
          </div>
          <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-[var(--text-lo)]">
            What&apos;s on your mind now —{" "}
            <span className="font-display italic text-[var(--text-mid)]">
              and everything it used to be.
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {userId && bid && (
            <BoardSwitcher
              boardId={bid}
              boardName={boardName ?? "Board"}
              boards={boards}
              members={members}
              myRole={myRole}
              me={userId}
            />
          )}
          {username && (
            <a
              href="/login"
              className="rounded-full border px-3 py-1 text-xs"
              style={{
                borderColor: "var(--veil)",
                background: "var(--surface)",
                color: "var(--text-lo)",
              }}
              title="Your account"
            >
              @{username}
            </a>
          )}
          <ArchiveView boardId={bid} listLabels={listLabels} />
          <ThemeToggle />
        </div>
      </header>

      <Board
        boardId={bid}
        lists={lists}
        listLabels={listLabels}
        actors={actors}
        items={items}
        doorways={doorways}
        myBoards={boards.map((b) => ({ id: b.id, name: b.name }))}
        openCardId={openCardId}
      />
    </main>
      </div>

      <PhoneShell
        boardId={bid}
        boardName={boardName}
        lists={lists}
        listLabels={listLabels}
        items={items}
        actors={actors}
        doorways={doorways}
        myBoards={boards.map((b) => ({ id: b.id, name: b.name }))}
      />
    </>
  );
}
