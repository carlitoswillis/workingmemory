"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { usePhoneUI, type PhoneSheet } from "./PhoneShell";
import { Sheet } from "./Sheet";
import {
  readInstallState,
  rememberInstallDismissed,
  shouldOfferInstall,
} from "./installPrompt.ts";

// More (§2 F): the drawer of everything that isn't Now, Lists, capture or Find —
// Review, Note, Boards, Time travel — plus the settings a phone actually has.
//
// Each row swaps `PhoneUI.sheet` to another kind rather than nesting a sheet inside
// this one. Stacked Vaul drawers work, but the back-gesture then has two overlapping
// notions of "one level up", and this is exactly the app where that has to be
// unambiguous.
//
// Notifications live in PushSettings, which belongs to the Web Push package and is
// loaded here client-side. Until that lands the stub renders nothing, so this sheet
// is complete either way and the merge is a file swap, not an edit.

const PushSettings = dynamic(() => import("./PushSettings"), { ssr: false });

const ROWS: { kind: PhoneSheet["kind"]; label: string; hint: string }[] = [
  { kind: "review", label: "Weekly review", hint: "Written from your history" },
  { kind: "note", label: "Note", hint: "Carries over, day to day" },
  { kind: "time", label: "Time travel", hint: "The board as it was" },
  { kind: "boards", label: "Boards", hint: "Switch board" },
];

export default function PhoneMore() {
  const { close, open } = usePhoneUI();

  // The install card is decided on the client only: matchMedia and
  // navigator.standalone don't exist on the server, and rendering the card and then
  // hiding it on hydration is a flash of advice the reader may not need.
  const [offerInstall, setOfferInstall] = useState(false);
  useEffect(() => setOfferInstall(shouldOfferInstall(readInstallState())), []);

  return (
    <Sheet open onOpenChange={(o) => !o && close()} label="More" heightSvh={72}>
      <div className="wm-sheet__head">
        <p className="wm-ph-title" style={{ flex: 1 }}>
          More
        </p>
      </div>

      <div className="wm-sheet__scroll">
        <ul>
          {ROWS.map((r) => (
            <li key={r.kind}>
              <button
                type="button"
                className="wm-ph-row"
                onClick={() => open({ kind: r.kind } as PhoneSheet)}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="wm-ph-body" style={{ display: "block" }}>
                    {r.label}
                  </span>
                  <span className="wm-ph-caption" style={{ display: "block" }}>
                    {r.hint}
                  </span>
                </span>
                <span aria-hidden style={{ color: "var(--text-lo)" }}>
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p className="wm-ph-caption" style={{ marginTop: 18 }}>
          Settings
        </p>

        {/* Notifications. Owned by the Web Push package; renders nothing until it
            lands. Whatever it renders, the permission request happens inside a click
            handler and nowhere else. */}
        <PushSettings />

        {offerInstall && (
          <div className="wm-ph-card" style={{ marginTop: 10 }}>
            <p className="wm-ph-title">Put this on your home screen</p>
            <p className="wm-ph-hint" style={{ marginTop: 6 }}>
              Installed, it opens without Safari&apos;s bars, keeps its own place in
              the app switcher, and is the only way iOS will let it send you anything.
            </p>
            <ol
              className="wm-ph-hint"
              style={{ marginTop: 8, paddingLeft: 18, listStyle: "decimal" }}
            >
              <li>
                Tap <strong style={{ color: "var(--text-mid)" }}>Share</strong> — the
                square with an arrow out of it, in Safari&apos;s bottom bar.
              </li>
              <li>
                Scroll to{" "}
                <strong style={{ color: "var(--text-mid)" }}>Add to Home Screen</strong>.
              </li>
              <li>
                Tap <strong style={{ color: "var(--text-mid)" }}>Add</strong>, then open
                it from the home screen rather than from Safari.
              </li>
            </ol>
            <p className="wm-ph-caption" style={{ marginTop: 8 }}>
              iOS gives web apps no install button, so this is genuinely the whole
              procedure — there is nothing here to press.
            </p>
            <button
              type="button"
              className="wm-ph-btn"
              style={{ marginTop: 10 }}
              onClick={() => {
                rememberInstallDismissed();
                setOfferInstall(false);
              }}
            >
              Don&apos;t show this again
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
