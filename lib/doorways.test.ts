// Run: node lib/doorways.test.ts   (plain node script, same convention as the others)
//
// Card ↔ board doorways (lib/doorways.ts): linking a card to a board and the trigger
// that journals it, the membership rules that decide who may install a doorway and
// who sees a name/count at all, the live open-card count, and the promote/demote
// round trip — archive here, recreate there — with nesting and `converted_from`
// provenance preserved across both seams.

import Database from "better-sqlite3";
import { CREATE_TABLES, CREATE_TRIGGERS, migrateDb } from "./schema.ts";
import { deleteBoard } from "./boards.ts";
import {
  countOpenCards,
  demoteToCard,
  getDoorwayMeta,
  getProvenance,
  promoteSubtree,
  setLinkedBoard,
} from "./doorways.ts";
import { getItems } from "./queries.ts";
import { reconstructBoardAt } from "./timetravel.ts";

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

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
db.exec(CREATE_TABLES);
migrateDb(db);
db.exec(CREATE_TRIGGERS);

// A hosted-shaped file: two accounts, three boards. u1 owns Personal and shares
// Movies! with u2; Secret is u2's alone — u1 is not a member and must learn nothing.
db.prepare("insert into users (id, username, pass_hash) values ('u1', 'owner', 'x')").run();
db.prepare("insert into users (id, username, pass_hash) values ('u2', 'ros1ta', 'x')").run();
for (const [id, name, by] of [
  ["bHome", "Personal", "u1"],
  ["bMovies", "Movies!", "u1"],
  ["bSecret", "Secret", "u2"],
] as const) {
  db.prepare("insert into boards (id, name, created_by) values (?, ?, ?)").run(id, name, by);
}
for (const [board, user, role] of [
  ["bHome", "u1", "owner"],
  ["bMovies", "u1", "owner"],
  ["bMovies", "u2", "member"],
  ["bSecret", "u2", "owner"],
] as const) {
  db.prepare("insert into board_members (board_id, user_id, role) values (?, ?, ?)").run(
    board,
    user,
    role,
  );
}

let seq = 0;
function addItem(
  id: string,
  text: string,
  list: string,
  boardId: string,
  parentId: string | null = null,
): string {
  db.prepare(
    "insert into items (id, text, list, position, board_id, parent_id, user_id) values (?, ?, ?, ?, ?, ?, 'u1')",
  ).run(id, text, list, (seq += 1000), boardId, parentId);
  return id;
}
const row = (id: string) =>
  db
    .prepare(
      "select text, list, board_id, parent_id, archived, done, linked_board_id, converted_from from items where id = ?",
    )
    .get(id) as {
    text: string;
    list: string;
    board_id: string;
    parent_id: string | null;
    archived: number;
    done: number;
    linked_board_id: string | null;
    converted_from: string | null;
  };
const linkEvents = (id: string) =>
  db
    .prepare(
      "select type, old_value, new_value, actor_id from item_events where item_id = ? and field = 'linked_board' order by id",
    )
    .all(id) as { type: string; old_value: string | null; new_value: string | null; actor_id: string | null }[];

addItem("watch", "Movies to watch", "backlog", "bHome");
addItem("note", "Daily note", "note", "bHome");

// --- linking: the trigger journals it -------------------------------------------
ok(
  "a card can open a board its owner is on",
  setLinkedBoard(db, "bHome", { id: "watch", linkedBoardId: "bMovies", actorId: "u1" }),
  { ok: true, changed: true },
);
ok("the card points at the board", row("watch").linked_board_id, "bMovies");
ok("linking is journaled by the trigger", linkEvents("watch"), [
  { type: "edited", old_value: null, new_value: "bMovies", actor_id: "u1" },
]);
ok(
  "re-linking to the same board is a no-op",
  setLinkedBoard(db, "bHome", { id: "watch", linkedBoardId: "bMovies", actorId: "u1" }),
  { ok: true, changed: false },
);
ok("…and writes no second event", linkEvents("watch").length, 1);

// --- membership gating (plan §2) ------------------------------------------------
ok(
  "a board the caller isn't on is 404-shaped, never confirmed",
  setLinkedBoard(db, "bHome", { id: "watch", linkedBoardId: "bSecret", actorId: "u1" }),
  { error: "No such board." },
);
ok(
  "…and a board that doesn't exist reads exactly the same",
  setLinkedBoard(db, "bHome", { id: "watch", linkedBoardId: "bNope", actorId: "u1" }),
  { error: "No such board." },
);
ok("the refused card is untouched", row("watch").linked_board_id, "bMovies");
ok(
  "a card can't open the board it's already on",
  setLinkedBoard(db, "bHome", { id: "watch", linkedBoardId: "bHome", actorId: "u1" }),
  { error: "A card can't open the board it's already on." },
);
ok(
  "the daily note can't be a doorway",
  setLinkedBoard(db, "bHome", { id: "note", linkedBoardId: "bMovies", actorId: "u1" }),
  { error: "The daily note can't open a board." },
);
ok(
  "a card on another board is invisible (IDOR guard)",
  setLinkedBoard(db, "bMovies", { id: "watch", linkedBoardId: "bMovies", actorId: "u1" }),
  { error: "That card is no longer on this board." },
);
ok(
  "with no session there is nothing to link (local/demo)",
  setLinkedBoard(db, null, { id: "watch", linkedBoardId: "bMovies", actorId: null }),
  { error: "That card is no longer on this board." },
);

