"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { addItemAction } from "@/app/actions";

// Keyboard-first "brain dump": a global hotkey (c or ⌘/Ctrl-K) opens this small
// overlay anywhere on the board; type a thought, Enter files it into the capture
// column and clears the field so you can fire off several in a row, Esc closes. The
// target list is chosen by Board (the "braindump" column if it still exists, else the
// last column) since columns are user-editable now — captures are change-tracked +
// time-traveled like anything else. Open/close state is owned by Board (which also owns
// the global keydown listener); this component owns the draft + the rapid-add UX.
export default function QuickCapture({
  open,
  listId,
  onClose,
}: {
  open: boolean;
  listId: string;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [added, setAdded] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setAdded(0);
      // Focus after the overlay paints (autoFocus can race the mount animation).
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setText("");
    }
  }, [open]);

  if (!open) return null;

  function submit() {
    const t = text.trim();
    if (!t || !listId) return;
    setText("");
    setAdded((n) => n + 1);
    startTransition(() => addItemAction(t, listId));
    inputRef.current?.focus();
  }

  // Keep the input's keys away from Board's global handler (undo/select/hotkeys).
  function onKeyDown(e: React.KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[18vh]"
      style={{ background: "var(--scrim-deep)" }}
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Quick capture to Brain Dump"
    >
      <div
        className="card-in w-full max-w-md rounded-2xl border border-[var(--veil)] bg-[var(--surface)] p-4 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-2.5 flex items-center gap-2 px-0.5">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--now)" }}
            aria-hidden
          />
          <span className="font-display text-sm font-medium tracking-tight text-[var(--text-mid)]">
            Quick capture
          </span>
          <span className="text-[11px] text-[var(--text-lo)]">→ Brain Dump</span>
        </div>

        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="What's on your mind?"
          className="w-full rounded-xl border border-[var(--veil-soft)] bg-[var(--field)] px-3.5 py-2.5 text-[15px] text-[var(--text-hi)] placeholder:text-[var(--text-lo)] transition-colors focus:border-[var(--now)] focus:outline-none"
        />

        <div className="mt-2.5 flex items-center justify-between px-0.5 text-[11px] text-[var(--text-lo)]">
          <span>
            <kbd className="font-grotesk text-[var(--text-mid)]">Enter</kbd> to add ·{" "}
            <kbd className="font-grotesk text-[var(--text-mid)]">Esc</kbd> to close
          </span>
          {added > 0 && (
            <span className="tabular-nums text-[var(--done)]">
              ✓ {added} added
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
