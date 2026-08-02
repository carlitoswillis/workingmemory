// Search over the board's cards (2026-07-23). Deliberately a PURE function over the
// items the client already has — the whole board is shipped to the browser on every
// render, so searching it needs no server round-trip, no index, and no new SQL.
//
// CARDS ONLY, on purpose (owner, 2026-08-02: "I'd rather it just search cards and card
// content like details"). Search used to also rank matches out of `item_events` — old
// wording a card no longer has — and those event rows crowded the results. A card's
// past is still all there, just where it belongs: the History list in its panel, and
// the time machine.
//
// Matching: every whitespace-separated term must appear somewhere in the card (title
// or details), case-insensitive substring — the forgiving behaviour you want when
// you half-remember a thought. Ranking puts title hits above details-only hits, then
// most recently touched first, because "what was I just doing" is the common question.

import type { Item } from "./types.ts";

export interface SearchHit {
  item: Item;
  field: "text" | "details"; // where the match shown to the user came from
  snippet: string; // the text to render: the title, or a window of the details
  start: number; // offset of the matched term within `snippet`
  length: number; // its length, so the UI can highlight exactly that run
}

const SNIPPET_PAD = 44;

export function searchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

// A window of `source` around `at`, with ellipses where it was cut. Returns the
// snippet plus the match's offset inside it.
function windowAround(source: string, at: number, length: number): { snippet: string; start: number } {
  const flat = source.replace(/\s+/g, " ");
  // Re-find the match in the whitespace-collapsed string (offsets can shift).
  const term = source.slice(at, at + length).replace(/\s+/g, " ");
  const idx = flat.toLowerCase().indexOf(term.toLowerCase());
  const found = idx >= 0 ? idx : 0;
  const from = Math.max(0, found - SNIPPET_PAD);
  const to = Math.min(flat.length, found + term.length + SNIPPET_PAD);
  const head = from > 0 ? "…" : "";
  const tail = to < flat.length ? "…" : "";
  return { snippet: head + flat.slice(from, to) + tail, start: head.length + (found - from) };
}

/**
 * Rank `items` against `query`. Returns at most `limit` hits, best first. An empty
 * query returns nothing (the overlay shows its hint instead of the whole board).
 */
export function searchItems(items: Item[], query: string, limit = 20): SearchHit[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];

  const scored: { hit: SearchHit; rank: number; touched: number }[] = [];
  for (const item of items) {
    const text = item.text ?? "";
    const details = item.details ?? "";
    const lowText = text.toLowerCase();
    const lowDetails = details.toLowerCase();
    if (!terms.every((t) => lowText.includes(t) || lowDetails.includes(t))) continue;

    // Show the match the reader will recognise: the title if the first term is there,
    // otherwise the piece of the details it came from.
    const first = terms[0];
    const inTitle = lowText.indexOf(first);
    let hit: SearchHit;
    if (inTitle >= 0) {
      hit = { item, field: "text", snippet: text, start: inTitle, length: first.length };
    } else {
      const at = lowDetails.indexOf(first);
      const { snippet, start } = windowAround(details, at, first.length);
      hit = { item, field: "details", snippet, start, length: first.length };
    }
    scored.push({
      hit,
      rank: terms.every((t) => lowText.includes(t)) ? 0 : hit.field === "text" ? 1 : 2,
      touched: new Date(item.updated_at).getTime() || 0,
    });
  }

  scored.sort((a, b) => a.rank - b.rank || b.touched - a.touched);
  return scored.slice(0, limit).map((s) => s.hit);
}
