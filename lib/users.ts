import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
// Explicit .ts extension so plain-node tests can import this module (ESM
// resolution); tsc allows it (allowImportingTsExtensions) and webpack resolves
// the literal path.
import { hashPassword, verifyPassword } from "./auth.ts";

// Account CRUD against the main hosted DB's `users` table. Pure functions over
// an explicit db handle (no Next imports) so `node lib/users.test.ts` can run
// them against a scratch DB; callers get the handle from lib/db.ts.

export const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;
export const PASSWORD_MIN_LEN = 8;

export type UserRow = { id: string; username: string; pass_hash: string };

export function findUserByUsername(db: Database.Database, username: string): UserRow | null {
  const row = db
    .prepare("select id, username, pass_hash from users where username = ?")
    .get(username.trim()) as UserRow | undefined;
  return row ?? null;
}

export function getUsername(db: Database.Database, userId: string): string | null {
  const row = db.prepare("select username from users where id = ?").get(userId) as
    | { username: string }
    | undefined;
  return row?.username ?? null;
}

// Create an account. Returns the new user's id, or an error string suitable for
// showing on the signup form. Username uniqueness is case-insensitive (the
// column is `unique collate nocase`).
export function createUser(
  db: Database.Database,
  username: string,
  password: string,
): { id: string } | { error: string } {
  const name = username.trim().toLowerCase();
  if (!USERNAME_RE.test(name)) {
    return { error: "Username must be 3–32 characters: a–z, 0–9, - or _." };
  }
  if (password.length < PASSWORD_MIN_LEN) {
    return { error: `Password must be at least ${PASSWORD_MIN_LEN} characters.` };
  }
  const id = randomUUID();
  try {
    db.prepare("insert into users (id, username, pass_hash) values (?, ?, ?)").run(
      id,
      name,
      hashPassword(password),
    );
  } catch (e) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      return { error: "That username is taken." };
    }
    throw e;
  }
  return { id };
}

// Password login. Returns the user id on success, null otherwise. Hashes even
// for unknown usernames so response timing doesn't reveal which usernames exist.
export function authenticate(
  db: Database.Database,
  username: string,
  password: string,
): string | null {
  const user = findUserByUsername(db, username);
  if (!user) {
    verifyPassword(password, hashPassword("decoy — burn the same scrypt time"));
    return null;
  }
  return verifyPassword(password, user.pass_hash) ? user.id : null;
}

// Change password (requires the current one). Returns false if it didn't match.
export function changePassword(
  db: Database.Database,
  userId: string,
  oldPassword: string,
  newPassword: string,
): { ok: true } | { error: string } {
  if (newPassword.length < PASSWORD_MIN_LEN) {
    return { error: `New password must be at least ${PASSWORD_MIN_LEN} characters.` };
  }
  const row = db.prepare("select pass_hash from users where id = ?").get(userId) as
    | { pass_hash: string }
    | undefined;
  if (!row || !verifyPassword(oldPassword, row.pass_hash)) {
    return { error: "Current password is wrong." };
  }
  db.prepare("update users set pass_hash = ? where id = ?").run(hashPassword(newPassword), userId);
  return { ok: true };
}
