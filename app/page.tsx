import { getItems, getListOrder } from "@/lib/queries";
import { orderLists } from "@/lib/lists";
import { getBoardContext, getMainDb, isDemoRequest } from "@/lib/db";
import { getUsername } from "@/lib/users";
import Board from "@/components/Board";
import ArchiveView from "@/components/ArchiveView";

// The board for the current request (local file, account rows, or a demo
// visitor's throwaway DB — lib/db.ts decides); always read fresh from SQLite.
export const dynamic = "force-dynamic";

export default async function Home() {
  const { db, userId } = getBoardContext();
  const items = getItems(db, userId);
  const lists = orderLists(getListOrder(db, userId));
  const demo = isDemoRequest();
  const username = userId ? getUsername(getMainDb(), userId) : null;

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
            <span className="text-[var(--text-mid)]">🕰 time machine</span> has a past to
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
          <ArchiveView />
        </div>
      </header>

      <Board lists={lists} items={items} />
    </main>
  );
}
