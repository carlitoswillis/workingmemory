import { getItems, getListOrder } from "@/lib/queries";
import { orderLists } from "@/lib/lists";
import Board from "@/components/Board";

// Local, single-user board; always read fresh from the SQLite file.
export const dynamic = "force-dynamic";

export default async function Home() {
  const items = getItems();
  const lists = orderLists(getListOrder());

  return (
    <main className="mx-auto max-w-[1640px] px-6 py-10 sm:px-10">
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
