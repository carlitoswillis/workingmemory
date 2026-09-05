"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer } from "vaul";
import PhoneBoards from "./PhoneBoards";
import PhoneCapture from "./PhoneCapture";
import PhoneCardSheet from "./PhoneCardSheet";
import PhoneMore from "./PhoneMore";
import PhoneNote from "./PhoneNote";
import PhoneReview from "./PhoneReview";
import PhoneSearch from "./PhoneSearch";
import PhoneTimeTravel from "./PhoneTimeTravel";
import { usePhoneUI } from "./PhoneShell";
import type { SnapPoint } from "./sheetSnaps.ts";

// Every overlay in the phone app is one of these (spec §4). Vaul rides Radix Dialog,
// so `role="dialog"`, `aria-modal="true"`, the focus trap, Escape-to-close, and the
// body scroll lock all come from the primitive — there is deliberately no hand-rolled
// trap and no `overflow:hidden` written anywhere in this package.
//
// What this wrapper adds on top of Vaul:
//   - a visually-hidden <Drawer.Title> so the dialog always has an accessible name
//     (Radix warns without one, and a sheet announced as "dialog" and nothing else is
//     useless with VoiceOver);
//   - `onOpenComplete`, fired off Vaul's open/close animation-end callback — the ONLY
//     place a sheet may move focus into a field, so the sheet and the keyboard never
//     animate at the same time (§4);
//   - the `--kb` keyboard inset as padding-bottom on the sheet box, which (because the
//     sheet is bottom-anchored) lifts its contents clear of the on-screen keyboard;
//   - `scrollLockTimeout={100}`: Vaul's own rule that a downward drag only closes the
//     sheet from `scrollTop === 0`, re-armed 100ms after the inner scroller stops.
//
// Heights are in `svh`, never `vh` (§9), and clamped to `--vvh` — the live visual
// viewport height — so a sheet SHRINKS with the keyboard instead of being pushed off
// the top of the screen. See the `/* phone sheets */` block in app/globals.css.

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Vaul snap points. Only the card sheet needs them; the rest size in `svh`. */
  snapPoints?: SnapPoint[];
  /** The dialog's accessible name. */
  label: string;
  children?: React.ReactNode;
  /** Height when there are no snap points, as an `svh` percentage. */
  heightSvh?: number;
  activeSnapPoint?: SnapPoint | null;
  onSnapPointChange?: (p: SnapPoint | null) => void;
  /** Fired when the OPEN animation has finished — where autofocus belongs. */
  onOpenComplete?: () => void;
  /** Extra class on the sheet box (e.g. a per-sheet layout). */
  className?: string;
  /** Show the drag handle. Off for sheets whose own header is the grab area. */
  handle?: boolean;
};

