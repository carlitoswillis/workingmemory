"use client";

import { useEffect, useState, useTransition } from "react";
import type { Item } from "@/lib/types";
import type { ListDef } from "@/lib/lists";
import { archiveItemAction, setDailyDoneAction, toggleDoneAction } from "@/app/actions";
import { describeRecurrence, effectiveDone, localToday, parseRecurrence } from "@/lib/recurrence";
import { daysWithLiveCheck, streakFor } from "@/lib/streaks";
import { useBoardId, useDoorways } from "./board-context";
import SwipeToArchive, { SwipeStill } from "./SwipeToArchive";

// Recency → 0..1 (1 = touched just now). Halves roughly every ~4 days.
function recencyAmount(updatedAt: string): number {
  const ageHours = (Date.now() - new Date(updatedAt).getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours)) return 0;
  return Math.max(0, Math.min(1, Math.exp(-ageHours / 96)));
}
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

// The card's buttons sit inside the sortable wrapper, whose dnd-kit listeners own
// Space/Enter (start a keyboard drag) and the arrows (move it) — those still stop
// here. Everything else has to keep going: React attaches at the root, so swallowing
// every keydown also hid the board's own hotkeys ("a", "c", "/", ⌘Z) from the window
// handler whenever a card had focus, which is exactly after you've clicked one.
function stopDragKeys(e: React.KeyboardEvent) {
  if (e.key === " " || e.key === "Enter" || e.key.startsWith("Arrow")) e.stopPropagation();
}

// The doorway mark: a way through, drawn rather than spelled — an arrow stepping
// into an open frame. Monochrome stroke, same vocabulary as the archive glyph.
function DoorGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" aria-hidden>
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

