"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer } from "vaul";
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
// Heights are in `svh`, never `vh` (§9). See the `/* phone sheets */` block in
// app/globals.css for the box itself.

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

  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
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
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="wm-sheet__overlay" />
        <Drawer.Content
          className={`wm-sheet ${className}`}
          style={heightSvh && !snapPoints ? { height: `${heightSvh}svh` } : undefined}
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
 * The single mount point for every phone sheet. `PhoneShell` renders exactly this and
 * nothing else about overlays; which sheet is up is `PhoneUI.sheet` and nothing more.
 * Returns null when no sheet is open, so the phone tree costs nothing at rest.
 */
export function PhoneSheetHost() {
  const { sheet, close } = usePhoneUI();

  // Vaul unmounts on close, but its exit animation needs the content to stay mounted
  // for a frame; keep the last sheet around while `open` falls to false.
  const last = useRef(sheet);
  if (sheet) last.current = sheet;

  if (!sheet) return null;
  // Sheets land in the commits that follow; this file's job in commit 1 is the
  // `Sheet` wrapper above, which unblocks package A.
  void close;
  return null;
}

export default Sheet;
