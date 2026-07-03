"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  OWNER_COOKIE,
  OWNER_SESSION_MAX_AGE_S,
  checkOwnerPassword,
  signOwnerSession,
} from "@/lib/auth";

// Single-owner login (portfolio plan Phase 1b). One secret, one cookie, no user
// tables. Per-IP attempt rate-limiting lives in middleware.ts; this action adds
// a constant-time compare and a fixed delay on failure so timing reveals
// nothing even if middleware is bypassed.

const FAIL_DELAY_MS = 400;

export async function loginAction(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string }> {
  const secret = process.env.OWNER_SECRET;
  if (!secret) return { error: "Owner login isn't configured on this instance." };

  const password = String(formData.get("password") ?? "");
  if (!checkOwnerPassword(password, secret)) {
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return { error: "Wrong password." };
  }

  cookies().set(
    OWNER_COOKIE,
    signOwnerSession(secret, Date.now() + OWNER_SESSION_MAX_AGE_S * 1000),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: OWNER_SESSION_MAX_AGE_S,
      path: "/",
    },
  );
  redirect("/");
}

export async function logoutAction() {
  cookies().delete(OWNER_COOKIE);
  redirect("/login");
}
