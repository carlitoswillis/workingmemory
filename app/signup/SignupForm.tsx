"use client";

import { useFormState, useFormStatus } from "react-dom";
import { signupAction } from "./actions";

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
      {pending ? "Creating…" : "Create account"}
    </button>
  );
}

const inputStyle = {
  borderColor: "var(--veil)",
  background: "var(--bg-1)",
  color: "var(--text-hi)",
} as const;

export default function SignupForm() {
  const [state, formAction] = useFormState(signupAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input
        type="text"
        name="username"
        autoFocus
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="Username (a–z, 0–9, - or _)"
        className="rounded-lg border px-4 py-2 text-sm outline-none"
        style={inputStyle}
      />
      <input
        type="password"
        name="password"
        autoComplete="new-password"
        placeholder="Password (8+ characters)"
        className="rounded-lg border px-4 py-2 text-sm outline-none"
        style={inputStyle}
      />
      <input
        type="password"
        name="confirm"
        autoComplete="new-password"
        placeholder="Password again"
        className="rounded-lg border px-4 py-2 text-sm outline-none"
        style={inputStyle}
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
