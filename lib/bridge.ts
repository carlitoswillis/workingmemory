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

// The three columns that make a board the OWNER'S TASK BOARD rather than one of
// their lists-of-things (a movie list, a reading list). Labels, not ids: every
// board is seeded with the same DEFAULT_LISTS ids, so ids can't tell a renamed
// "watch list" from the real thing, but a board whose Today/Focus/Backlog have
// been renamed to "currently"/"unreleased" is no longer the task board. These are
// the DEFAULT_LISTS labels (lib/lists.ts) a task board keeps.
const CANONICAL_LABELS = ["today", "focus", "backlog"] as const;

function boardWithName(db: Database.Database, ownerId: string, boardId: string): OwnerBoard {
  const name =
    (db.prepare("select name from boards where id = ?").get(boardId) as
      | { name: string }
      | undefined)?.name ?? null;
  return { ownerId, boardId, boardName: name };
}

// Is this board one the owner can actually reach — created by them, or one they
// were invited onto? The pin in WM_OWNER_BOARD_ID is checked against this so a
// typo'd or someone else's board id can never redirect the bridge.
const OWNED_BOARD_SQL = `b.created_by = ?
  or exists (select 1 from board_members m where m.board_id = b.id and m.user_id = ?)`;

// The owner is the account NAMED "owner" (OWNER_USERNAME overrides) — pinned
// by name, not inferred; first-created is only the last-resort fallback for a
// DB with no such account.
//
// Their board is resolved DETERMINISTICALLY (2026-09-04), in this order:
//
//   1. WM_OWNER_BOARD_ID, if set and the id belongs to the owner. An explicit
//      pin always wins; a pin that doesn't resolve logs a warning and falls
//      through rather than failing the request.
//   2. The owner's oldest ROOT board carrying the canonical column set — root
//      meaning no live card on any board opens into it as a doorway
//      (items.linked_board_id), so sub-boards like a "watching" movie list are
//      excluded no matter how recently they were touched.
//   3. Only then the old heuristic: the board they most recently wrote to,
//      falling back to the oldest board they created.
//
// Why: rule 3 alone was the whole resolution, and on 2026-09-04 a batch of
// status flips on the "watching" sub-board edged out "Personal" by 28 seconds —
// so the Friday review POSTed its sentinel card onto the movie list and
// /api/context fed the assistant a list of films as the user's board.
export function resolveOwnerBoard(db: Database.Database): OwnerBoard | null {
  const username = process.env.OWNER_USERNAME ?? "owner";
  const owner = ((db.prepare("select id from users where username = ?").get(username) ??
    db.prepare("select id from users order by created_at limit 1").get()) as
    | { id: string }
    | undefined);
  if (!owner) return null;

  // 1. The explicit pin.
  const pinned = process.env.WM_OWNER_BOARD_ID?.trim();
  if (pinned) {
    const row = db
      .prepare(`select b.id from boards b where b.id = ? and (${OWNED_BOARD_SQL})`)
      .get(pinned, owner.id, owner.id) as { id: string } | undefined;
    if (row) return boardWithName(db, owner.id, row.id);
    console.warn(
      `[bridge] WM_OWNER_BOARD_ID=${pinned} is not a board of "${username}" — ignoring it`,
    );
  }

  // 2. The oldest root board with the canonical columns.
  const canonical = db
    .prepare(
      `select b.id from boards b
        where (${OWNED_BOARD_SQL})
          and not exists (
            select 1 from items i where i.linked_board_id = b.id and i.archived = 0
          )
          and (
            select count(distinct lower(trim(l.label))) from lists l
             where l.board_id = b.id and l.archived = 0
               and lower(trim(l.label)) in (${CANONICAL_LABELS.map(() => "?").join(", ")})
          ) = ${CANONICAL_LABELS.length}
        order by b.created_at asc, b.id asc
        limit 1`,
    )
    .get(owner.id, owner.id, ...CANONICAL_LABELS) as { id: string } | undefined;
  if (canonical) return boardWithName(db, owner.id, canonical.id);

  // 3. The old heuristic, kept as the fallback for a DB that fits neither rule
  // (a brand-new account, a board whose columns were all renamed).
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

  return boardWithName(db, owner.id, board.id);
}
