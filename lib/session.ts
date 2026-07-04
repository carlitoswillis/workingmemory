import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, signUserSession } from "./auth";

// Shared by the login and signup server actions (it can't live in either
// actions file: "use server" modules may only export async actions).

export function setSessionCookie(userId: string, secret: string) {
  cookies().set(
    SESSION_COOKIE,
    signUserSession(secret, userId, Date.now() + SESSION_MAX_AGE_S * 1000),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_MAX_AGE_S,
      path: "/",
    },
  );
}
