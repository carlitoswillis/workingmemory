import { redirect } from "next/navigation";
import { getRequestUserId } from "@/lib/db";
import SignupForm from "./SignupForm";

// Open signup (multiple-accounts v1). Inert locally (DEMO_MODE off) — the
// action reports "not configured" — and already-signed-in users are sent home.
// No email in v1, so no password reset: the page says so up front.
export const dynamic = "force-dynamic";

export default function SignupPage() {
  if (getRequestUserId()) redirect("/");

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-6">
      <div className="mb-6 flex items-center gap-2.5">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--now)" }}
          aria-hidden
        />
        <h1 className="font-display text-2xl font-medium tracking-tight text-[var(--text-hi)]">
          Create your board
        </h1>
      </div>

      <SignupForm />

      <p className="mt-4 text-sm text-[var(--text-lo)]">
        Already have an account?{" "}
        <a href="/login" className="underline text-[var(--text-mid)]">
          Sign in
        </a>
        . No email, no reset — if you forget your password, that&apos;s that. Write it
        down.
      </p>
    </main>
  );
}
