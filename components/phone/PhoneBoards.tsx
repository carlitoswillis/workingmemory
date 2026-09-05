"use client";

import { usePhoneUI } from "./PhoneShell";
import { Sheet, useSheetOpen } from "./Sheet";
import { usePhoneBoardData } from "./phone-data";

// The board switcher (§2 F). A list, and nothing else.
//
// Switching boards is a NAVIGATION, not a mutation, so it's a plain link to
// /b/<id> — the same route the desktop switcher uses. Deliberately not the desktop
// BoardSwitcher's full surface: creating boards, renaming them, inviting members and
// removing people are board ADMINISTRATION, and this app is explicitly not a board
// editor (§1.6). Those stay where there's room for a confirmation you can read.
//
// The list is empty on a local or demo board, where there is exactly one board and
// nothing to switch to; the sheet says so rather than showing an empty box.

export default function PhoneBoards() {
  const { close } = usePhoneUI();
  const { open, dismiss } = useSheetOpen();
  const { boardId, boards, loading } = usePhoneBoardData();

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()} label="Your boards" heightSvh={45}>
      <div className="wm-sheet__head">
        <p className="wm-ph-title" style={{ flex: 1 }}>
          Boards
        </p>
      </div>

      <div className="wm-sheet__scroll">
        {boards.length === 0 ? (
          <p className="wm-ph-hint">
            {loading ? "Loading…" : "This is your only board."}
          </p>
        ) : (
          <ul>
            {boards.map((b) => {
              const current = b.id === boardId;
              return (
                <li key={b.id}>
                  <a
                    className="wm-ph-row"
                    href={current ? "#" : `/b/${b.id}`}
                    aria-current={current ? "true" : undefined}
                    onClick={(e) => {
                      if (current) {
                        e.preventDefault();
                        dismiss();
                      }
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: current ? "var(--now)" : "var(--veil)",
                        flex: "none",
                      }}
                    />
                    <span className="wm-ph-body wm-ph-clamp2" style={{ flex: 1 }}>
                      {b.name}
                    </span>
                    {current && <span className="wm-ph-caption">here</span>}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
        <p className="wm-ph-hint" style={{ marginTop: 12 }}>
          Creating, renaming and sharing boards live on the desktop board.
        </p>
      </div>
    </Sheet>
  );
}
