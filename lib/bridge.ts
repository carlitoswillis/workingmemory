import { createHash, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import type { NextRequest } from "next/server";

// The brain bridge: scoped access for the sibling second-brain app
// (~/workspace/AIA2ndBrain/brain). BRAIN_TOKEN authorizes exactly two things —
// reading the owner's board context (GET /api/context) and pushing single
// items (POST /api/items) — so the brain app never needs OWNER_SECRET, which
// can dump or replace the entire multi-account DB. Unset BRAIN_TOKEN = the
// endpoints don't exist (the /api/export pattern).

export function brainBearerOk(req: NextRequest): boolean {
  const secret = process.env.BRAIN_TOKEN;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const supplied = header.slice("Bearer ".length);
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(supplied), h(secret));
}

export type OwnerBoard = { ownerId: string; boardId: string; boardName: string | null };

// The owner is the first-created account (user #1 by migration order);
// OWNER_USERNAME overrides. Their "active board" is the one they most recently
// wrote to — the same heuristic the brain app's context reader uses — falling
// back to the oldest board they created (a brand-new, still-empty board).
export function resolveOwnerBoard(db: Database.Database): OwnerBoard | null {
  const username = process.env.OWNER_USERNAME;
  const owner = (
    username
      ? db.prepare("select id from users where username = ?").get(username)
      : db.prepare("select id from users order by created_at limit 1").get()
  ) as { id: string } | undefined;
  if (!owner) return null;

  const board =
    (db
      .prepare(
        `select board_id as id from items
          where user_id = ? and board_id is not null
          group by board_id order by max(updated_at) desc limit 1`,
      )
      .get(owner.id) as { id: string } | undefined) ??
    (db
      .prepare("select id from boards where created_by = ? order by created_at limit 1")
      .get(owner.id) as { id: string } | undefined);
  if (!board) return null;

  const name =
    (db.prepare("select name from boards where id = ?").get(board.id) as
      | { name: string }
      | undefined)?.name ?? null;
  return { ownerId: owner.id, boardId: board.id, boardName: name };
}
