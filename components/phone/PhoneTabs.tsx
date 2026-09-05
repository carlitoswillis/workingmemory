"use client";

import { usePhoneUI } from "./PhoneShell";

// The bottom bar: Now, Lists, capture, Find, More. Five slots, every one a 44pt
// target, and capture is a SLOT rather than a floating circle — a FAB occludes the
// last row of the feed and needs its own safe-area maths (spec §2, §9).
//
// The bar is fixed to the bottom of the shell with
// `padding-bottom: max(10px, env(safe-area-inset-bottom))` (see the `/* phone shell */`
// block in globals.css), which is only a real number when the document opted into
// `viewport-fit=cover` — package B adds that in app/layout.tsx.

type Slot = {
  key: string;
  label: string;
  tab?: "now" | "lists" | "find" | "more";
  glyph: React.ReactNode;
};

function NowGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="phone-tab__glyph" aria-hidden>
      <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 6.2V10l2.6 1.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function ListsGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="phone-tab__glyph" aria-hidden>
      <path
        d="M3.4 5.6h13.2M3.4 10h13.2M3.4 14.4h8.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
// Two strokes have to hold their own against glyphs built from four or five, so the
// plus is the one that carries extra weight — not extra colour. Capture is a slot like
// any other slot.
function PlusGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="phone-tab__glyph" aria-hidden>
      <path d="M10 4.4v11.2M4.4 10h11.2" fill="none" stroke="currentColor" strokeWidth="2.0" strokeLinecap="round" />
    </svg>
  );
}
function FindGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="phone-tab__glyph" aria-hidden>
      <circle cx="8.8" cy="8.8" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12.6 12.6L16.4 16.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function MoreGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="phone-tab__glyph" aria-hidden>
      <circle cx="4.8" cy="10" r="1.5" fill="currentColor" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" />
      <circle cx="15.2" cy="10" r="1.5" fill="currentColor" />
    </svg>
  );
}

export default function PhoneTabs() {
  const ui = usePhoneUI();

  const slots: Slot[] = [
    { key: "now", label: "Now", tab: "now", glyph: <NowGlyph /> },
    { key: "lists", label: "Lists", tab: "lists", glyph: <ListsGlyph /> },
    { key: "capture", label: "Capture", glyph: <PlusGlyph /> },
    { key: "find", label: "Find", tab: "find", glyph: <FindGlyph /> },
    { key: "more", label: "More", tab: "more", glyph: <MoreGlyph /> },
  ];

  function activate(slot: Slot) {
    if (slot.key === "capture") {
      // Capture defaults to Brain Dump; the sheet's own chooser can move it. Leaving
      // listId undefined lets package B pick that default in one place.
      ui.open({ kind: "capture" });
      return;
    }
    if (slot.key === "find") {
      ui.setTab("find");
      ui.open({ kind: "search" });
      return;
    }
    if (slot.key === "more") {
      ui.setTab("more");
      ui.open({ kind: "more" });
      return;
    }
    if (ui.sheet) ui.close();
    ui.setTab(slot.tab!);
  }

  return (
    <nav className="phone-tabs" aria-label="Primary">
      {slots.map((slot) => {
        const current = slot.tab != null && ui.tab === slot.tab;
        return (
          <button
            key={slot.key}
            type="button"
            onClick={() => activate(slot)}
            aria-current={current ? "page" : undefined}
            aria-label={slot.key === "capture" ? "Capture a thought" : slot.label}
            className={`phone-tab${current ? " is-current" : ""}`}
          >
            {slot.glyph}
            <span className="phone-tab__label">{slot.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
