// Run: node lib/realtime.test.ts   (plain node script, same convention as the others)
//
// The poke bus (lib/realtime.ts): pokes reach current subscribers, subscribers are
// board-scoped, and — the load-bearing property — unsubscribing returns the listener
// count to baseline. Every SSE reconnect adds a listener, so a leak here is the one
// real failure mode of the real-time design (plan §8).

import { pokeBoard, subscribeBoard, boardListenerCount } from "./realtime.ts";

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

const A = "board-A";
const B = "board-B";

ok("baseline: no listeners", boardListenerCount(A), 0);

// delivery: a poke reaches current subscribers of that board only
let aHits = 0;
let bHits = 0;
const offA1 = subscribeBoard(A, () => aHits++);
const offA2 = subscribeBoard(A, () => aHits++);
const offB1 = subscribeBoard(B, () => bHits++);

ok("two listeners on A", boardListenerCount(A), 2);
ok("one listener on B", boardListenerCount(B), 1);

pokeBoard(A);
ok("poke A hit both A subscribers", aHits, 2);
ok("poke A did not touch B", bHits, 0);

pokeBoard(B);
ok("poke B hit only B", bHits, 1);

// isolation: poking an unrelated board fires nothing
pokeBoard("board-Z");
ok("poke of an unsubscribed board is a no-op", [aHits, bHits], [2, 1]);

// the leak test: unsubscribe returns the count to baseline
offA1();
ok("one unsubscribe drops the count", boardListenerCount(A), 1);
offA2();
offB1();
ok("all A listeners gone", boardListenerCount(A), 0);
ok("all B listeners gone", boardListenerCount(B), 0);

// a poke after everyone left reaches nobody (no throw, no stragglers)
pokeBoard(A);
ok("poke after full unsubscribe hits nobody", aHits, 2);

// simulate churn: many connect/disconnect cycles must not accumulate listeners
for (let i = 0; i < 100; i++) subscribeBoard(A, () => {})();
ok("100 connect/disconnect cycles leave no listeners", boardListenerCount(A), 0);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall realtime tests passed");
