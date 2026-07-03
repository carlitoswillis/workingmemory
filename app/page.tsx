import { getItems, getListOrder } from "@/lib/queries";
import { orderLists } from "@/lib/lists";
import { isDemoRequest } from "@/lib/db";
import Board from "@/components/Board";

// Local, single-user board; always read fresh from the SQLite file.
export const dynamic = "force-dynamic";

export default async function Home() {
  const items = getItems();
  const lists = orderLists(getListOrder());
  const demo = isDemoRequest();

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
            scrub through. Edit anything; it resets after a day of inactivity.
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
      </header>

      <Board lists={lists} items={items} />
    </main>
  );
}