export default function ItemCard({
  item,
  childItems,
  selected = false,
  muted = false,
  onSelect,
  onOpenCard,
  onArchive,
}: {
  item: Item;
  allLists: readonly ListDef[];
  childItems?: Item[];
  selected?: boolean;
  muted?: boolean;
  onSelect?: (item: Item, mode: "toggle" | "range") => void;
  onOpenCard: (item: Item) => void;
  // Board hands one down so archiving goes through its optimistic + undoable path
  // (and takes the whole selection with it). Without one — sub-cards in the panel —
  // the card archives itself.
  onArchive?: (item: Item) => void;
}) {
  const boardId = useBoardId();
  // A doorway card: it opens into a board. If that board resolved for this viewer
  // (they're a member) the chip names it and counts what's open behind it, and
  // tapping walks in. If it didn't, the chip stays neutral and inert — no name, no
  // count, no navigation — so a shared board never leaks a board you're not on.
  const { doorways } = useDoorways();
  const doorway = item.linked_board_id ? doorways[item.linked_board_id] ?? null : null;
  const rec = parseRecurrence(item.recurrence);
  const repeats = rec.kind !== "none";
  const [doneLocal, setDoneLocal] = useState(effectiveDone(item));
  useEffect(() => setDoneLocal(effectiveDone(item)), [item]);
  const [, startTransition] = useTransition();

  function toggleDone() {
    const next = !doneLocal;
    setDoneLocal(next);
    if (repeats) {
      // Repeating cards record the DAY they were checked off; done-ness is derived
      // from it (today for daily, this week for weekly — see lib/recurrence.ts).
      startTransition(() => setDailyDoneAction(boardId, item.id, next ? localToday() : null));
    } else {
      startTransition(() => toggleDoneAction(boardId, item.id, next));
    }
  }

  // Streak follows the optimistic checkbox: fold doneLocal in before counting, so
  // checking off shows the new streak instantly.
  const today = localToday();
  const streak = repeats
    ? streakFor(
        daysWithLiveCheck(item.completed_days ?? [], today, item.recurrence, doneLocal, item.completed_on),
        today,
        rec,
      )
    : 0;

  function archive() {
    if (onArchive) onArchive(item);
    else startTransition(() => archiveItemAction(boardId, item.id));
  }

  const hasDetails = item.details.trim().length > 0;
  const subTotal = childItems?.length ?? 0;
  const subDone = childItems?.filter((c) => effectiveDone(c)).length ?? 0;

  // Signature: a muted warm left edge that tracks recency (no glow; dim when done).
  const amt = recencyAmount(item.updated_at) * (doneLocal ? 0.18 : 1);
  const edge = `rgb(${lerp(35, 176, amt)}, ${lerp(43, 138, amt)}, ${lerp(69, 92, amt)})`;

  return (
    <SwipeToArchive id={item.id} onArchive={archive}>
      {/* Clipped under sm so a swipe cuts the (still) content against the card's own
          travelling edges instead of spilling it onto the Archive button. Only where
          the swipe exists — at ≥sm the card keeps its overflow, its focus rings, and
          the hover Archive button below. */}
      <div
        className={`card-in group overflow-hidden rounded-lg sm:overflow-visible border bg-[var(--surface)] transition-colors duration-150 ${
          selected
            ? "border-[var(--now)] bg-[var(--surface-2)] ring-1 ring-[var(--now)]"
            : "border-[var(--veil-soft)] hover:border-[var(--veil)] hover:bg-[var(--surface-2)]"
        } ${muted ? "opacity-40" : ""}`}
        style={{ borderLeft: `2px solid ${edge}` }}
      >
        <SwipeStill className="flex items-start gap-2 py-1.5 pl-2 pr-2">
          <button
            aria-label={doneLocal ? "Mark not done" : "Mark done"}
            onClick={toggleDone}
            onKeyDown={stopDragKeys}
            className={`mt-[3px] grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full border transition-colors ${
              doneLocal
                ? "border-[var(--done)] bg-[var(--done)]"
                : "border-[var(--text-lo)] hover:border-[var(--now)]"
            }`}
          >
            {doneLocal && (
              <svg viewBox="0 0 12 12" className="check-pop h-2 w-2 text-[var(--bg-0)]">
                <path
                  d="M2.5 6.3l2.1 2.1 4.9-4.9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>

          <button
            onClick={(e) => {
              // ⌘/Ctrl-click toggles selection, Shift-click extends a range; a plain
              // click still opens the card. (Mac ⌘ or Windows/Linux Ctrl.)
              if (onSelect && (e.metaKey || e.ctrlKey)) onSelect(item, "toggle");
              else if (onSelect && e.shiftKey) onSelect(item, "range");
              else onOpenCard(item);
            }}
            onKeyDown={stopDragKeys}
            className={`min-w-0 flex-1 break-words text-left text-[13.5px] leading-snug ${
              doneLocal ? "text-[var(--text-lo)] line-through" : "text-[var(--text-hi)]"
            }`}
          >
            {item.text}
          </button>

          {item.linked_board_id &&
            (doorway ? (
              <a
                href={`/b/${item.linked_board_id}`}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={stopDragKeys}
                title={`Opens “${doorway.name}” — ${doorway.open} open ${
                  doorway.open === 1 ? "card" : "cards"
                }`}
                className="mt-[1px] flex max-w-[10rem] shrink-0 items-center gap-1 rounded-full border border-[var(--veil)] px-1.5 py-[1px] text-[10px] leading-none text-[var(--text-lo)] transition-colors hover:border-[var(--now)] hover:text-[var(--now)]"
              >
                <DoorGlyph />
                <span className="truncate">{doorway.name}</span>
                <span className="tabular-nums text-[var(--text-lo)]">· {doorway.open}</span>
              </a>
            ) : (
              <span
                title="This card opens a board you're not on"
                className="mt-[1px] flex shrink-0 items-center gap-1 rounded-full border border-[var(--veil)] px-1.5 py-[1px] text-[10px] leading-none text-[var(--text-lo)]"
              >
                <DoorGlyph />
                Linked board
              </span>
            ))}
          {subTotal > 0 && (
            <span
              className="mt-[1px] shrink-0 rounded-full border border-[var(--veil)] px-1.5 py-[1px] text-[10px] leading-none tabular-nums text-[var(--text-lo)]"
              title={`${subDone} of ${subTotal} sub-cards done`}
            >
              ↳ {subDone}/{subTotal}
            </span>
          )}
          {repeats && (
            <span
              className="mt-[1px] shrink-0 text-[11px] leading-none tabular-nums text-[var(--text-lo)]"
              title={
                streak >= 2
                  ? `${describeRecurrence(rec)} — done ${streak} ${
                      rec.kind === "daily" ? "days" : "weeks"
                    } running`
                  : describeRecurrence(rec)
              }
              aria-hidden
            >
              ↻{streak >= 2 && <span className="ml-0.5 text-[10px]">{streak}</span>}
            </span>
          )}
          {hasDetails && (
            <span
              className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: "var(--past)" }}
              aria-hidden
            />
          )}
          {/* The desktop half of "put this away": phones swipe, pointers hover. Hidden
              under sm so a phone card stays clean (and un-mis-tappable) — from sm up
              `.card-actions` shows it always on touch, on hover/focus where there's a
              real pointer. Safe to click by accident: Board's handler is undoable. */}
          <button
            aria-label="Archive this card"
            title="Archive · a"
            onClick={(e) => {
              e.stopPropagation();
              archive();
            }}
            onKeyDown={stopDragKeys}
            className="card-actions mt-[1px] hidden shrink-0 rounded p-[3px] text-[var(--text-lo)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--past)] sm:block"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
              <path
                d="M1.8 3.4h12.4v2.4H1.8zM3 5.8h10V13H3zM6.2 8.6h3.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </SwipeStill>
      </div>
    </SwipeToArchive>
  );
}
