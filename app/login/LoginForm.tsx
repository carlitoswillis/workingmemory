"use client";

import { useFormState, useFormStatus } from "react-dom";
import { loginAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border px-4 py-2 text-sm transition-opacity disabled:opacity-50"
      style={{
        borderColor: "var(--veil)",
        background: "var(--surface)",
        color: "var(--text-hi)",
      }}
    >
      {pending ? "Checking…" : "Sign in"}
    </button>
  );
}

export default function LoginForm() {
  const [state, formAction] = useFormState(loginAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input
        type="password"
        name="password"
        autoFocus
        autoComplete="current-password"
        placeholder="Owner password"
        className="rounded-lg border px-4 py-2 text-sm outline-none"
        style={{
          borderColor: "var(--veil)",
          background: "var(--bg-1)",
          color: "var(--text-hi)",
        }}
      />
      {state?.error && (
        <p className="text-sm" style={{ color: "var(--now)" }}>
          {state.error}
        </p>
      )}
      <SubmitButton />
    </form>
  );
}
