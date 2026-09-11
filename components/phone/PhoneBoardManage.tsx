"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  boardManageDataAction,
  deleteBoardAction,
  inviteMemberAction,
  leaveBoardAction,
  removeMemberAction,
  renameBoardAction,
  type BoardManageData,
} from "@/app/boards/actions";
import { fieldFocusProps } from "./Sheet";

// The per-board admin panel PhoneBoards expands in place under a row's "Manage"
// button (track "boards"). Deliberately not a second sheet: this is a few fields
// and a short list, not a screen of its own, and stacking a sheet inside a sheet
// gives the back gesture two overlapping ideas of "one level up" — exactly what
// PhoneShell's level stack (components/phone/PhoneShell.tsx) exists to keep
// unambiguous. So it touches no history at all; closing it is just local state.
//
// Same server actions the desktop switcher uses (components/BoardSwitcher.tsx +
// app/boards/actions.ts) — nothing new is mutated here, only read: a board's role
// and member list aren't part of the boards list phone-data already carries (that
// stays a cheap id+name fetch), so this fetches them once, on expand, through
// boardManageDataAction.
//
// Owner vs. member is a hard split, mirroring BoardSwitcher: an owner gets the
// admin tools (rename, members + remove, invite, delete); a member gets exactly
// one control, leave. Delete and leave are both "can't undo this from here"
// actions, so both use an in-place second-tap confirm — never window.confirm,
// which the phone app never calls.
const CONFIRM_MS = 3200;

export default function PhoneBoardManage({
  boardId,
  boardName,
  currentBoardId,
  onLeftOrDeleted,
}: {
  boardId: string;
  boardName: string;
  currentBoardId: string | null;
  // Called after a leave/delete that actually went through, so the row above can
  // collapse this panel. Not called on error — the message stays next to the button
  // that produced it.
  onLeftOrDeleted: () => void;
}) {
  const [data, setData] = useState<BoardManageData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(boardName);
  const [invite, setInvite] = useState("");
  const [confirm, setConfirm] = useState<"leave" | "delete" | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    setLoadError(false);
    boardManageDataAction(boardId).then(
      (d) => setData(d ?? { myRole: null, me: "", members: [] }),
      () => setLoadError(true),
    );
  }, [boardId]);

  useEffect(() => {
    load();
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, [load]);

  // The board's own name can change out from under this panel (a rename lands via
  // revalidatePath, which re-renders PhoneBoards with the new name as a prop) — keep
  // the draft in step whenever the caller isn't mid-edit.
  useEffect(() => setNameDraft(boardName), [boardName]);

  const armConfirm = (which: "leave" | "delete") => {
    setConfirm(which);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirm(null), CONFIRM_MS);
  };

  const run = (p: Promise<string | null>, opts?: { reload?: boolean; onOk?: () => void }) =>
    startTransition(async () => {
      const err = await p;
      setError(err ?? null);
      if (!err) {
        opts?.onOk?.();
        if (opts?.reload) load();
      }
    });

  if (loadError) {
    return (
      <div className="wm-ph-board-manage wm-ph-pad">
        <p className="wm-ph-hint">Couldn&apos;t load this board&apos;s settings.</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="wm-ph-board-manage wm-ph-pad">
        <p className="wm-ph-hint">Loading…</p>
      </div>
    );
  }

  const isOwner = data.myRole === "owner";

  return (
    <div className="wm-ph-board-manage wm-ph-pad">
      {isOwner ? (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = nameDraft.trim();
              if (n && n !== boardName) run(renameBoardAction(boardId, n));
            }}
          >
            <label className="wm-ph-caption" htmlFor={`wm-board-name-${boardId}`}>
              Board name
            </label>
            <div className="wm-ph-board-manage__row">
              <input
                id={`wm-board-name-${boardId}`}
                className="wm-ph-field"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                {...fieldFocusProps()}
              />
              {nameDraft.trim() && nameDraft.trim() !== boardName && (
                <button type="submit" className="wm-ph-btn wm-ph-btn--auto wm-ph-btn--primary">
                  Save
                </button>
              )}
            </div>
          </form>

          <p className="wm-ph-sect" style={{ paddingLeft: 0, paddingRight: 0 }}>
            Members
          </p>
          <ul>
            {data.members.map((m) => (
              <li key={m.userId} className="wm-ph-board-manage__member">
                <span className="wm-ph-body" style={{ flex: 1, minWidth: 0 }}>
                  @{m.username}
                  {m.userId === data.me && <span className="wm-ph-caption"> · you</span>}
                  {m.role === "owner" && <span className="wm-ph-caption"> · owner</span>}
                </span>
                {m.userId !== data.me && (
                  <button
                    type="button"
                    className="wm-ph-tap wm-ph-board-manage__remove"
                    aria-label={`Remove @${m.username}`}
                    onClick={() => run(removeMemberAction(boardId, m.userId), { reload: true })}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const u = invite.trim();
              if (!u) return;
              setInvite("");
              run(inviteMemberAction(boardId, u), { reload: true });
            }}
          >
            <div className="wm-ph-board-manage__row">
              <input
                className="wm-ph-field"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                placeholder="Invite by username"
                autoCapitalize="none"
                autoCorrect="off"
                {...fieldFocusProps()}
              />
              <button type="submit" className="wm-ph-btn wm-ph-btn--auto">
                Invite
              </button>
            </div>
          </form>

          <button
            type="button"
            className={`wm-ph-btn wm-ph-board-manage__danger ${confirm === "delete" ? "wm-ph-btn--primary" : ""}`}
            style={{ marginTop: 14 }}
            onClick={() => {
              if (confirm === "delete") {
                setConfirm(null);
                run(deleteBoardAction(boardId, currentBoardId ?? undefined), {
                  onOk: onLeftOrDeleted,
                });
              } else {
                armConfirm("delete");
              }
            }}
          >
            {confirm === "delete" ? "Tap again to permanently delete" : "Delete this board"}
          </button>
        </>
      ) : (
        <button
          type="button"
          className={`wm-ph-btn wm-ph-board-manage__danger ${confirm === "leave" ? "wm-ph-btn--primary" : ""}`}
          onClick={() => {
            if (confirm === "leave") {
              setConfirm(null);
              run(leaveBoardAction(boardId, currentBoardId ?? undefined), {
                onOk: onLeftOrDeleted,
              });
            } else {
              armConfirm("leave");
            }
          }}
        >
          {confirm === "leave" ? "Tap again to leave" : "Leave this board"}
        </button>
      )}

      {error && (
        <p className="wm-ph-hint" style={{ marginTop: 10, color: "var(--now)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
