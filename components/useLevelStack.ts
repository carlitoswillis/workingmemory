"use client";

import { useCallback, useEffect, useRef } from "react";

// ONE owner for every history entry a screen creates, so a back gesture has a single
// handler and a single bookkeeper. Each entry is a LEVEL, and every level carries the
// callback that undoes it — the browser, never us, decides when that callback runs.
//
// WHY THE COUNT IS IN A REF AND NEVER IN history.state. A server action's
// `revalidatePath` makes Next's App Router call `history.replaceState` with only its
// own router tree, so an entry we pushed can come back stateless at any moment.
// Anything that read our depth out of the CURRENT entry would then conclude "nothing
// open, depth 0" and unwind a stack the browser still holds — which is how one
// sub-card tap used to leave an installed PWA on a dead entry until relaunch (backlog
// A1), and the same bug the desktop panel's `wmDepth` had. We do still TAG each entry
// (`stateKey`), because the tag is the only way to know how far a jump we did not
// issue travelled; when the tag has been wiped the count is the answer, since a back
// gesture removes exactly one entry.
//
// Both shells use this: `components/phone/PhoneShell.tsx` (one level per open sheet
// plus one per sub-card drill-in) and `components/Board.tsx` (one level per open card
// panel). They pass DIFFERENT `stateKey`s and keep separate stacks, because both trees
// are mounted at once — a CSS switch at 768px picks which one is visible — and the
// handler of the stack that is at depth 0 must leave the other's entries alone.
//
// The regression guard is `scripts/dev/assert-phone-history.mjs`.

export type LevelStack = {
  /** Push one entry. `onPop` runs when the browser gives that entry back. */
  pushLevel(onPop: () => void): void;
  /** Step back `n` levels THROUGH the browser, running each level's undo on the way. */
  goBackLevels(n: number): void;
  /**
   * Give entries back down to `keep` levels WITHOUT running their undos — for when
   * whatever those undos would restore is already gone (a sheet that has been
   * replaced, a panel that has been closed). Still one `history.go`, so the browser
   * ends up exactly where the count says it is.
   */
  dropLevels(keep: number): void;
  /** How many levels this stack currently holds. */
  depth(): number;
};

export function useLevelStack(stateKey: string): LevelStack {
  const levelsRef = useRef<Array<() => void>>([]);
  // Where a history.go() WE issued is meant to land. Ours are the only jumps that can
  // cross more than one entry, so this is the whole of that ambiguity.
  const jumpRef = useRef<number | null>(null);
  const keyRef = useRef(stateKey);
  keyRef.current = stateKey;

  // Count a level ONLY once the browser has actually taken the entry. pushState is
  // refusable — every engine rate-limits it (roughly 100 calls per half-minute, a
  // per-document budget Next's own router.replaceState spends out of too), and
  // restricted contexts throw outright. Counting first and pushing second would leave
  // the ref claiming an entry the session history does not hold, and since every
  // `history.go(-n)` below is measured off this array, the next back gesture would
  // travel one entry past the page the app opened on — the dead entry this whole
  // owner exists to prevent. So: push, then record.
  const pushLevel = useCallback((onPop: () => void) => {
    if (typeof window === "undefined") return;
    try {
      window.history.pushState(
        { ...window.history.state, [keyRef.current]: levelsRef.current.length + 1 },
        "",
      );
    } catch {
      return; // history is best-effort; the screen still opens, just without an entry
    }
    levelsRef.current = [...levelsRef.current, onPop];
  }, []);

  const goToLevel = useCallback((target: number) => {
    const back = levelsRef.current.length - target;
    if (back <= 0 || typeof window === "undefined") return;
    jumpRef.current = target;
    try {
      window.history.go(-back);
    } catch {
      jumpRef.current = null;
    }
  }, []);

  const goBackLevels = useCallback(
    (n: number) => goToLevel(Math.max(0, levelsRef.current.length - n)),
    [goToLevel],
  );

  const dropLevels = useCallback((keep: number) => {
    const target = Math.max(0, keep);
    const back = levelsRef.current.length - target;
    if (back <= 0 || typeof window === "undefined") return;
    // Drop the callbacks FIRST: the entries the browser is about to hand back have
    // nothing left to undo, and the popstate below must not run them on the way past.
    levelsRef.current = levelsRef.current.slice(0, target);
    jumpRef.current = target;
    try {
      window.history.go(-back);
    } catch {
      jumpRef.current = null;
    }
  }, []);

  const depth = useCallback(() => levelsRef.current.length, []);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const jump = jumpRef.current;
      jumpRef.current = null;
      const held = levelsRef.current.length;
      if (held === 0) return; // not ours — the other shell or the router owns this one
      let target: number;
      if (jump !== null) {
        target = jump;
      } else {
        const tag = (e.state as Record<string, unknown> | null)?.[keyRef.current];
        // A tag above our count is a FORWARD step into an entry we no longer stand
        // behind; leave the stack alone rather than popping a level for it.
        target = typeof tag === "number" ? Math.max(0, Math.min(tag, held)) : held - 1;
      }
      while (levelsRef.current.length > target) {
        const undo = levelsRef.current[levelsRef.current.length - 1];
        levelsRef.current = levelsRef.current.slice(0, -1);
        undo();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return { pushLevel, goBackLevels, dropLevels, depth };
}
