"use client";

import { useEffect, useState, useTransition } from "react";
import type { Item } from "@/lib/types";
import { createNoteAction, editDetailsAction } from "@/app/actions";

// The daily note: a single pinned note that carries over day to day. Its body lives
// in the item's `details`, so every edit is change-tracked (and time-traveled) by the
// same machinery as cards — the time machine becomes your journal. You clear and rewrite
// it each day; past days live in its history / the time machine.
export default function NoteColumn({ note }: { note: Item | null }) {
  const [body, setBody] = useState(note?.details ?? "");
  const [, startTransition] = useTransition();

  useEffect(() => setBody(note?.details ?? ""), [note?.id, note?.details]);

  function save() {
    if (!note || body === note.details) return;
    startTransition(() => editDetailsAction(note.id, body));
  }
  function startNote() {
    startTransition(() => createNoteAction());
  }

  return (
    <section
      className="flex min-h-[220px] flex-col rounded-2xl border border-[var(--veil-soft)] bg-[rgba(20,26,46,0.35)] p-3"
      style={{ borderLeft: "2px solid var(--past)" }}
    >
      <div className="mb-3 px-1.5 pt-1">
        <h2 className="font-display text-[15px] font-medium tracking-tight text-[var(--text-hi)]">
          Note
        </h2>
        <p className="mt-0.5 text-[11px] leading-tight text-[var(--text-lo)]">
          {note ? "Carries over · changes remembered" : "A running daily note"}
        </p>
      </div>

      {note ? (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Today's note… (carries over; start a new one each day)"
          className="min-h-[160px] flex-1 resize-none rounded-lg border border-[var(--veil-soft)] bg-[var(--bg-0)] px-3 py-2.5 font-display text-sm italic leading-relaxed text-[var(--text-hi)] placeholder:not-italic placeholder:text-[var(--text-lo)] focus:border-[var(--now)] focus:outline-none"
        />
      ) : (
        <button
          onClick={startNote}
          className="mt-1 flex flex-1 items-center justify-center rounded-lg border border-dashed border-[var(--veil)] text-sm text-[var(--text-lo)] hover:border-[var(--now)] hover:text-[var(--text-mid)]"
        >
          + Start a note
        </button>
      )}
    </section>
  );
}
