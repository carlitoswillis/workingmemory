import { isOwnerRequest } from "@/lib/db";
import LoginForm from "./LoginForm";
import { logoutAction } from "./actions";

// Owner sign-in for the hosted instance (Phase 1b). Deliberately unlinked from
// the board UI — demo visitors never need it; the owner knows the URL. Locally
// (DEMO_MODE off) the app never gates on a session, so this page is inert.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const signedIn = isOwnerRequest();

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-6">
      <div className="mb-6 flex items-center gap-2.5">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--now)" }}
          aria-hidden
        />
        <h1 className="font-display text-2xl font-medium tracking-tight text-[var(--text-hi)]">
          Owner sign-in
        </h1>
      </div>

      {signedIn ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--text-lo)]">
            You&apos;re signed in — <a href="/" className="underline text-[var(--text-mid)]">go to your board</a>.
          </p>
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
        <LoginForm />
      )}
    </main>
  );
}
