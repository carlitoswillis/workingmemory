"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getBoardContext, getMainDb, getRequestUserId } from "@/lib/db";
import {
  createBoard,
  getMembership,
  inviteMember,
  removeMember,
  renameBoard,
} from "@/lib/boards";

// Board management (shared boards v1). Distinct from app/actions.ts (card CRUD):
// these touch boards + membership. Owner-only actions re-check the role fetched via
// getMembership — the role that getBoardContext already verified belongs to a member,
// here narrowed to 'owner'. Membership itself is the auth (getBoardContext 404s a
// non-member before any of this runs).

function requireOwner(boardId: string): { db: ReturnType<typeof getMainDb>; userId: string } {
  const { db, userId } = getBoardContext(boardId); // 404s a non-member
  if (!userId || getMembership(db, boardId, userId) !== "owner") {
    // Members (non-owners) can't manage the board. Treat as not-found rather than
    // confirming the board to someone who can't act on it.
    redirect("/");
  }
  return { db, userId };
}

export async function createBoardAction(name: string) {
  const userId = getRequestUserId();
  if (!userId) redirect("/login");
  const res = createBoard(getMainDb(), userId, name);
  if ("error" in res) return res.error;
  redirect(`/b/${res.id}`);
}

export async function renameBoardAction(boardId: string, name: string): Promise<string | null> {
  const { db } = requireOwner(boardId);
  if (!renameBoard(db, boardId, name)) return "Give the board a name.";
  revalidatePath("/", "layout");
  return null;
}

export async function inviteMemberAction(
  boardId: string,
  username: string,
): Promise<string | null> {
  const { db } = requireOwner(boardId);
  const res = inviteMember(db, boardId, username);
  if ("error" in res) return res.error;
  revalidatePath("/", "layout");
  return null;
}

export async function removeMemberAction(
  boardId: string,
  targetUserId: string,
): Promise<string | null> {
  const { db, userId } = requireOwner(boardId);
  if (targetUserId === userId) return "Use “Leave board” to remove yourself.";
  const res = removeMember(db, boardId, targetUserId);
  if ("error" in res) return res.error;
  revalidatePath("/", "layout");
  return null;
}

// Leave a board (self-removal). Any member can; the last owner can't (they'd orphan
// board management). Redirects home afterward since you're no longer a member.
export async function leaveBoardAction(boardId: string): Promise<string | null> {
  const { db, userId } = getBoardContext(boardId);
  if (!userId) redirect("/login");
  const res = removeMember(db, boardId, userId);
  if ("error" in res) return res.error;
  redirect("/");
}
