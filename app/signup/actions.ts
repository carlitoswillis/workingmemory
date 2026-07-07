"use server";

import { redirect } from "next/navigation";
import { DEMO_MODE, getMainDb } from "@/lib/db";
import { setSessionCookie } from "@/lib/session";
import { createUser } from "@/lib/users";
import { createBoard } from "@/lib/boards";

// Open signup (multiple-accounts v1). Per-IP rate limiting lives in
// middleware.ts (stricter than login); input rules + uniqueness live in
// lib/users.ts#createUser. A new account starts with an empty board.

export async function signupAction(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string }> {
  const secret = DEMO_MODE ? process.env.SESSION_SECRET : undefined;
  if (!secret) return { error: "Accounts aren't configured on this instance." };

  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password !== confirm) return { error: "Passwords don't match." };

  const db = getMainDb();
  const result = createUser(db, username, password);
  if ("error" in result) return result;
  // Every account starts with a Personal board (owner). The DB-open bootstrap
  // would create one too, but doing it here means the board exists on first render.
  createBoard(db, result.id, "Personal");

  setSessionCookie(result.id, secret);
  redirect("/");
}
