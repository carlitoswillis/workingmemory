"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useTransition } from "react";
import { createNoteAction, editDetailsAction } from "@/app/actions";
import { usePhoneUI } from "./PhoneShell";
import { Sheet, useSheetOpen } from "./Sheet";
import { findNote, usePhoneBoardData } from "./phone-data";

// The daily note, on the phone: a full-height editor in a sheet. Its own component
// reading the same row the desktop NoteColumn reads — the one pinned, unarchived,
// top-level item on the `note` sentinel list, body in `details` — rather than
// importing that file, which belongs to another worktree (§10).
//
// Same model as the desktop note, so the two can't disagree about what a note is:
// ONE row that carries over day to day, edited into `details`, every version
// journaled by the details trigger. There is no "new note" button because there is
// no such thing as a second note.
//
// Phone-specific: markdown at rest, raw textarea while editing, and the Save control
// in the sheet's bottom bar above the keyboard rather than a blur-to-save you can't
// see. Blur still saves — a phone loses focus in ways a desktop doesn't (the app
// backgrounding, a call) and losing a paragraph to that would be unforgivable.

const Markdown = dynamic(() => import("../Markdown"), {
  ssr: true,
  loading: () => <span className="wm-ph-hint">rendering…</span>,
});

export default function PhoneNote() {
  const { close } = usePhoneUI();
  const { open, dismiss } = useSheetOpen();
  const { boardId, items, loading, refresh } = usePhoneBoardData();
  const note = findNote(items);

  const [body, setBody] = useState(note?.details ?? "");
  const [editing, setEditing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [, startTransition] = useTransition();

  useEffect(() => setBody(note?.details ?? ""), [note?.id, note?.details]);
  useEffect(() => {
    if (editing) taRef.current?.focus();
  }, [editing]);

  const hasBody = body.trim().length > 0;
  const dirty = !!note && body !== (note.details ?? "");

  function save() {
    setEditing(false);
    if (!note || !dirty) return;
    startTransition(() => {
      editDetailsAction(boardId, note.id, body);
      refresh();
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (o) return;
        save();
        close();
      }}
      label="Daily note"
      heightSvh={96}
      // An empty note is nothing but an editor, so open straight into it — the one
      // case where a sheet may take the keyboard without being asked.
      onOpenComplete={() => {
        if (note && !hasBody) setEditing(true);
      }}
    >
      <div className="wm-sheet__head" style={{ flexDirection: "column", gap: 2 }}>
        <p className="wm-ph-title">Note</p>
        <p className="wm-ph-caption">Carries over · changes remembered</p>
      </div>

      <div className="wm-sheet__scroll">
        {!note ? (
          <button
            type="button"
            className="wm-ph-btn"
            disabled={loading}
            onClick={() =>
              startTransition(() => {
                createNoteAction(boardId);
                refresh();
              })
            }
          >
            {loading ? "Loading…" : "Start a note"}
          </button>
        ) : editing || !hasBody ? (
          <textarea
            ref={taRef}
            className="wm-ph-field"
            style={{ minHeight: "45svh" }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={save}
            placeholder="Today's note… — markdown supported (carries over; start a new one each day)"
            aria-label="Daily note"
          />
        ) : (
          <button
            type="button"
            className="wm-ph-card"
            style={{ display: "block", width: "100%", textAlign: "left", minHeight: "45svh" }}
            onClick={() => setEditing(true)}
            aria-label="Edit the note"
          >
            <Markdown source={body} />
          </button>
        )}
      </div>

      {note && (
        <div className="wm-sheet__bar">
          <button
            type="button"
            className="wm-ph-btn wm-ph-btn--auto"
            onClick={() => (editing ? save() : setEditing(true))}
          >
            {editing ? "Preview" : "Edit"}
          </button>
          <button
            type="button"
            className="wm-ph-btn wm-ph-btn--primary"
            onClick={() => {
              save();
              dismiss();
            }}
          >
            Done
          </button>
        </div>
      )}
    </Sheet>
  );
}