// --- the live count: open TOP-LEVEL cards (G5) ----------------------------------
addItem("m1", "Dune", "today", "bMovies");
addItem("m2", "Arrival", "today", "bMovies");
addItem("m3", "Solaris", "today", "bMovies");
addItem("m1a", "…the sequel", "today", "bMovies", "m1"); // a sub-card doesn't count
db.prepare("update items set done = 1 where id = 'm2'").run(); // done doesn't count
db.prepare("update items set archived = 1 where id = 'm3'").run(); // archived doesn't count
ok("the count is open top-level cards only", countOpenCards(db, "bMovies"), 1);

// --- who sees a name and a count (G4) -------------------------------------------
ok("a member of the linked board sees its name + count", getDoorwayMeta(db, "u1", ["bMovies"]), {
  bMovies: { name: "Movies!", open: 1 },
});
ok(
  "a NON-member resolves nothing — no name, no count",
  getDoorwayMeta(db, "u2", ["bHome"]),
  {},
);
ok("local/demo mode (no viewer) resolves nothing", getDoorwayMeta(db, null, ["bMovies"]), {});
ok("an unknown board resolves nothing", getDoorwayMeta(db, "u1", ["bNope"]), {});

// --- promotion: archive here, recreate there (G3) --------------------------------
// A doorway card with a real sub-tree: Autojob's shape in miniature.
addItem("proj", "Coding projects", "focus", "bHome");
addItem("auto", "Autojob", "focus", "bHome", "proj");
addItem("resume", "Resume parser", "focus", "bHome", "auto");
addItem("scraper", "Job scraper", "focus", "bHome", "auto");
addItem("blog", "Blog rewrite", "focus", "bHome", "proj");
db.prepare("update items set details = 'the big one', recurrence = 'daily' where id = 'auto'").run();

ok(
  "promotion needs a doorway first",
  promoteSubtree(db, "bHome", { id: "proj", actorId: "u1" }),
  { error: "This card doesn't open a board yet." },
);
db.prepare("insert into boards (id, name, created_by) values ('bCode', 'Coding', 'u1')").run();
db.prepare("insert into board_members (board_id, user_id, role) values ('bCode', 'u1', 'owner')").run();
setLinkedBoard(db, "bHome", { id: "proj", linkedBoardId: "bCode", actorId: "u1" });
ok(
  "a non-member of the target can't promote into it",
  promoteSubtree(db, "bHome", { id: "proj", actorId: "u2" }),
  { error: "No such board." },
);

const promoted = promoteSubtree(db, "bHome", { id: "proj", actorId: "u1" });
ok("promotion moves the whole sub-tree", promoted, {
  ok: true,
  moved: 4,
  targetBoardId: "bCode",
});

ok(
  "the originals are archived on the home board, not deleted",
  ["auto", "resume", "scraper", "blog"].map((id) => row(id).archived),
  [1, 1, 1, 1],
);
ok("the doorway card itself stays put", row("proj").archived, 0);
ok(
  "archiving is journaled by the existing trigger",
  (
    db
      .prepare("select count(*) c from item_events where item_id = 'auto' and field = 'archived'")
      .get() as { c: number }
  ).c,
  1,
);

const onCode = getItems(db, "bCode");
const newAuto = onCode.find((i) => i.text === "Autojob")!;
const newBlog = onCode.find((i) => i.text === "Blog rewrite")!;
ok(
  "the sub-cards are top-level cards on the target board's backlog",
  [newAuto.list, newAuto.parent_id, newBlog.list, newBlog.parent_id],
  ["backlog", null, "backlog", null],
);
ok("…in their original order", newAuto.position < newBlog.position, true);
ok("content copies across the seam", [newAuto.details, newAuto.recurrence], [
  "the big one",
  "daily",
]);
ok(
  "nesting is preserved by the old-id → new-id walk",
  onCode
    .filter((i) => i.parent_id === newAuto.id)
    .map((i) => i.text)
    .sort(),
  ["Job scraper", "Resume parser"],
);
ok("grand-children land in the parent's column", row(
  onCode.find((i) => i.text === "Resume parser")!.id,
).list, "backlog");
ok("provenance points back at the archived original", newAuto.converted_from, "auto");
ok("the recreated card's history starts at the seam", (
  db.prepare("select count(*) c from item_events where item_id = ?").get(newAuto.id) as { c: number }
).c, 1);
ok(
  "…and the original's full trail is still reachable through it",
  getProvenance(db, "u1", newAuto.converted_from!),
  { itemId: "auto", text: "Autojob", boardId: "bHome", boardName: "Personal" },
);
ok(
  "a viewer off the source board follows nothing",
  getProvenance(db, "u2", "auto"),
  null,
);
ok("the count behind the doorway is live", getDoorwayMeta(db, "u1", ["bCode"]), {
  bCode: { name: "Coding", open: 2 },
});
ok(
  "promoting again refuses — there's nothing left to promote",
  promoteSubtree(db, "bHome", { id: "proj", actorId: "u1" }),
  { error: "This card has no sub-cards to promote." },
);

