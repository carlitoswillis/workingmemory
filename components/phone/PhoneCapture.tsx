"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addItemAction } from "@/app/actions";
import { DEFAULT_LISTS } from "@/lib/lists";
import { usePhoneUI } from "./PhoneShell";
import { Sheet, fieldFocusProps, useSheetOpen } from "./Sheet";
import { movableLists, usePhoneBoardData } from "./phone-data";

// Capture (§2 C). One job: write a thought down and get out of the way. A single
// snap, one textarea, a list chooser, and a Save control in the sheet's own bottom
// bar — which is the whole reason `--kb` exists. The sheet is bottom-anchored, and
// `.wm-sheet { bottom: var(--kb) }` stands the whole box on top of the keyboard, so
// the bar is the last thing above the keys instead of buried under them.
//
// It is NOT a form: no bordered box, no focus ring, no `Title` label over an obvious
// field. A caret on the sheet's own surface, a hairline under it, the lists, and the
// bar. The box is `height: auto` and the textarea takes the slack, so the sheet is
// the size of what you have written and there is no dead gap to explain.
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
  const { open, dismiss } = useSheetOpen();
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

  // Brain Dump is the LAST column, so on a phone the selected chip starts off the
  // right-hand edge of the strip and the sheet looks like it has no list chosen at
  // all. Scroll it into view once, on open.
  // (Keyed on the columns arriving, not on mount: under the fallback fetch there are
  // no chips yet on the first render. Once, though — after that the strip is the
  // reader's to scroll.)
  const chipsRef = useRef<HTMLDivElement>(null);
  const scrolledToTarget = useRef(false);
  useEffect(() => {
    if (scrolledToTarget.current || columns.length === 0) return;
    scrolledToTarget.current = true;
    // scrollLeft rather than scrollIntoView: the strip is inside a portal that is
    // still transforming while the sheet opens, and scrollIntoView either no-ops
    // against it or scrolls the wrong ancestor. One frame later, this is exact.
    const raf = requestAnimationFrame(() => {
      const strip = chipsRef.current;
      const sel = strip?.querySelector<HTMLElement>('[aria-checked="true"]');
      if (!strip || !sel) return;
      strip.scrollLeft = Math.max(
        0,
        sel.offsetLeft - (strip.clientWidth - sel.clientWidth) / 2,
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [columns.length]);

  const canSave = text.trim().length > 0;

  function save() {
    const t = text.trim();
    if (!t) return;
    setText("");
    dismiss();
    startTransition(() => {
      addItemAction(boardId, t, target);
      refresh();
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && close()}
      label="Capture a thought"
      // No fixed height: `.wm-sheet--capture` is `height: auto`, capped at the live
      // visual viewport. A bottom-anchored box grows upward, so the sheet rises with
      // the keyboard rather than having its content squeezed out by it — and because
      // the cap is `--vvh`, the keyboard resizes it over `--dur-kb` instead of
      // shoving it off the top.
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
          // Undo Safari's "reveal the field" layout scroll; see Sheet.tsx.
          {...fieldFocusProps()}
        />

        <div
          ref={chipsRef}
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
        {/* Cancel is a ghost: leaving is always available and never the point. */}
        <button
          type="button"
          className="wm-ph-btn wm-ph-btn--ghost wm-ph-btn--auto"
          onClick={dismiss}
        >
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
