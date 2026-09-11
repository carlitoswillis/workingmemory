"use client";

import { useState, useTransition } from "react";
import { createBoardAction } from "@/app/boards/actions";
import { usePhoneUI } from "./PhoneShell";
import { Chevron, Sheet, fieldFocusProps, useSheetOpen } from "./Sheet";
import { usePhoneBoardData } from "./phone-data";
import PhoneBoardManage from "./PhoneBoardManage";

// The board switcher (§2 F), plus board administration (track "boards"): create,
// rename, invite, remove a member, leave, and delete — the same server actions the
// desktop switcher uses (components/BoardSwitcher.tsx, app/boards/actions.ts), laid
// out as rows instead of a dropdown.
//
// A board row still switches with a plain navigation — `<a href="/b/<id>">` is a
// full page load, not a client transition, so it never touches PhoneShell's history
// stack. Its trailing "Manage" button expands an admin panel (PhoneBoardManage.tsx)
// IN PLACE, under the row, rather than opening a second sheet: stacking a sheet
// inside a sheet gives the back gesture two overlapping ideas of "one level up",
// which this app goes out of its way to keep unambiguous everywhere else.
//
// The list is empty on a local or demo board, where there is exactly one board,
// nothing to switch to, and no account to administer anything with — the sheet says
// so rather than showing an empty box or a "New board" field that would 404.
export default function PhoneBoards() {
  const { close } = usePhoneUI();
  const { open, dismiss } = useSheetOpen();
  const { boardId, boards, loading } = usePhoneBoardData();
  const [, startTransition] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);
  const [newBoard, setNewBoard] = useState("");
  const [managing, setManaging] = useState<string | null>(null);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && close()}
      label="Your boards"
      className="wm-sheet--ledger"
    >
      <div className="wm-sheet__head">
        <p className="wm-ph-title" style={{ flex: 1 }}>
          Boards
        </p>
      </div>

      <div className="wm-sheet__scroll">
        {boards.length === 0 ? (
          <p className="wm-ph-hint wm-ph-pad">
            {loading ? "Loading…" : "This is your only board."}
          </p>
        ) : (
          <>
            <ul>
              {boards.map((b) => {
                const current = b.id === boardId;
                const expanded = managing === b.id;
                return (
                  <li key={b.id}>
                    <div className="wm-ph-row wm-ph-boardrow">
                      <a
                        className="wm-ph-boardrow__link"
                        href={current ? "#" : `/b/${b.id}`}
                        aria-current={current ? "true" : undefined}
                        aria-label={
                          current
                            ? `${b.name}, current board`
                            : `${b.name}, switch to this board`
                        }
                        onClick={(e) => {
                          if (current) {
                            e.preventDefault();
                            dismiss();
                          }
                        }}
                      >
                        <span aria-hidden className="wm-ph-body wm-ph-clamp2">
                          {b.name}
                        </span>
                        {current ? (
                          <span aria-hidden className="wm-ph-caption">
                            here
                          </span>
                        ) : (
                          <span aria-hidden style={{ color: "var(--text-lo)", display: "flex" }}>
                            <Chevron />
                          </span>
                        )}
                      </a>
                      <button
                        type="button"
                        className="wm-ph-tap wm-ph-boardrow__manage"
                        aria-expanded={expanded}
                        aria-label={expanded ? `Close ${b.name} settings` : `Manage ${b.name}`}
                        onClick={() => setManaging((m) => (m === b.id ? null : b.id))}
                      >
                        {expanded ? "Close" : "Manage"}
                      </button>
                    </div>
                    {expanded && (
                      <PhoneBoardManage
                        boardId={b.id}
                        boardName={b.name}
                        currentBoardId={boardId}
                        onLeftOrDeleted={() => setManaging(null)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>

            <form
              className="wm-ph-pad"
              style={{ marginTop: 12 }}
              onSubmit={(e) => {
                e.preventDefault();
                const n = newBoard.trim();
                if (!n) return;
                setNewBoard("");
                startTransition(async () => setCreateError((await createBoardAction(n)) ?? null));
              }}
            >
              <div className="wm-ph-board-manage__row">
                <input
                  className="wm-ph-field"
                  value={newBoard}
                  onChange={(e) => setNewBoard(e.target.value)}
                  placeholder="New board"
                  {...fieldFocusProps()}
                />
                <button type="submit" className="wm-ph-btn wm-ph-btn--auto">
                  Add
                </button>
              </div>
              {createError && (
                <p className="wm-ph-hint" style={{ marginTop: 8, color: "var(--now)" }}>
                  {createError}
                </p>
              )}
            </form>
          </>
        )}
      </div>
    </Sheet>
  );
}
