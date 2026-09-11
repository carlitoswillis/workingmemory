"use client";

import type { Item } from "@/lib/types";
import { useDoorways } from "../board-context";

// The doorway mark, mirrored from the desktop chip (components/ItemCard.tsx): a way
// through, drawn rather than spelled — an arrow stepping into an open frame. Same
// glyph vocabulary, no pictographs (AGENTS.md "No emoji in the UI").
function DoorGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
      <path
        d="M9.5 2.5H13.2V13.5H9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.8 8h6.2M6.6 5.6L9 8l-2.4 2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// A row's doorway chip (card ↔ board doorways, spec 2026-08-30). Glyph + the live
// open count, tapping through to the linked board — the same membership-gated
// DoorwaysProvider the desktop chip reads (wired in PhoneShell), so a member sees a
// real count and a non-member sees the same neutral, inert mark the desktop shows:
// no name, no count, no navigation, never confirming the board exists.
export default function PhoneDoorwayChip({ item }: { item: Item }) {
  const { doorways } = useDoorways();
  if (!item.linked_board_id) return null;
  const doorway = doorways[item.linked_board_id] ?? null;

  if (!doorway) {
    return (
      <span
        className="phone-row__doorway"
        aria-label="This card opens a board you're not on"
        title="This card opens a board you're not on"
      >
        <DoorGlyph />
      </span>
    );
  }

  const openLabel = `${doorway.open} open ${doorway.open === 1 ? "card" : "cards"}`;
  return (
    <a
      href={`/b/${item.linked_board_id}`}
      className="phone-row__doorway"
      onClick={(e) => e.stopPropagation()}
      title={`Opens "${doorway.name}" — ${openLabel}`}
      aria-label={`Open "${doorway.name}", ${openLabel}`}
    >
      <DoorGlyph />
      <span className="tabular-nums" aria-hidden>
        {doorway.open}
      </span>
    </a>
  );
}
