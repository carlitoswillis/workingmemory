"use server";

import { redirect } from "next/navigation";
import { DEMO_MODE, getMainDb } from "@/lib/db";
import { setSessionCookie } from "@/lib/session";
import { createUser } from "@/lib/users";

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

  const result = createUser(getMainDb(), username, password);
  if ("error" in result) return result;

  setSessionCookie(result.id, secret);
  redirect("/");
}
