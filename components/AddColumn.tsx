"use client";

import { useState } from "react";
import { MAX_LIST_LABEL } from "@/lib/lists";

// The "+ New column" tile at the end of the board. Collapsed it's a dashed,
// low-key affordance; click to reveal a name field. Submitting calls up to Board
// (which owns the server action + revalidation). Matches the matte, no-emoji taste.
export default function AddColumn({
  onAdd,
  disabled = false,
}: {
  onAdd: (label: string) => void;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = label.trim();
    if (!name) return;
    onAdd(name);
    setLabel("");
    setAdding(false);
  }

  if (disabled) return null;

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="flex min-h-[220px] flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-[var(--veil-soft)] text-sm text-[var(--text-lo)] transition-colors hover:border-[var(--veil)] hover:text-[var(--text-mid)]"
      >
        <span aria-hidden className="text-lg leading-none text-[var(--now)]">＋</span>
        New column
      </button>
    );
  }

  return (
    <section className="flex min-h-[220px] flex-col rounded-2xl border border-[var(--veil-soft)] bg-[var(--wash)] p-3">
      <form onSubmit={submit}>
        <input
          autoFocus
          value={label}
          maxLength={MAX_LIST_LABEL}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              setLabel("");
              setAdding(false);
            }
          }}
          onBlur={() => {
            if (!label.trim()) setAdding(false);
          }}
          placeholder="Column name…"
          className="w-full rounded-xl border border-[var(--veil-soft)] bg-[var(--field)] px-3 py-2 text-sm text-[var(--text-hi)] placeholder:text-[var(--text-lo)] focus:border-[var(--now)] focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-2 px-0.5">
          <button
            type="submit"
            className="rounded-md border border-[var(--veil)] px-2.5 py-1 text-xs text-[var(--text-mid)] transition-colors hover:border-[var(--now)] hover:text-[var(--now)]"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setLabel("");
              setAdding(false);
            }}
            className="rounded-md px-2 py-1 text-xs text-[var(--text-lo)] hover:text-[var(--text-mid)]"
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
