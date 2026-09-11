"use client";

import dynamic from "next/dynamic";
import type { BoardItemAt } from "@/lib/timetravel";
import { Chevron } from "./Sheet";

// A past card, read-only. Mirrors SnapshotCardPanel.tsx's shape (title · details ·
// sub-cards, nothing editable) as its own small overlay ON TOP of the time-travel
// sheet — Vaul sheets don't nest cleanly, and this one never needs to drag or snap,
// only to sit still and be dismissed. z-index 70 clears the sheet's own 61 (see the
// `/* phone sheets */` block in globals.css).
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

  return (
    <div
      // `wm-ph-snapcard` is what pays for the notch and the home indicator. This is the
      // one overlay in the phone app that covers the whole DEVICE: an ordinary sheet is
      // a shorter bottom-anchored box whose head sits well clear of the status bar and
      // whose `.wm-sheet__bar` absorbs the bottom inset, and this has neither. See the
      // rule beside `.wm-ph-snap-badge` in globals.css.
      className="card-in wm-ph-snapcard"
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
          <p className="wm-ph-title wm-ph-clamp2">{item.text}</p>
          <p className="wm-ph-caption" style={{ marginTop: 3 }}>
            {listLabels[item.list] ?? item.list}
          </p>
        </div>
        <span className="wm-ph-snap-badge">{item.done ? "Was done" : "Was open"}</span>
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
          <p className="wm-ph-hint">— no details then —</p>
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
              <li key={child.id} className="wm-ph-past">
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
          <p className="wm-ph-hint">— none then —</p>
        )}

        <p className="wm-ph-hint" style={{ marginTop: 24 }}>
          As it was{asOf ? ` · ${new Date(asOf).toLocaleString()}` : ""} · read-only
        </p>
      </div>
    </div>
  );
}
