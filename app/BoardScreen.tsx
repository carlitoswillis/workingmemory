import { getItems } from "@/lib/queries";
import { ensureLists, getLists, getListLabels } from "@/lib/columns";
import { getBoardContext, getMainDb, isDemoRequest } from "@/lib/db";
import { getUsername } from "@/lib/users";
import { getUserBoards, getBoardName, getBoardMembers, getMemberUsernames } from "@/lib/boards";
import Board from "@/components/Board";
import ArchiveView from "@/components/ArchiveView";
import ThemeToggle from "@/components/ThemeToggle";
import BoardSwitcher from "@/components/BoardSwitcher";

// The board for the current request. Rendered at "/" (the signed-in user's personal
// board, local mode, or a demo visitor's throwaway DB) and at "/b/[boardId]" for any
// other board the user is a member of. `boardId` comes from the /b/ route; omit it
// for "/". getBoardContext verifies membership (404s a non-member) and resolves the
// scope; everything below is scoped to that board.
export default function BoardScreen({ boardId }: { boardId?: string }) {
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

  return (
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
      <header className="mb-9 flex items-end justify-between gap-4">
        <div>
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
        <div className="flex items-center gap-3">
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
      />
    </main>
  );
}
