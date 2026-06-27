// The board's columns. Mirrors the structure of the paper "working memory" note:
// what you're doing now, what's on your mind, what's parked, and the raw capture inbox.
// Shared by server + client, so keep it dependency-free.

export const LISTS = [
  { id: "today", label: "Today", hint: "What you're actually doing today" },
  { id: "focus", label: "Focus", hint: "Currently on your mind / in progress" },
  { id: "waiting", label: "Waiting / Later", hint: "Parked — not now, but don't forget" },
  { id: "backlog", label: "Backlog", hint: "Someday / maybe" },
  { id: "braindump", label: "Brain Dump", hint: "Capture now, sort later" },
] as const;

export type ListId = (typeof LISTS)[number]["id"];

export const LIST_IDS = LISTS.map((l) => l.id) as ListId[];

export function isListId(value: string): value is ListId {
  return (LIST_IDS as string[]).includes(value);
}

export function listLabel(id: string): string {
  return LISTS.find((l) => l.id === id)?.label ?? id;
}

type ListDef = (typeof LISTS)[number];

// Apply a saved column order; unknown ids are dropped, missing ones appended.
export function orderLists(order: string[] | null): ListDef[] {
  if (!order) return [...LISTS];
  const byId = new Map<string, ListDef>(LISTS.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const out: ListDef[] = [];
  for (const id of order) {
    const l = byId.get(id);
    if (l && !seen.has(id)) {
      out.push(l);
      seen.add(id);
    }
  }
  for (const l of LISTS) if (!seen.has(l.id)) out.push(l);
  return out;
}
