"use client";

import dynamic from "next/dynamic";
import { usePhoneUI } from "./PhoneShell";
import { Sheet, useSheetOpen } from "./Sheet";
import { findReview, usePhoneBoardData } from "./phone-data";

// The AI weekly review, on the phone. Its own component reading the same row the
// desktop ReviewColumn reads — the one pinned, unarchived, top-level item on the
// `review` sentinel list, body in `details` — rather than importing that file, which
// belongs to another worktree (§10).
//
// Read-only, like the desktop one, and for the same reason: nothing in this app
// generates a review. It's produced off-box by scripts/weekly-review.mjs and arrives
// through POST /api/review, so there is no key, no model dependency, and no generate
// button to put here. With no review yet this says so — a phone screen can afford one
// honest sentence where a desktop column could only afford a permanent empty hole.
//
// Markdown is the same shared renderer the note and the card panels use, code-split
// out of the initial phone JS.

const Markdown = dynamic(() => import("../Markdown"), {
  ssr: true,
  loading: () => <span className="wm-ph-hint">rendering…</span>,
});

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

export default function PhoneReview() {
  const { close } = usePhoneUI();
  const { open } = useSheetOpen();
  const { items, loading } = usePhoneBoardData();
  const review = findReview(items);
  const body = review?.details?.trim() ?? "";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()} label="Weekly review" heightSvh={96}>
      <div className="wm-sheet__head" style={{ flexDirection: "column", gap: 2 }}>
        <p className="wm-ph-title">Weekly review</p>
        <p className="wm-ph-caption">
          {review && body
            ? `Written from your history · ${whenLabel(review.updated_at)}`
            : "Written from your history"}
        </p>
      </div>

      <div className="wm-sheet__scroll">
        {body ? (
          <div className="wm-ph-card">
            <Markdown source={body} />
          </div>
        ) : (
          <p className="wm-ph-hint">
            {loading
              ? "Loading…"
              : "No review yet. It's generated off this machine and posted in — there's nothing to press here."}
          </p>
        )}
      </div>
    </Sheet>
  );
}