export function Sheet({
  open,
  onOpenChange,
  snapPoints,
  label,
  children,
  heightSvh,
  activeSnapPoint,
  onSnapPointChange,
  onOpenComplete,
  className = "",
  handle = true,
}: SheetProps) {
  // Vaul wants a controlled pair when snap points are used; hold our own when the
  // caller doesn't care which snap is active.
  const [ownSnap, setOwnSnap] = useState<SnapPoint | null>(snapPoints?.[0] ?? null);
  const snap = activeSnapPoint !== undefined ? activeSnapPoint : ownSnap;
  const setSnap = onSnapPointChange ?? setOwnSnap;

  // Re-arm the peek snap each time the sheet opens, so a card that was left expanded
  // doesn't reopen expanded.
  useEffect(() => {
    if (open && snapPoints && activeSnapPoint === undefined) setOwnSnap(snapPoints[0] ?? null);
  }, [open, snapPoints, activeSnapPoint]);

  // The sheet is mounted only while it's the active sheet, so `open` arrives already
  // true. Two things go wrong if that's handed straight to Vaul: the OPEN animation
  // never plays (the drawer's first render is its final state), and the CLOSE never
  // plays either, because the host unmounts the moment the app's state changes —
  // which also robs Radix of the unmount it restores focus during, dumping focus on
  // <body> instead of back on the control that opened the sheet.
  //
  // So the visual state is held here: false on the first render, true a tick later,
  // and the caller isn't told about a close until the exit animation has finished
  // and Radix has put focus back. `shown` is the animation; `open` is the intent.
  const [shown, setShown] = useState(false);
  const hasOpened = useRef(false);
  useEffect(() => {
    if (open) hasOpened.current = true;
    setShown(open);
  }, [open]);

  // Who to give focus back to. Radix returns focus to its own <Dialog.Trigger>, and
  // these sheets have none — they're opened from the tab bar through app state, not
  // from a trigger Radix ever saw. Left alone it calls focus() on a null trigger and
  // focus lands on <body>, which strands a keyboard or VoiceOver user at the top of
  // the page after every Escape. So remember what was focused when the sheet went up
  // and hand it back on the way out.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.activeElement;
    opener.current = el instanceof HTMLElement ? el : null;
  }, []);

  return (
    <Drawer.Root
      open={shown}
      onOpenChange={(next) => {
        // Vaul's own dismissals (Escape, the overlay, a drag past the threshold)
        // start the exit animation; the caller hears about it below.
        if (!next) setShown(false);
      }}
      snapPoints={snapPoints as (number | string)[] | undefined}
      activeSnapPoint={snapPoints ? snap : undefined}
      setActiveSnapPoint={snapPoints ? setSnap : undefined}
      // Each snap is a real state (peek vs. full), so a fast flick must not skip one.
      snapToSequentialPoint
      // Vaul's own "don't close while the inner list is scrolled" rule (§4).
      scrollLockTimeout={100}
      // Radix moves focus into the sheet on open; the caller then moves it to the
      // right field on open-COMPLETE. Without this Vaul leaves focus on the trigger
      // and the sheet is unreachable from the keyboard / VoiceOver.
      autoFocus
      onAnimationEnd={(isOpen) => {
        if (isOpen) onOpenComplete?.();
        else if (hasOpened.current) onOpenChange(false);
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="wm-sheet__overlay" />
        <Drawer.Content
          // With snap points the sheet box is the WHOLE window and Vaul translates
          // it down so only the active snap shows — that's how a px snap can be
          // exact. Without them the box is sized here, in svh.
          className={`wm-sheet ${snapPoints ? "wm-sheet--snapped" : ""} ${className}`}
          style={heightSvh && !snapPoints ? { height: `${heightSvh}svh` } : undefined}
          // Radix does NOT set aria-modal — it isolates the dialog with aria-hidden
          // on everything else plus a focus scope, which is the more robust mechanism
          // but leaves the attribute off. The app's dialogs are all announced as
          // modal, so state it. This is one attribute passed through the primitive,
          // not a second implementation of anything.
          aria-modal="true"
          // Radix composes this BEFORE its own handler and skips that one once we've
          // prevented the default, so this is the supported way to redirect the
          // return of focus — not a second focus implementation.
          onCloseAutoFocus={(e) => {
            const el = opener.current;
            if (el?.isConnected) {
              e.preventDefault();
              el.focus();
            }
          }}
          // We never render a Description; tell Radix so on purpose rather than
          // letting it warn on every open.
          aria-describedby={undefined}
        >
          <Drawer.Title className="wm-sr-only">{label}</Drawer.Title>
          {handle && <div className="wm-sheet__grip" aria-hidden />}
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/**
 * iOS Safari, on focusing a field inside a bottom sheet, scrolls the LAYOUT viewport
 * to "reveal" it — which on a 100dvh shell means the whole app slides up and the
 * field itself leaves the top of the screen while the visual viewport still shows the
 * content below it. That is exactly the reported bug: "the search opens up the
 * keyboard so the whole app is floated up, I can't see the entry box but can see some
 * results."
 *
 * Safari cannot be told not to do it, so it is undone: one frame after focus, scroll
 * the layout viewport back to 0, and pin it there for as long as the field is
 * focused. The sheet itself then tracks the keyboard through `--vvh`, which is a
 * resize over `--dur-kb` rather than a jump.
 *
 * Exported rather than baked into <Sheet> because the fields are the callers' own
 * elements; every field in every sheet binds this pair.
 */
export function onFieldFocus() {
  requestAnimationFrame(() => window.scrollTo(0, 0));
  document.documentElement.style.overflow = "hidden";
}

export function onFieldBlur() {
  document.documentElement.style.removeProperty("overflow");
}

/** Bind both at once: `<input {...fieldFocusProps()} />`. */
export function fieldFocusProps(): {
  onFocus: () => void;
  onBlur: () => void;
} {
  return { onFocus: onFieldFocus, onBlur: onFieldBlur };
}

/**
 * The app's one chevron. A `›` is a text glyph: it inherits the font's own weight,
 * sits on the baseline rather than on the row's optical centre, and changes shape
 * with the reader's font. Every leading and trailing arrow in the phone app is this
 * path instead, at the same 1.6 stroke as the check ring.
 */
export function Chevron({ dir = "right" }: { dir?: "right" | "left" | "up" }) {
  const rotate = dir === "left" ? 180 : dir === "up" ? -90 : 0;
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden focusable="false">
      <path
        d="M5.5 3.5L10.5 8l-5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={rotate ? `rotate(${rotate} 8 8)` : undefined}
      />
    </svg>
  );
}

/**
 * The two lines every sheet needs: `open` to hand to <Sheet>, and `dismiss()` for a
 * sheet closing itself (Save, Done, an archive that empties the card). Going through
 * `dismiss` rather than calling `PhoneUI.close()` directly is what lets the exit
 * animation play and lets Radix put focus back where it was — `close()` unmounts the
 * sheet on the spot, and neither happens.
 */
export function useSheetOpen(): { open: boolean; dismiss: () => void } {
  const [open, setOpen] = useState(true);
  return { open, dismiss: () => setOpen(false) };
}

/**
 * The single mount point for every phone sheet. `PhoneShell` renders exactly this and
 * nothing else about overlays; which sheet is up is `PhoneUI.sheet` and nothing more.
 * Returns null when no sheet is open, so the phone tree costs nothing at rest.
 *
 * Each sheet is keyed on its KIND and not on its subject: drilling from a card into
 * one of its sub-cards must keep the same sheet mounted, because that sheet owns the
 * history entries the back-gesture unwinds. Switching to a different kind remounts,
 * which is what we want — no sheet inherits another's state.
 */
export function PhoneSheetHost() {
  const { sheet } = usePhoneUI();
  if (!sheet) return null;

  switch (sheet.kind) {
    case "card":
      return <PhoneCardSheet key="card" itemId={sheet.itemId} />;
    case "capture":
      return <PhoneCapture key="capture" listId={sheet.listId} />;
    case "search":
      return <PhoneSearch key="search" />;
    case "boards":
      return <PhoneBoards key="boards" />;
    case "time":
      return <PhoneTimeTravel key="time" />;
    case "review":
      return <PhoneReview key="review" />;
    case "note":
      return <PhoneNote key="note" />;
    case "more":
      return <PhoneMore key="more" />;
  }
}

export default Sheet;
