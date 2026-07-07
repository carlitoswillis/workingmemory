"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BoardSummary, Member, Role } from "@/lib/boards";
import {
  createBoardAction,
  deleteBoardAction,
  inviteMemberAction,
  leaveBoardAction,
  removeMemberAction,
  renameBoardAction,
} from "@/app/boards/actions";

// The board switcher + manager: a low-key dropdown in the board header. Lists the
// boards you belong to (switch by navigating), creates new ones, and — for the
// current board — shows members and, if you're the owner, invite-by-username,
// rename, and remove-member. Leave-board is available to anyone. Matte, no emoji,
// matching the rest of the header. Personal board (the first) lives at "/"; the
// rest at /b/<id>.
export default function BoardSwitcher({
  boardId,
  boardName,
  boards,
  members,
  myRole,
  me,
}: {
  boardId: string;
  boardName: string;
  boards: BoardSummary[];
  members: Member[];
  myRole: Role | null;
  me: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(boardName);
  const [invite, setInvite] = useState("");
  const [newBoard, setNewBoard] = useState("");
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  const personalId = boards[0]?.id;
  const hrefFor = (id: string) => (id === personalId ? "/" : `/b/${id}`);
  const isOwner = myRole === "owner";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (p: Promise<string | null>) =>
    startTransition(async () => setError((await p) ?? null));

  const handleDeleteOrLeave = (id: string, name: string, role: Role) => {
    const isOwn = role === "owner";
    const msg = isOwn
      ? `Are you sure you want to delete the board "${name}"? This will permanently delete all its columns, cards, and history for everyone.`
      : `Are you sure you want to leave the board "${name}"?`;
    if (!window.confirm(msg)) return;

    if (isOwn) {
      run(deleteBoardAction(id, boardId));
    } else {
      run(leaveBoardAction(id, boardId));
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs"
        style={{ borderColor: "var(--veil)", background: "var(--surface)", color: "var(--text-mid)" }}
        title="Switch or manage boards"
      >
        <span className="max-w-[9rem] truncate sm:max-w-[12rem]">{boardName}</span>
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-[var(--text-lo)]" aria-hidden>
          <path d="M2.5 4.5l3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 z-50 mt-2 w-72 max-w-[calc(100vw-3rem)] rounded-xl border p-2 shadow-2xl sm:left-auto sm:right-0"
          style={{ borderColor: "var(--veil)", background: "var(--bg-1)" }}
        >
          <p className="px-2 pb-1 pt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-lo)]">
            Your boards
          </p>
          <ul className="flex flex-col">
            {boards.map((b) => (
              <li
                key={b.id}
                className="group flex w-full items-center justify-between gap-1 rounded-md px-1 hover:bg-[var(--surface-2)]"
              >
                <button
                  onClick={() => {
                    setOpen(false);
                    router.push(hrefFor(b.id));
                  }}
                  className="flex flex-1 items-center justify-between gap-2 min-w-0 py-1.5 px-1 text-left text-sm"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: b.id === boardId ? "var(--now)" : "transparent" }}
                      aria-hidden
                    />
                    <span className="truncate text-[var(--text-hi)]">{b.name}</span>
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-lo)]">
                    {b.members > 1 ? `${b.members}` : ""}
                  </span>
                </button>

                {boards.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteOrLeave(b.id, b.name, b.role);
                    }}
                    title={b.role === "owner" ? `Delete "${b.name}"` : `Leave "${b.name}"`}
                    className="shrink-0 rounded p-1 text-[11px] text-[var(--text-lo)] hover:bg-[var(--surface-3)] hover:text-[var(--text-hi)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = newBoard.trim();
              if (!n) return;
              setNewBoard("");
              run(createBoardAction(n)); // redirects to the new board on success
            }}
            className="mt-1 flex items-center gap-1.5 px-1"
          >
            <input
              value={newBoard}
              onChange={(e) => setNewBoard(e.target.value)}
              placeholder="New board…"
              className="min-w-0 flex-1 rounded-md border border-[var(--veil-soft)] bg-[var(--field)] px-2 py-1 text-sm text-[var(--text-hi)] placeholder:text-[var(--text-lo)] focus:border-[var(--now)] focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md border border-[var(--veil)] px-2 py-1 text-xs text-[var(--text-mid)] hover:border-[var(--now)] hover:text-[var(--now)]"
            >
              Add
            </button>
          </form>

          <div className="my-2 border-t border-[var(--veil-soft)]" />

          {/* Current board management */}
          <div className="px-1">
            <div className="flex items-center justify-between gap-2 px-1">
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-lo)]">
                This board
              </p>
              {isOwner && !renaming && (
                <button
                  onClick={() => {
                    setNameDraft(boardName);
                    setRenaming(true);
                  }}
                  className="text-[11px] text-[var(--text-lo)] hover:text-[var(--text-mid)]"
                >
                  Rename ✎
                </button>
              )}
            </div>

            {renaming && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setRenaming(false);
                  if (nameDraft.trim() && nameDraft !== boardName)
                    run(renameBoardAction(boardId, nameDraft.trim()));
                }}
                className="mt-1 px-1"
              >
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => setRenaming(false)}
                  className="w-full rounded-md border border-[var(--veil)] bg-[var(--bg-0)] px-2 py-1 text-sm text-[var(--text-hi)] focus:border-[var(--now)] focus:outline-none"
                />
              </form>
            )}

            <ul className="mt-1 flex flex-col gap-0.5">
              {members.map((m) => (
                <li
                  key={m.userId}
                  className="flex items-center justify-between gap-2 px-1 py-0.5 text-sm"
                >
                  <span className="truncate text-[var(--text-mid)]">
                    @{m.username}
                    {m.userId === me && <span className="text-[var(--text-lo)]"> · you</span>}
                    {m.role === "owner" && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-[var(--text-lo)]">
                        owner
                      </span>
                    )}
                  </span>
                  {isOwner && m.userId !== me && (
                    <button
                      onClick={() => run(removeMemberAction(boardId, m.userId))}
                      title={`Remove @${m.username}`}
                      className="shrink-0 rounded px-1 text-[11px] text-[var(--text-lo)] hover:bg-[var(--surface-2)] hover:text-[var(--text-hi)]"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {isOwner && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const u = invite.trim();
                  if (!u) return;
                  setInvite("");
                  run(inviteMemberAction(boardId, u));
                }}
                className="mt-1.5 flex items-center gap-1.5 px-1"
              >
                <input
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  placeholder="Invite by username…"
                  className="min-w-0 flex-1 rounded-md border border-[var(--veil-soft)] bg-[var(--field)] px-2 py-1 text-sm text-[var(--text-hi)] placeholder:text-[var(--text-lo)] focus:border-[var(--now)] focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-md border border-[var(--veil)] px-2 py-1 text-xs text-[var(--text-mid)] hover:border-[var(--now)] hover:text-[var(--now)]"
                >
                  Invite
                </button>
              </form>
            )}

            {/* Leave board — hidden for the personal board (can't leave your only owner board). */}
            {boardId !== personalId && (
              <button
                onClick={() => run(leaveBoardAction(boardId))}
                className="mt-2 w-full rounded-md px-2 py-1 text-left text-xs text-[var(--text-lo)] hover:bg-[var(--surface-2)] hover:text-[var(--text-mid)]"
              >
                Leave this board
              </button>
            )}

            {error && <p className="mt-1.5 px-1 text-[11px] text-[var(--now)]">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
