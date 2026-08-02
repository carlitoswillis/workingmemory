// Run: node lib/search.test.ts   (plain node script, same convention as the others)
//
// Board search (lib/search.ts): term matching across title + details, ranking, and
// the details snippet the overlay highlights. Cards and card content only — search
// stopped reaching into the event log on 2026-08-02 (owner's call), so there is no
// history matcher left to test here; a card's past lives in its panel's History list.

import { searchItems, searchTerms } from "./search.ts";
import type { Item } from "./types.ts";

let failures = 0;
function ok(label: string, got: unknown, want: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) {
    failures++;
    console.error(`✗ ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

function item(id: string, text: string, details = "", updated = "2026-07-01T00:00:00.000Z"): Item {
  return {
    id,
    text,
    details,
    list: "today",
    done: false,
    recurrence: "none",
    completed_on: null,
    parent_id: null,
    position: 0,
    archived: false,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: updated,
  };
}

const items = [
  item("a", "Book the flight to Lisbon", "", "2026-07-01T00:00:00.000Z"),
  item("b", "Passport renewal", "Need it before the Lisbon flight in August", "2026-07-05T00:00:00.000Z"),
  item("c", "Flight simulator idea", "", "2026-07-09T00:00:00.000Z"),
  item("d", "Groceries", "milk, bread"),
];

const ids = (q: string) => searchItems(items, q).map((h) => h.item.id);

ok("empty query matches nothing", ids(""), []);
ok("whitespace query matches nothing", ids("   "), []);
ok("title match, most recently touched first", ids("flight"), ["c", "a", "b"]);
ok("case-insensitive", ids("FLIGHT"), ["c", "a", "b"]);
ok("details-only match still found", ids("passport august"), ["b"]);
ok("all terms must appear somewhere", ids("flight groceries"), []);
ok("terms may span title and details", ids("passport lisbon"), ["b"]);
ok("no match is empty", ids("zebra"), []);

// Title hits outrank a card that only matches through its details.
ok("title beats details in the ranking", ids("lisbon"), ["a", "b"]);

// The hit carries what to highlight.
const [flightHit] = searchItems(items, "lisbon");
ok("title hit points at the title", flightHit.field, "text");
ok(
  "…with the matched run located in it",
  flightHit.snippet.slice(flightHit.start, flightHit.start + flightHit.length),
  "Lisbon",
);

const [detailsHit] = searchItems(items, "august");
ok("details hit points at the details", detailsHit.field, "details");
ok(
  "…with the matched run located in the snippet",
  detailsHit.snippet.slice(detailsHit.start, detailsHit.start + detailsHit.length).toLowerCase(),
  "august",
);

// Long details get windowed with ellipses around the match.
const long = item("e", "Long one", `${"x ".repeat(80)}needle${" y".repeat(80)}`);
const [longHit] = searchItems([long], "needle");
ok("long details are trimmed to a window", longHit.snippet.length < 120, true);
ok("…marked as trimmed at both ends", longHit.snippet.startsWith("…") && longHit.snippet.endsWith("…"), true);
ok(
  "…and the highlight still lands on the term",
  longHit.snippet.slice(longHit.start, longHit.start + longHit.length),
  "needle",
);

ok("limit is respected", searchItems([...items, ...items, ...items], "flight", 2).length, 2);

// searchTerms is the shared tokenizer — the archive trip uses it to decide there's
// nothing worth asking the server (app/actions.ts#searchArchivedAction).
ok("terms are lowercased and split on whitespace", searchTerms("  Lisbon   Flight "), ["lisbon", "flight"]);
ok("an empty query has no terms", searchTerms("   "), []);

console.log(failures === 0 ? "\nall search tests passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
