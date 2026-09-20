"use client";

import dynamic from "next/dynamic";
import type { Item } from "@/lib/types";
import { useBoardId } from "./board-context";
import { reviewWeekLabel, useCollapsibleColumn } from "./collapsibleColumn";

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

function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="14"
      height="14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`wm-collapsible-chevron mt-[3px] shrink-0 text-[var(--text-lo)] ${
        collapsed ? "is-collapsed" : ""
      }`}
    >
      <path d="M6 8l4 4 4-4" />
    </svg>
  );
}

export default function ReviewColumn({ review }: { review: Item | null }) {
  const boardId = useBoardId();
  const { collapsed, toggle } = useCollapsibleColumn(boardId, "review");
  const body = review?.details?.trim() ?? "";

  if (!review || !body) return null;

  const weekLabel = reviewWeekLabel(review.updated_at);
  // One string collapsed and expanded: the week is stated once, in the caption,
  // and never again inside the review (the verdict carries no date).
  const subtitle = weekLabel;

  return (
    <section
      className={`flex flex-col rounded-2xl border border-[var(--veil-soft)] bg-[var(--wash)] p-3 lg:!max-w-[300px] ${
        collapsed ? "" : "min-h-[220px]"
      }`}
      style={{ borderLeft: "2px solid var(--past)" }}
    >
      <div className="mb-3 flex items-start justify-between gap-2 px-1.5 pt-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          /* The chevron hangs in the card's own 12px gutter (-ml-[18px] = chevron
             14 + gap 4), so "Weekly review", the week caption and the verdict
             below them share ONE left edge instead of the title sitting 20px
             right of its own hero. It also puts the live column's head exactly
             where the time-machine twin's head already is (no chevron there). */
          className="-ml-[18px] flex min-w-0 items-start gap-1 rounded text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--now)]"
        >
          <Chevron collapsed={collapsed} />
          <span className="min-w-0">
            <h2 className="font-display text-[15px] font-medium tracking-tight text-[var(--text-hi)]">
              Weekly review
            </h2>
            <p className="mt-0.5 truncate text-[11px] leading-tight text-[var(--text-lo)]">
              {subtitle}
            </p>
          </span>
        </button>
      </div>

      <div
        className={`wm-collapsible flex-1 ${collapsed ? "is-collapsed" : ""}`}
        aria-hidden={collapsed}
      >
        <div className="wm-collapsible__inner flex h-full flex-col">
          <div className="max-h-[70vh] flex-1 overflow-y-auto px-1.5 text-[var(--text-hi)]">
            <Markdown source={body} className="md-body--review" />
          </div>
        </div>
      </div>
    </section>
  );
}
