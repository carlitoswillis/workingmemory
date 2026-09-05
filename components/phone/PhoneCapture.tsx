"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { addItemAction } from "@/app/actions";
import { DEFAULT_LISTS } from "@/lib/lists";
import { usePhoneUI } from "./PhoneShell";
import { Sheet } from "./Sheet";
import { movableLists, usePhoneBoardData } from "./phone-data";

// Capture (§2 C). One job: write a thought down and get out of the way. A single
// snap, one textarea, a list chooser, and a Save control in the sheet's own bottom
// bar — which is the whole reason `--kb` exists. The sheet is bottom-anchored, so the
// keyboard inset applied as padding-bottom lifts the bar above the keys instead of
// leaving it buried under them.
//
// Focus lands on the textarea from Vaul's open-COMPLETE callback, not on mount (§4):
// focusing on mount starts the keyboard animation while the sheet is still moving,
// and the two fight each other on iOS.
//
// The default list is Brain Dump — "capture now, sort later" is what this surface is
// for, and it's the one default a phone should never make you re-pick. Where the
// shell asks for a specific list (the ＋ pressed from inside a list page), that wins.

const BRAIN_DUMP = "braindump";

export default function PhoneCapture({ listId }: { listId?: string }) {
  const { close } = usePhoneUI();
  const { boardId, lists, refresh } = usePhoneBoardData();
  const [text, setText] = useState("");
  const [, startTransition] = useTransition();
  const taRef = useRef<HTMLTextAreaElement>(null);

  const columns = useMemo(() => movableLists(lists), [lists]);

  // Brain Dump by default; then whatever the shell asked for; then the first column
  // this board actually has (a board whose Brain Dump was deleted still captures).
  const fallback =
    columns.find((l) => l.id === BRAIN_DUMP)?.id ??
    columns.find((l) => l.label === DEFAULT_LISTS[4].label)?.id ??
    columns[0]?.id ??
    BRAIN_DUMP;
  const [target, setTarget] = useState<string>(listId ?? fallback);

  const canSave = text.trim().length > 0;

  function save() {
    const t = text.trim();
    if (!t) return;
    setText("");
    close();
    startTransition(() => {
      addItemAction(boardId, t, target);
      refresh();
    });
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && close()}
      label="Capture a thought"
      // No fixed height: the box is sized by `.wm-sheet--capture`, whose min-height
      // INCLUDES the keyboard inset. A bottom-anchored box grows upward, so the sheet
      // rises with the keyboard instead of having its content squeezed out by it.
      className="wm-sheet--capture"
      onOpenComplete={() => taRef.current?.focus()}
    >
      <div className="wm-sheet__head">
        <p className="wm-ph-title" style={{ flex: 1 }}>
          Capture
        </p>
      </div>

      <div className="wm-sheet__scroll">
        <textarea
          ref={taRef}
          className="wm-ph-field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's on your mind?"
          aria-label="What's on your mind?"
          // ⌘/Ctrl-Enter is the desktop reflex; a hardware keyboard on an iPad
          // should not need the mouse-equivalent of a Save button.
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
        />

        <div
          className="wm-ph-chips"
          style={{ marginTop: 12 }}
          role="radiogroup"
          aria-label="Which list"
        >
          {columns.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={target === l.id}
              className="wm-ph-chip"
              onClick={() => setTarget(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* The bar the whole sheet is arranged around: always the last thing above the
          keyboard, never behind it. */}
      <div className="wm-sheet__bar">
        <button type="button" className="wm-ph-btn wm-ph-btn--auto" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="wm-ph-btn wm-ph-btn--primary"
          onClick={save}
          disabled={!canSave}
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}
