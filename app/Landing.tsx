// The front door of the hosted instance — what an anonymous visitor sees at "/".
// Signed-in accounts and local mode never render this (they get the board).
// Static server component: no client JS, no DB touched (so landing visitors
// don't spawn throwaway demo files — a board is only created if they enter /demo).

// One card's life, told in the app's own visual grammar: cool past events
// (CardPanel-timeline style) flowing into the warm "now" card. This is the
// actual data model — items + an append-only item_events trail — not an
// illustration of it.
const TRAIL: { label: React.ReactNode; when: string }[] = [
  {
    label: (
      <>
        created in <span className="text-[var(--text-mid)]">Brain Dump</span>
      </>
    ),
    when: "3 weeks ago",
  },
  {
    label: (
      <>
        moved to <span className="text-[var(--text-mid)]">Waiting on</span>
      </>
    ),
    when: "2 weeks ago",
  },
  {
    label: (
      <>
        details edited — <span className="font-display italic text-[var(--text-mid)]">&ldquo;appointment Tue 9:40, bring the old photo&rdquo;</span>
      </>
    ),
    when: "4 days ago",
  },
  {
    label: (
      <>
        moved to <span className="text-[var(--text-mid)]">Today</span>
      </>
    ),
    when: "this morning",
  },
];

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10 sm:px-10">
      {/* Top bar: wordmark + quiet sign-in */}
      <nav className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--now)" }}
            aria-hidden
          />
          <span className="font-display text-lg font-medium tracking-tight text-[var(--text-hi)]">
            Working Memory
          </span>
        </div>
        <a
          href="/login"
          className="rounded-full border px-3.5 py-1.5 text-xs transition-opacity hover:opacity-80"
          style={{
            borderColor: "var(--veil)",
            background: "var(--surface)",
            color: "var(--text-mid)",
          }}
        >
          Sign in
        </a>
      </nav>

      {/* Hero */}
      <section className="grid flex-1 content-center gap-14 py-16 md:grid-cols-[1.1fr_1fr] md:gap-10 md:py-20">
        <div className="max-w-xl self-center">
          <h1 className="font-display text-4xl font-medium leading-[1.12] tracking-tight text-[var(--text-hi)] sm:text-[2.9rem]">
            What&apos;s on your mind now —{" "}
            <span className="italic text-[var(--past)]">
              and everything it used to be.
            </span>
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-[var(--text-lo)]">
            A board of lists — Today, Focus, Waiting, Backlog, Brain Dump — where
            every edit, move, and check-off journals itself. Scrub the{" "}
            <span className="text-[var(--text-mid)]">🕰 time machine</span> back and
            see exactly what had your attention three weeks ago.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href="/demo"
              className="rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
              style={{ background: "var(--now)", color: "var(--bg-0)" }}
            >
              Try the live demo
            </a>
            <a
              href="/signup"
              className="rounded-lg border px-5 py-2.5 text-sm transition-opacity hover:opacity-80"
              style={{
                borderColor: "var(--veil)",
                background: "var(--surface)",
                color: "var(--text-mid)",
              }}
            >
              Create an account
            </a>
          </div>
          <p className="mt-3 text-xs text-[var(--text-lo)]">
            No signup for the demo — a board of your own, pre-loaded with three weeks
            of history to time-travel through.
          </p>
        </div>

        {/* Signature: one card's history trail, ending in the live card. */}
        <figure className="self-center" aria-label="A card's change history, ending in its current state">
          <div
            className="rounded-xl border p-5"
            style={{ borderColor: "var(--veil-soft)", background: "var(--bg-1)" }}
          >
            <ol className="relative ml-1.5 border-l pl-4" style={{ borderColor: "var(--veil)" }}>
              {TRAIL.map((e, i) => (
                <li
                  key={i}
                  className="card-in relative pb-4 text-[13px] leading-snug text-[var(--text-lo)]"
                  style={{ animationDelay: `${i * 0.12}s` }}
                >
                  <span
                    className="absolute -left-[21px] top-[5px] h-2 w-2 rounded-full border"
                    style={{ background: "var(--bg-1)", borderColor: "var(--past)" }}
                    aria-hidden
                  />
                  {e.label}
                  <span className="ml-1.5 text-[11px] text-[var(--past)]">{e.when}</span>
                </li>
              ))}
              {/* The card as it is now — the app's real resting-card anatomy. */}
              <li
                className="card-in relative"
                style={{ animationDelay: `${TRAIL.length * 0.12}s` }}
              >
                <span
                  className="absolute -left-[21px] top-[13px] h-2 w-2 rounded-full"
                  style={{ background: "var(--now)" }}
                  aria-hidden
                />
                <div
                  className="flex items-center gap-2.5 overflow-hidden rounded-lg border py-2.5 pr-3"
                  style={{ borderColor: "var(--veil)", background: "var(--surface)" }}
                >
                  <span
                    className="h-9 w-[3px] shrink-0 rounded-r"
                    style={{ background: "var(--now)" }}
                    aria-hidden
                  />
                  <span
                    className="h-[15px] w-[15px] shrink-0 rounded border"
                    style={{ borderColor: "var(--text-lo)" }}
                    aria-hidden
                  />
                  <span className="text-sm text-[var(--text-hi)]">Renew passport</span>
                  <span
                    className="ml-auto h-1 w-1 rounded-full"
                    style={{ background: "var(--past)" }}
                    title="has details"
                    aria-hidden
                  />
                </div>
              </li>
            </ol>
          </div>
          <figcaption className="mt-2.5 text-center text-xs text-[var(--text-lo)]">
            One card&apos;s history — written automatically, replayable any time.
          </figcaption>
        </figure>
      </section>

      {/* The three real differentiators, keyed to the palette's meanings. */}
      <section className="grid gap-8 border-t py-12 sm:grid-cols-3" style={{ borderColor: "var(--veil-soft)" }}>
        <div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--past)" }} aria-hidden />
            <h2 className="text-sm font-medium text-[var(--text-hi)]">The time machine</h2>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-lo)]">
            Drag the scrubber and the whole board reconstructs, read-only, exactly as
            it stood at any past moment — what was done, what was waiting, what you
            hadn&apos;t thought of yet.
          </p>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--now)" }} aria-hidden />
            <h2 className="text-sm font-medium text-[var(--text-hi)]">History writes itself</h2>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-lo)]">
            Every change is journaled by database triggers into an append-only event
            log. Nothing to remember to save, no versions to manage — the app
            can&apos;t forget.
          </p>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--done)" }} aria-hidden />
            <h2 className="text-sm font-medium text-[var(--text-hi)]">Yours, in one file</h2>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-lo)]">
            The whole thing is SQLite — daily notes, streaks, sub-cards, and all their
            history in one file. No telemetry, nothing sold, nothing mined.
          </p>
        </div>
      </section>

      <footer className="flex items-center justify-between border-t pt-6 pb-2 text-xs text-[var(--text-lo)]" style={{ borderColor: "var(--veil-soft)" }}>
        <span>
          Built in the open —{" "}
          <a
            href="https://github.com/carlitoswillis/workingmemory"
            className="underline text-[var(--text-mid)]"
            target="_blank"
            rel="noopener noreferrer"
          >
            source on GitHub
          </a>
        </span>
        <a href="/demo" className="underline text-[var(--text-mid)]">
          Open the demo
        </a>
      </footer>
    </main>
  );
}
