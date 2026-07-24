import type { SortingStrategy } from "@dnd-kit/sortable";

// A still list: nothing moves while a card is in the air.
//
// dnd-kit's sortable strategies slide every card around to open a gap where the drag
// would land. That reads fine for a plain reorder, but this board also nests cards by
// pausing over one — and a card that slides away mid-hold is a card you can't aim at
// (owner, 2026-07-24: "the cards dont move so much and we can drop cards within cards
// easier"). So the list holds still and the drop point is DRAWN instead: a line in the
// gap the card would fall into.
export const stillStrategy: SortingStrategy = () => null;

// With the list static, the drop point is worked out from the pointer against the cards'
// real boxes — not from dnd-kit's collisions, which measure the dragged card's box (a
// rectangle sitting wherever you grabbed it, not where the cursor is). Every draggable
// card tags itself with data-card-id for exactly this.
function cardsIn(zone: Element): HTMLElement[] {
  return Array.from(zone.querySelectorAll<HTMLElement>("[data-card-id]"));
}

// The card the drop line sits ABOVE; null means "below the last one".
export function anchorAt(
  zone: Element,
  y: number,
  skip?: (id: string) => boolean,
): string | null {
  for (const el of cardsIn(zone)) {
    const id = el.dataset.cardId as string;
    if (skip?.(id)) continue;
    const r = el.getBoundingClientRect();
    if (y < r.top + r.height / 2) return id;
  }
  return null;
}

// The card directly under the pointer — what a hold would drop INTO.
export function cardAt(
  zone: Element,
  x: number,
  y: number,
  skip?: (id: string) => boolean,
): string | null {
  for (const el of cardsIn(zone)) {
    const id = el.dataset.cardId as string;
    if (skip?.(id)) continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
  }
  return null;
}
