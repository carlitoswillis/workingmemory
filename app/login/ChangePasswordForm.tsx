"use client";

import { useFormState, useFormStatus } from "react-dom";
import { changePasswordAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="self-start rounded-lg border px-4 py-2 text-sm transition-opacity disabled:opacity-50"
      style={{
        borderColor: "var(--veil)",
        background: "var(--surface)",
        color: "var(--text-hi)",
      }}
    >
      {pending ? "Saving…" : "Change password"}
    </button>
  );
}

const inputStyle = {
  borderColor: "var(--veil)",
  background: "var(--bg-1)",
  color: "var(--text-hi)",
} as const;

export default function ChangePasswordForm() {
  const [state, formAction] = useFormState(changePasswordAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <p className="text-sm text-[var(--text-lo)]">Change password</p>
      <input
        type="password"
        name="old_password"
        autoComplete="current-password"
        placeholder="Current password"
        className="rounded-lg border px-4 py-2 text-sm outline-none"
        style={inputStyle}
      />
      <input
        type="password"
        name="new_password"
        autoComplete="new-password"
        placeholder="New password (8+ characters)"
        className="rounded-lg border px-4 py-2 text-sm outline-none"
        style={inputStyle}
      />
      {state?.error && (
        <p className="text-sm" style={{ color: "var(--now)" }}>
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className="text-sm text-[var(--text-mid)]">Password changed.</p>
      )}
      <SubmitButton />
    </form>
  );
}