// --- demotion: the same machinery, backwards (G6) --------------------------------
const demoted = demoteToCard(db, "bHome", { id: "proj", actorId: "u1" });
ok("demotion brings the board back as sub-cards", demoted, {
  ok: true,
  moved: 4,
  sourceBoardId: "bCode",
});
ok("the card stops being a doorway", row("proj").linked_board_id, null);
ok("unlinking is journaled too", linkEvents("proj"), [
  { type: "edited", old_value: null, new_value: "bCode", actor_id: "u1" },
  { type: "edited", old_value: "bCode", new_value: null, actor_id: "u1" },
]);
ok(
  "the emptied board is LEFT ALIVE — deleting it stays a separate act",
  db.prepare("select name from boards where id = 'bCode'").get(),
  { name: "Coding" },
);
ok(
  "its cards are archived there, still browsable in its Archive",
  getItems(db, "bCode").length,
  0,
);

const backHome = getItems(db, "bHome");
const backAuto = backHome.find((i) => i.text === "Autojob")!;
ok(
  "they're sub-cards of the doorway card again",
  [backAuto.parent_id, backAuto.list],
  ["proj", "focus"],
);
ok(
  "the round trip preserves the tree",
  backHome
    .filter((i) => i.parent_id === backAuto.id)
    .map((i) => i.text)
    .sort(),
  ["Job scraper", "Resume parser"],
);
ok("content survives the round trip", [backAuto.details, backAuto.recurrence], [
  "the big one",
  "daily",
]);
ok("provenance chains one seam back", backAuto.converted_from, newAuto.id);
ok(
  "…and that link is followable",
  getProvenance(db, "u1", backAuto.converted_from!)?.boardName,
  "Coding",
);
ok(
  "demotion refuses without a doorway",
  demoteToCard(db, "bHome", { id: "proj", actorId: "u1" }),
  { error: "This card doesn't open a board." },
);

// Demoting an EMPTY board is still a valid opt-out: the link just clears.
setLinkedBoard(db, "bHome", { id: "proj", linkedBoardId: "bCode", actorId: "u1" });
ok(
  "demoting an empty board just clears the link",
  demoteToCard(db, "bHome", { id: "proj", actorId: "u1" }),
  { ok: true, moved: 0, sourceBoardId: "bCode" },
);

// The linked board's daily note can't become a sub-card (nesting's own rule).
addItem("cnote", "Daily note", "note", "bCode");
addItem("ctask", "Refactor", "today", "bCode");
setLinkedBoard(db, "bHome", { id: "proj", linkedBoardId: "bCode", actorId: "u1" });
ok(
  "demotion leaves the linked board's note behind",
  demoteToCard(db, "bHome", { id: "proj", actorId: "u1" }),
  { ok: true, moved: 1, sourceBoardId: "bCode" },
);
ok("the note stays on its own board, unarchived", [row("cnote").board_id, row("cnote").archived], [
  "bCode",
  0,
]);

// --- time travel: the link is an EVENT, never a reconstructed field (plan §4) ----
const events = db.prepare("select * from item_events order by id").all() as {
  item_id: string;
  at: string;
  field: string | null;
  new_value: string | null;
}[];
const linkedAt = events.find((e) => e.field === "linked_board" && e.new_value === "bMovies")!.at;
const snap = reconstructBoardAt(getItems(db, "bHome") as never, events as never, linkedAt);
ok(
  "a past snapshot still reconstructs the card itself",
  snap.find((s) => s.id === "watch")?.text,
  "Movies to watch",
);
ok(
  "…with no doorway field on it — the chip and count are live-only",
  "linked_board_id" in (snap.find((s) => s.id === "watch") as object),
  false,
);

// --- a deleted board never leaves a dangling doorway (plan §2) -------------------
ok("deleting the linked board", deleteBoard(db, "bMovies", "u1"), { ok: true });
ok("the doorway card is unlinked", row("watch").linked_board_id, null);
// The actor on THIS event is whoever last touched the card: deleteBoard's unlink is
// the plan's single line and deliberately doesn't restamp touched_by (it's a
// board-level verb, not an edit somebody made to this card).
ok("…and the unlink is in its history", linkEvents("watch"), [
  { type: "edited", old_value: null, new_value: "bMovies", actor_id: "u1" },
  { type: "edited", old_value: "bMovies", new_value: null, actor_id: "u1" },
]);

console.log(failures === 0 ? "\nall doorways tests passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
