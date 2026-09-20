"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The one footer string, the one date format — the same sentence the desktop's
// past card ends on.
const fmtMoment = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
import dynamic from "next/dynamic";
import type { BoardItemAt } from "@/lib/timetravel";
import { Chevron } from "./Sheet";

// A past card, read-only. Mirrors SnapshotCardPanel.tsx's shape (title · details ·
// sub-cards, nothing editable) as its own small overlay ON TOP of the time-travel
// sheet — Vaul sheets don't nest cleanly, and this one never needs to drag or snap,
// only to sit still and be dismissed. z-index 70 clears the sheet's own 61 (see the
// `/* phone sheets */` block in globals.css).
//
// IT IS PORTALLED TO <body>, like the sheets themselves, and it has to be. Rendered
// where it sits in the tree it is a child of Vaul's drawer, and vaul puts
// `will-change: transform` on that box — which makes the drawer the CONTAINING BLOCK
// for any `position: fixed` descendant. `inset: 0` then means "the drawer", not "the
// screen", so a card meant to cover the device was cropped to the sheet: its head
// started 4svh down, and on a snapped sheet it would have been translated off the
// bottom edge along with the drawer. Out here `inset: 0` is the viewport again, and
// `.wm-ph-snapcard` pays the safe-area insets itself (globals.css) because nothing
// above it does.
//
// LEAVING THE DRAWER COSTS TWO THINGS, AND BOTH ARE PAID HERE. One is pointer events:
// Radix puts `pointer-events: none` on <body> while a dialog is open, and
// `.wm-ph-snapcard { pointer-events: auto }` (globals.css) hands them back. The other
// is SCROLLING. Vaul's overlay is a Radix dialog overlay, which wraps its subtree in
// react-remove-scroll with the drawer as the only shard; that sidecar puts a
// non-passive `touchmove`/`wheel` listener on `document` and calls preventDefault on
// every one of them whose target is neither inside the overlay nor inside a shard.
// Out here we are neither — a sibling of both under <body> — so the card's own
// scroller was dead: on a past card longer than the screen, the details and the
// sub-cards below the fold could not be reached. The effect below keeps those events
// from ever reaching the document listener. It is a native, non-passive listener on
// the card's own root because that is the layer the lock listens above.
const Markdown = dynamic(() => import("../Markdown"), {
  ssr: false,
  loading: () => <span className="wm-ph-hint">rendering…</span>,
});

export default function PhoneSnapshotCard({
  item,
  parent,
  listLabels,
  childItems,
  asOf,
  onOpenCard,
  onClose,
}: {
  item: BoardItemAt;
  parent: BoardItemAt | null;
  listLabels: Record<string, string>;
  childItems: BoardItemAt[];
  asOf: string | null;
  onOpenCard: (id: string) => void;
  onClose: () => void;
}) {
  const hasDetails = item.details.trim().length > 0;

  // The portal target, taken after mount so the server render and the first client
  // render agree (there is no document during SSR, and this component is only ever
  // rendered inside an already-open sheet, so one extra frame costs nothing).
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);

  // See the note above the component: the scroll lock around the sheet cancels every
  // touchmove and wheel that starts out here. Stop them at the card instead, so the
  // lock's document listener never sees the ones that belong to this scroller.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener("touchmove", stop, { passive: false });
    el.addEventListener("wheel", stop, { passive: false });
    return () => {
      el.removeEventListener("touchmove", stop);
      el.removeEventListener("wheel", stop);
    };
  }, [host]);

  if (!host) return null;

  return createPortal(
    <div
      // `wm-ph-snapcard` is what pays for the notch and the home indicator. This is the
      // one overlay in the phone app that covers the whole DEVICE: an ordinary sheet is
      // a shorter bottom-anchored box whose head sits well clear of the status bar and
      // whose `.wm-sheet__bar` absorbs the bottom inset, and this has neither. See the
      // rule beside `.wm-ph-snap-badge` in globals.css.
      className="card-in wm-ph-snapcard"
      ref={rootRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-1)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label={item.text}
    >
      <div className="wm-sheet__head">
        {parent && (
          <button
            type="button"
            className="wm-ph-back"
            aria-label={`Back to ${parent.text}`}
            onClick={() => onOpenCard(parent.id)}
          >
            <Chevron dir="left" />
          </button>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          {parent && <p className="wm-ph-parent wm-ph-clamp2">{parent.text}</p>}
          <p className="wm-ph-snaptitle wm-ph-clamp2">{item.text}</p>
          <p className="wm-ph-caption" style={{ marginTop: 3 }}>
            {listLabels[item.list] ?? item.list}
          </p>
        </div>
        <span className="wm-ph-snap-badge">
          {asOf ? (item.done ? "Was done" : "Was open") : item.done ? "Done" : "Open"}
        </span>
        <button type="button" className="wm-ph-tap" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden focusable="false">
            <path
              d="M4 4l8 8M12 4l-8 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="wm-sheet__scroll">
        <p className="wm-ph-sect" style={{ padding: "0 0 6px" }}>
          Details
        </p>
        {hasDetails ? (
          <div className="wm-ph-details-preview" style={{ borderBottom: "none" }}>
            <Markdown source={item.details} />
          </div>
        ) : (
          <p className="wm-ph-then-line" style={{ marginTop: 0 }}>{asOf ? "— no details then —" : "— no details —"}</p>
        )}

        <p className="wm-ph-sect" style={{ padding: "18px 0 6px" }}>
          Sub-cards
          {childItems.length > 0 && (
            <span className="wm-ph-num" style={{ color: "var(--text-lo)" }}>
              {" "}
              {childItems.length}
            </span>
          )}
        </p>
        {childItems.length > 0 ? (
          <ul style={{ marginLeft: -16, marginRight: -16 }}>
            {childItems.map((child) => (
              <li key={child.id} className={`wm-ph-past${asOf ? " wm-ph-past--then" : ""}`}>
                <button
                  type="button"
                  onClick={() => onOpenCard(child.id)}
                  style={{ display: "block", width: "100%", textAlign: "left" }}
                >
                  <p
                    className="wm-ph-body wm-ph-clamp2"
                    style={child.done ? { color: "var(--text-lo)" } : undefined}
                  >
                    {child.text}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="wm-ph-then-line" style={{ marginTop: 0 }}>{asOf ? "— none then —" : "— none —"}</p>
        )}

        {/* Past tense only when there is a past: at thumb = now this card is the
            live card, read-only because the sheet is. */}
        <p className="wm-ph-footnote">
          {asOf ? (
            <>
              As it was · <span className="wm-ph-footnote__moment">{fmtMoment(asOf)}</span> ·
              read-only
            </>
          ) : (
            <>As it is · read-only</>
          )}
        </p>
      </div>
    </div>,
    host,
  );
}
