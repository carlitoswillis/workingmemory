"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import type { Item } from "@/lib/types";
import { createNoteAction, editDetailsAction } from "@/app/actions";
import { useBoardId } from "./board-context";
import { firstLineSummary, useCollapsibleColumn } from "./collapsibleColumn";

// The daily note: a single pinned note that carries over day to day. Its body lives
// in the item's `details`, so every edit is change-tracked (and time-traveled) by the
// same machinery as cards — the time machine becomes your journal. You clear and rewrite
// it each day; past days live in its history / the time machine.
//
// Body renders as markdown at rest (so the note's daily/weekly checklists become real
// task lists) and drops to a raw textarea on click/Edit. ssr:true so the note doesn't
// flash "rendering…" on first paint — but react-markdown is still code-split out of the
// initial board JS (loaded during hydration), same shared renderer as the card panels.
const Markdown = dynamic(() => import("./Markdown"), {
  ssr: true,
  loading: () => <span className="text-sm text-[var(--text-lo)]">rendering…</span>,
});

function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="14"
      height="14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`wm-collapsible-chevron mt-[3px] shrink-0 text-[var(--text-lo)] ${
        collapsed ? "is-collapsed" : ""
      }`}
    >
      <path d="M6 8l4 4 4-4" />
    </svg>
  );
}

export default function NoteColumn({ note }: { note: Item | null }) {
  const boardId = useBoardId();
  const { collapsed, toggle } = useCollapsibleColumn(boardId, "note");
  const [body, setBody] = useState(note?.details ?? "");
  const [editing, setEditing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [, startTransition] = useTransition();

  useEffect(() => setBody(note?.details ?? ""), [note?.id, note?.details]);
  useEffect(() => setEditing(false), [note?.id]); // back to preview on note swap
  useEffect(() => {
    if (editing) taRef.current?.focus();
  }, [editing]);

  function save() {
    setEditing(false);
    if (!note || body === note.details) return;
    startTransition(() => editDetailsAction(boardId, note.id, body));
  }
  function startNote() {
    startTransition(() => createNoteAction(boardId));
  }

  // Collapsing while mid-edit should save first, same as clicking away does.
  useEffect(() => {
    if (collapsed && editing) save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  const hasBody = body.trim().length > 0;
  const subtitle = note ? "Carries over · changes remembered" : "A running daily note";
  const collapsedSummary = hasBody ? firstLineSummary(body) : note ? "Empty note" : subtitle;

  return (
    <section
      className={`flex flex-col rounded-2xl border border-[var(--veil-soft)] bg-[var(--wash)] p-3 ${
        collapsed ? "" : "min-h-[220px]"
      }`}
      style={{ borderLeft: "2px solid var(--past)" }}
    >
      <div className="mb-3 flex items-start justify-between gap-2 px-1.5 pt-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          className="flex min-w-0 items-start gap-1.5 rounded text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--now)]"
        >
          <Chevron collapsed={collapsed} />
          <span className="min-w-0">
            <h2 className="font-display text-[15px] font-medium tracking-tight text-[var(--text-hi)]">
              Note
            </h2>
            <p className="mt-0.5 truncate text-[11px] leading-tight text-[var(--text-lo)]">
              {collapsed ? collapsedSummary : subtitle}
            </p>
          </span>
        </button>
        {!collapsed && note && hasBody && (
          <button
            onClick={() => (editing ? save() : setEditing(true))}
            className="shrink-0 text-[11px] text-[var(--text-lo)] transition-colors hover:text-[var(--text-mid)]"
          >
            {editing ? "Preview" : "Edit ✎"}
          </button>
        )}
      </div>

      <div
        className={`wm-collapsible flex-1 ${collapsed ? "is-collapsed" : ""}`}
        aria-hidden={collapsed}
      >
        <div className="wm-collapsible__inner flex h-full flex-col">
          {note ? (
            editing || !hasBody ? (
              <textarea
                ref={taRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onFocus={() => setEditing(true)}
                onBlur={save}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Today's note… — markdown supported (carries over; start a new one each day)"
                className="min-h-[160px] flex-1 resize-none rounded-lg border border-[var(--veil-soft)] bg-[var(--bg-0)] px-3 py-2.5 text-sm leading-relaxed text-[var(--text-hi)] placeholder:text-[var(--text-lo)] focus:border-[var(--now)] focus:outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                title="Click to edit"
                className="min-h-[160px] flex-1 rounded-lg border border-[var(--veil-soft)] bg-[var(--bg-0)] px-3 py-2.5 text-left transition-colors hover:border-[var(--veil)]"
              >
                <Markdown source={body} />
              </button>
            )
          ) : (
            <button
              onClick={startNote}
              className="mt-1 flex flex-1 items-center justify-center rounded-lg border border-dashed border-[var(--veil)] text-sm text-[var(--text-lo)] hover:border-[var(--now)] hover:text-[var(--text-mid)]"
            >
              + Start a note
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
