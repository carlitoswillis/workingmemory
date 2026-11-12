// Run: node lib/boardmode.test.ts   (plain node script, same convention as the others)
//
// Board mode (live | rewound) and the undo stack's expiry / staleness rules.

import { UNDO_TTL_MS, UndoStack, boardMode, canMutate, cardSignature } from "./boardmode.ts";

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

ok("no snapshot is live", boardMode(null), "live");
ok("a snapshot is rewound", boardMode([]), "rewound");
ok("live may mutate", canMutate("live"), true);
ok("rewound may not mutate (Cmd-Z, archive, add, capture)", canMutate("rewound"), false);

const T0 = 1_000_000;
const sig = (list: string, position: number) => cardSignature({ list, position });
function entry(at: number, ran: string[], name = "e") {
  return {
    label: name,
    ids: ["a"],
    expect: { a: sig("focus", 5) },
    at,
    run: () => ran.push(name),
  };
}

{
  const s = new UndoStack();
  const ran: string[] = [];
  s.push(entry(T0, ran));
  const r = s.pop(T0 + 1000, () => sig("focus", 5));
  ok("a fresh, untouched entry pops", r.ok, true);
}
{
  const s = new UndoStack();
  s.push(entry(T0, []));
  const r = s.pop(T0 + UNDO_TTL_MS + 1, () => sig("focus", 5));
  ok("an entry older than the TTL expires", r, { ok: false, reason: "expired" });
  ok("…and the stack is cleared", s.size, 0);
}
{
  const s = new UndoStack();
  s.push(entry(T0, [], "old"));
  s.push(entry(T0 + 10, [], "new"));
  // another session moved the card since the gesture
  const r = s.pop(T0 + 1000, () => sig("today", 9));
  ok("an entry whose card changed since is refused", r, { ok: false, reason: "changed" });
  ok("…and older entries under it are dropped too", s.size, 0);
}
{
  const s = new UndoStack();
  ok("empty stack pops nothing", s.pop(T0, () => "x"), { ok: false, reason: "empty" });
  s.push(entry(T0, []));
  s.clear();
  ok("clear (entering the past) empties the stack", s.size, 0);
  ok("an absent card matches 'absent'", cardSignature(null), "absent");
}

console.log(failures === 0 ? "\nall boardmode tests passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
