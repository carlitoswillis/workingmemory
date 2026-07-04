"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth";
import { DEMO_MODE, getMainDb, getRequestUserId } from "@/lib/db";
import { setSessionCookie } from "@/lib/session";
import { authenticate, changePassword } from "@/lib/users";

// Account login (multiple-accounts v1). Per-IP attempt rate-limiting lives in
// middleware.ts; this action adds a fixed delay on failure (authenticate() in
// lib/users.ts already burns the same scrypt time for unknown usernames, so
// timing reveals nothing even if middleware is bypassed).

const FAIL_DELAY_MS = 400;

function sessionSecret(): string | null {
  return DEMO_MODE ? process.env.SESSION_SECRET ?? null : null;
}

export async function loginAction(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string }> {
  const secret = sessionSecret();
  if (!secret) return { error: "Accounts aren't configured on this instance." };

  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const userId = authenticate(getMainDb(), username, password);
  if (!userId) {
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return { error: "Wrong username or password." };
  }

  setSessionCookie(userId, secret);
  redirect("/");
}

export async function logoutAction() {
  cookies().delete(SESSION_COOKIE);
  redirect("/login");
}

export async function changePasswordAction(
  _prev: { error?: string; ok?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const userId = getRequestUserId();
  if (!userId) return { error: "Not signed in." };

  const oldPassword = String(formData.get("old_password") ?? "");
  const newPassword = String(formData.get("new_password") ?? "");
  const result = changePassword(getMainDb(), userId, oldPassword, newPassword);
  if ("error" in result) {
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return result;
  }
  return { ok: true };
}
