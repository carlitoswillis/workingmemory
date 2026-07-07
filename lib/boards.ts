import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
// .ts extension so plain-node tests can import this (see lib/users.ts).
import { findUserByUsername } from "./users.ts";

// Boards + membership (shared boards v1, 2026-07-07). Pure functions over an
// explicit db handle — no Next imports — so `node lib/boards.test.ts` runs them
// against a scratch DB. A board is the scope now: rows carry board_id, and
// membership is the authorization. Only the main hosted DB has rows here.

export const MAX_BOARDS_PER_USER = 10;
export const MAX_MEMBERS_PER_BOARD = 10;
export const MAX_BOARD_NAME = 40;

export type Role = "owner" | "member";
export type BoardSummary = { id: string; name: string; role: Role; members: number };
export type Member = { userId: string; username: string; role: Role };

function clampName(raw: string): string {
  return raw.trim().slice(0, MAX_BOARD_NAME);
}

// The role a user holds on a board, or null if not a member. This IS the
// authorization check — getBoardContext calls it once per request.
export function getMembership(
  db: Database.Database,
  boardId: string,
  userId: string,
): Role | null {
  const row = db
    .prepare("select role from board_members where board_id = ? and user_id = ?")
    .get(boardId, userId) as { role: Role } | undefined;
  return row?.role ?? null;
}

// The board to show at "/": the user's earliest membership — their Personal board,
// created at signup before any invite could land. Null if they somehow have none.
export function defaultBoardId(db: Database.Database, userId: string): string | null {
  const row = db
    .prepare(
      "select board_id from board_members where user_id = ? order by joined_at asc, board_id asc limit 1",
    )
    .get(userId) as { board_id: string } | undefined;
  return row?.board_id ?? null;
}

// Boards the user belongs to (for the switcher), personal/earliest first.
export function getUserBoards(db: Database.Database, userId: string): BoardSummary[] {
  return db
    .prepare(
      `select b.id, b.name, m.role,
              (select count(*) from board_members where board_id = b.id) as members
       from board_members m join boards b on b.id = m.board_id
       where m.user_id = ?
       order by m.joined_at asc, b.name asc`,
    )
    .all(userId) as BoardSummary[];
}

export function getBoardName(db: Database.Database, boardId: string): string | null {
  const row = db.prepare("select name from boards where id = ?").get(boardId) as
    | { name: string }
    | undefined;
  return row?.name ?? null;
}

export function getBoardMembers(db: Database.Database, boardId: string): Member[] {
  return db
    .prepare(
      `select m.user_id as userId, u.username, m.role
       from board_members m join users u on u.id = m.user_id
       where m.board_id = ?
       order by m.role = 'owner' desc, u.username asc`,
    )
    .all(boardId) as Member[];
}

// usernames of everyone on the board — for labeling event actors in history.
export function getMemberUsernames(
  db: Database.Database,
  boardId: string,
): Record<string, string> {
  const rows = getBoardMembers(db, boardId);
  const map: Record<string, string> = {};
  for (const m of rows) map[m.userId] = m.username;
  return map;
}

// Create a board owned by `userId`. Enforces the per-user cap.
export function createBoard(
  db: Database.Database,
  userId: string,
  name: string,
): { id: string } | { error: string } {
  const n = clampName(name);
  if (!n) return { error: "Give the board a name." };
  const owned = (
    db
      .prepare("select count(*) c from boards where created_by = ?")
      .get(userId) as { c: number }
  ).c;
  if (owned >= MAX_BOARDS_PER_USER) {
    return { error: `You can own at most ${MAX_BOARDS_PER_USER} boards.` };
  }
  const id = randomUUID();
  db.transaction(() => {
    db.prepare("insert into boards (id, name, created_by) values (?, ?, ?)").run(id, n, userId);
    db.prepare(
      "insert into board_members (board_id, user_id, role) values (?, ?, 'owner')",
    ).run(id, userId);
  })();
  return { id };
}

// Rename a board. Caller must have verified the owner role.
export function renameBoard(db: Database.Database, boardId: string, name: string): boolean {
  const n = clampName(name);
  if (!n) return false;
  return db.prepare("update boards set name = ? where id = ?").run(n, boardId).changes > 0;
}

// Invite by exact username (no email in this product). Idempotent: re-inviting an
// existing member is a no-op (the composite PK). Enforces the member cap.
export function inviteMember(
  db: Database.Database,
  boardId: string,
  username: string,
): { ok: true } | { error: string } {
  const user = findUserByUsername(db, username.trim().toLowerCase());
  if (!user) return { error: "No user with that username." };
  if (getMembership(db, boardId, user.id)) return { ok: true }; // already a member
  const count = (
    db
      .prepare("select count(*) c from board_members where board_id = ?")
      .get(boardId) as { c: number }
  ).c;
  if (count >= MAX_MEMBERS_PER_BOARD) {
    return { error: `A board can have at most ${MAX_MEMBERS_PER_BOARD} members.` };
  }
  db.prepare(
    "insert or ignore into board_members (board_id, user_id, role) values (?, ?, 'member')",
  ).run(boardId, user.id);
  return { ok: true };
}

// Remove a member (owner action) or leave a board (self). Never removes the last
// owner — a board must always have someone who can manage it.
export function removeMember(
  db: Database.Database,
  boardId: string,
  userId: string,
): { ok: true } | { error: string } {
  const role = getMembership(db, boardId, userId);
  if (!role) return { ok: true };
  if (role === "owner") {
    const owners = (
      db
        .prepare("select count(*) c from board_members where board_id = ? and role = 'owner'")
        .get(boardId) as { c: number }
    ).c;
    if (owners <= 1) return { error: "The last owner can't leave — delete the board instead." };
  }
  db.prepare("delete from board_members where board_id = ? and user_id = ?").run(boardId, userId);
  return { ok: true };
}
