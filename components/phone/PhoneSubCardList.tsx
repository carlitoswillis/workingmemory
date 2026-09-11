"use client";

import { useEffect, useState } from "react";
import { reorderItemsAction } from "@/app/actions";
import type { Item } from "@/lib/types";
import PhoneRow from "./PhoneRow";

// Sub-cards, reorderable, inside the card sheet's full state (spec: CardPanel.tsx
// ~224-331 uses dnd-kit for this on desktop; a nested drag fights Vaul's own drag on
// a snapped sheet, so this is the up/down-button fallback the plan calls for — same
// 56px row, same everything, plus two 44pt buttons a sub-card can be nudged with).
// `data-vaul-no-drag` on the buttons keeps a tap on them from being read as the
// start of a sheet drag.
//
// A new file, not an addition to PhoneRow.tsx or PhoneCardSheet.tsx's shared body —
// see the note at the top of PhoneCardSheet.tsx about keeping the hot files' diffs
// small while other tracks edit them in parallel.

// Same cast PhoneCardSheet.tsx uses: `dense`, `onOpen` and `onCheckedChange` are
// PhoneRow props owned by the rows package. `onCheckedChange` is the A2 fix — a sub-
// card ticked in here is a write the sheet has to hear about, or its own copy of the
// board stays frozen at open time.
type SubRowProps = {
  item: Item;
  today?: string;
  dense?: boolean;
  onOpen?: (id: string) => void;
  onCheckedChange?: (id: string, checked: boolean) => void;
};
const SubRow = PhoneRow as unknown as React.ComponentType<SubRowProps>;

export default function PhoneSubCardList({
  kids,
  today,
  boardId,
  onOpenChild,
  onChanged,
  run,
}: {
  kids: Item[];
  today: string;
  boardId: string | null;
  onOpenChild: (id: string) => void;
  onChanged: () => void;
  run: (fn: () => void) => void;
}) {
  // Optimistic local order, exactly like CardPanel's `kids` state, so a tap settles
  // instantly instead of waiting on the round trip + revalidate.
  const [order, setOrder] = useState<Item[]>(kids);
  const sig = kids.map((k) => `${k.id}:${k.position}`).join("|");
  useEffect(() => setOrder(kids), [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= order.length) return;
    const a = order[index];
    const b = order[j];
    const next = order.slice();
    next[index] = { ...b, position: a.position };
    next[j] = { ...a, position: b.position };
    setOrder(next);
    run(() => {
      reorderItemsAction(boardId, [
        { id: a.id, list: a.list, position: b.position },
        { id: b.id, list: b.list, position: a.position },
      ]);
      onChanged();
    });
  }

  return (
    // A <div> of rows, not one <ul>: each sub-card is its own tiny <ul><li></ul> (the
    // SubRow) beside its move buttons, so the buttons never end up as a second child
    // of an <li> — the row stays exactly the markup it is everywhere else.
    <div style={{ marginLeft: -16, marginRight: -16 }}>
      {order.map((k, i) => (
        <div key={k.id} className="wm-ph-subrow">
          <div className="wm-ph-subrow__reorder" data-vaul-no-drag>
            <button
              type="button"
              data-vaul-no-drag
              className="wm-ph-subrow__move"
              disabled={i === 0}
              aria-label={`Move ${k.text} up`}
              onClick={() => move(i, -1)}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden focusable="false">
                <path
                  d="M4 10l4-4 4 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              data-vaul-no-drag
              className="wm-ph-subrow__move"
              disabled={i === order.length - 1}
              aria-label={`Move ${k.text} down`}
              onClick={() => move(i, 1)}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden focusable="false">
                <path
                  d="M4 6l4 4 4-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <ul className="wm-ph-subrow__row">
            <SubRow
              item={k}
              today={today}
              dense
              onOpen={onOpenChild}
              onCheckedChange={onChanged}
            />
          </ul>
        </div>
      ))}
    </div>
  );
}
