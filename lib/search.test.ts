// Run: node lib/search.test.ts   (plain node script, same convention as the others)
//
// Board search (lib/search.ts): term matching across title + details, ranking, and
// the details snippet the overlay highlights.

import Database from "better-sqlite3";
import { searchEvents, searchItems, searchTerms } from "./search.ts";
import { searchHistory } from "./queries.ts";
import { CREATE_TABLES, CREATE_TRIGGERS, migrateDb } from "./schema.ts";
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

// --- searching the HISTORY (the point of the app) ---------------------------
// A real DB so the trigger-written events are the ones being searched.
const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
db.exec(CREATE_TABLES);
migrateDb(db);
db.exec(CREATE_TRIGGERS);
const B = null;

db.prepare("insert into items (id, text, list, board_id) values ('h1', 'Sort out the visa', 'today', null)").run();
db.prepare("update items set text = 'Sort out the passport' where id = 'h1'").run();
db.prepare("update items set details = 'consulate opens tuesdays' where id = 'h1'").run();
db.prepare("insert into items (id, text, list, board_id) values ('h2', 'Buy milk', 'today', null)").run();
db.prepare("update items set archived = 1 where id = 'h2'").run();

const hist = (q: string) => searchEvents(searchHistory(db, B, searchTerms(q)), q);

// Two distinct moments carry the old wording: the card's birth ("as first captured")
// and the rename that replaced it ("used to say"). Newest first.
ok(
  "finds wording that was edited away",
  hist("visa").map((h) => h.event.type),
  ["edited", "created"],
);
ok(
  "…and says what it used to say",
  hist("visa")[0].snippet.slice(hist("visa")[0].start, hist("visa")[0].start + 5),
  "visa",
);
ok("…from the card it belongs to", hist("visa")[0].event.item_text, "Sort out the passport");
ok("the old side is the one shown", hist("visa")[0].side, "old");
ok("finds text written into details", hist("consulate").length, 1);
ok("all terms must match one event", hist("visa consulate").length, 0);
ok("no match is empty", hist("submarine").length, 0);
ok(
  "history reaches archived cards too",
  hist("milk").map((h) => h.event.item_archived),
  [1],
);
ok("a wildcard in the query is escaped, not honoured", hist("%").length, 0);
ok("board scoping: another board sees none of it", searchHistory(db, "other", searchTerms("visa")).length, 0);

// Only text/details edits are searchable — a list move carries column ids, not prose.
db.prepare("update items set list = 'backlog' where id = 'h1'").run();
ok("column moves aren't search results", hist("backlog").length, 0);

// Per-card cap keeps one chatty card from filling the list.
for (let i = 0; i < 5; i++) {
  db.prepare("update items set text = ? where id = 'h1'").run(`renamed budget ${i}`);
}
ok("at most two hits per card", hist("budget").length, 2);

console.log(failures === 0 ? "\nall search tests passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
