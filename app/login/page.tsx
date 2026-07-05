import { getMainDb, getRequestUserId } from "@/lib/db";
import { getUsername } from "@/lib/users";
import LoginForm from "./LoginForm";
import ChangePasswordForm from "./ChangePasswordForm";
import { logoutAction } from "./actions";
import ThemeToggle from "@/components/ThemeToggle";

// Account sign-in for the hosted instance (multiple-accounts v1). Locally
// (DEMO_MODE off) the app never gates on a session, so this page is inert.
// There is NO email/password reset in v1 — a forgotten password means asking
// the instance operator.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const userId = getRequestUserId();
  const username = userId ? getUsername(getMainDb(), userId) : null;

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-6">
      <div className="fixed right-5 top-5">
        <ThemeToggle />
      </div>
      <div className="mb-6 flex items-center gap-2.5">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--now)" }}
          aria-hidden
        />
        <h1 className="font-display text-2xl font-medium tracking-tight text-[var(--text-hi)]">
          {userId ? "Your account" : "Sign in"}
        </h1>
      </div>

      {userId ? (
        <div className="flex flex-col gap-6">
          <p className="text-sm text-[var(--text-lo)]">
            Signed in as <span className="text-[var(--text-mid)]">{username}</span> —{" "}
            <a href="/" className="underline text-[var(--text-mid)]">go to your board</a>.
          </p>
          <ChangePasswordForm />
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-lg border px-4 py-2 text-sm"
              style={{
                borderColor: "var(--veil)",
                background: "var(--surface)",
                color: "var(--text-lo)",
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      ) : (
        <>
          <LoginForm />
          <p className="mt-4 text-sm text-[var(--text-lo)]">
            No account?{" "}
            <a href="/signup" className="underline text-[var(--text-mid)]">
              Create one
            </a>
            . Forgot your password? There&apos;s no reset — ask the instance owner.
          </p>
        </>
      )}
    </main>
  );
}
