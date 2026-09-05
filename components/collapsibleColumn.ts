// Shared, JSX-free logic behind the collapsible Weekly-review / Note columns
// (components/ReviewColumn.tsx, components/NoteColumn.tsx). Split out of those
// .tsx files — and kept free of JSX — so it can be covered by a plain
// `node components/collapsibleColumn.test.ts`, same convention as lib/*.test.ts:
// Node's built-in TypeScript support strips types from .ts files but does not
// know the .tsx extension at all, so anything worth unit-testing here has to
// live outside the component files.

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export type CollapsibleKind = "review" | "note";

// Per board, per column: a note collapsed on one board says nothing about
// another, and local/demo mode (boardId === null) gets its own bucket.
export function collapseStorageKey(boardId: string | null, kind: CollapsibleKind): string {
  return `wm:collapsed:${boardId ?? "local"}:${kind}`;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // private-mode / storage-disabled browsers throw on access
  }
}

export function readStoredCollapsed(boardId: string | null, kind: CollapsibleKind): boolean | null {
  const store = safeLocalStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(collapseStorageKey(boardId, kind));
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function writeStoredCollapsed(boardId: string | null, kind: CollapsibleKind, collapsed: boolean): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(collapseStorageKey(boardId, kind), collapsed ? "1" : "0");
  } catch {
    // quota / private mode — collapsing still works this session, it just won't stick
  }
}

// Phone breakpoint mirrors Board.tsx's RAIL (`sm:` = 640px): below it these two
// columns push the real lists out of view, so they default collapsed there.
export function isPhoneViewport(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
  } catch {
    return false;
  }
}

// "Week of Aug 24–31" / "Week of Aug 30–Sep 5" / "…, 2025" once it's not this
// year — derived from the review's generation date since the item carries no
// explicit range. Mirrors weekly-review.mjs's default trailing 7-day window.
export function reviewWeekLabel(updatedAtIso: string, now: Date = new Date()): string {
  const to = new Date(updatedAtIso);
  if (Number.isNaN(to.getTime())) return "Weekly review";
  const from = new Date(to.getTime() - 7 * 86400000);
  const yearSuffix = to.getFullYear() === now.getFullYear() ? "" : `, ${to.getFullYear()}`;
  const fromMonth = from.toLocaleDateString(undefined, { month: "short" });
  const toMonth = to.toLocaleDateString(undefined, { month: "short" });
  const range =
    fromMonth === toMonth
      ? `${fromMonth} ${from.getDate()}–${to.getDate()}`
      : `${fromMonth} ${from.getDate()}–${toMonth} ${to.getDate()}`;
  return `Week of ${range}${yearSuffix}`;
}

// First non-empty line of the note, lightly stripped of markdown markers,
// truncated for the collapsed header's one-liner.
export function firstLineSummary(text: string, maxLen = 60): string {
  const line = (text.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
  const stripped = line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "");
  if (stripped.length <= maxLen) return stripped;
  return `${stripped.slice(0, maxLen - 1).trimEnd()}…`;
}

// useLayoutEffect does nothing on the server (and warns there) — fall back to
// useEffect when rendering off the client so SSR stays quiet.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Shared by both columns: resolves to the stored per-board choice if one
// exists, else falls back to viewport (collapsed on phone, expanded on
// desktop) on first visit. Starts `false` (expanded) so the server render and
// the first client render match, then a layout effect corrects it — before
// paint — so there's no visible flash once hydrated.
export function useCollapsibleColumn(boardId: string | null, kind: CollapsibleKind) {
  const [collapsed, setCollapsed] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const stored = readStoredCollapsed(boardId, kind);
    setCollapsed(stored ?? isPhoneViewport());
    // boardId/kind identify *which* stored value to read; re-run if either changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, kind]);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeStoredCollapsed(boardId, kind, next);
      return next;
    });
  }, [boardId, kind]);

  return { collapsed, toggle };
}
