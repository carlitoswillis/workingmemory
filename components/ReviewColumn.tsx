"use client";

import dynamic from "next/dynamic";
import type { Item } from "@/lib/types";

// The AI weekly review: a read-only slot beside the Note. Its body lives in the
// item's `details`, exactly like the note, so every regeneration is journaled by
// the same trigger and the time machine is the archive of past reviews.
//
// Read-only on purpose. Nothing in the app writes this — the review is generated
// off-box (scripts/weekly-review.mjs) and arrives through POST /api/review, so
// there is no key, no model dependency, and no generate button in the hosted app.
// With no review yet, this renders NOTHING: an empty slot would be a permanent
// hole in the rail on every board that has never run the generator.
const Markdown = dynamic(() => import("./Markdown"), {
  ssr: true,
  loading: () => <span className="text-sm text-[var(--text-lo)]">rendering…</span>,
});

// "Aug 30" / "Aug 30, 2025" — the generation date, not a live clock.
function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export default function ReviewColumn({ review }: { review: Item | null }) {
  const body = review?.details?.trim() ?? "";
  if (!review || !body) return null;

  const when = whenLabel(review.updated_at);

  return (
    <section
      className="flex min-h-[220px] flex-col rounded-2xl border border-[var(--veil-soft)] bg-[var(--wash)] p-3 lg:!max-w-[300px]"
      style={{ borderLeft: "2px solid var(--past)" }}
    >
      <div className="mb-3 flex items-start justify-between gap-2 px-1.5 pt-1">
        <div>
          <h2 className="font-display text-[15px] font-medium tracking-tight text-[var(--text-hi)]">
            Weekly review
          </h2>
          <p className="mt-0.5 text-[11px] leading-tight text-[var(--text-lo)]">
            {when ? `Written from your history · ${when}` : "Written from your history"}
          </p>
        </div>
      </div>

      <div className="max-h-[70vh] flex-1 overflow-y-auto rounded-lg border border-[var(--veil-soft)] bg-[var(--bg-0)] px-3 py-2.5 text-sm leading-relaxed text-[var(--text-hi)]">
        <Markdown source={body} />
      </div>
    </section>
  );
}
