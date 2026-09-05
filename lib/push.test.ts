// Run: node lib/push.test.ts   (plain node script, same convention as the others)
//
// Web Push, minus the network: payload shaping (what a notification is allowed
// to say and where it's allowed to point) and the subscription upsert (endpoint
// is the key, so a phone that re-subscribes on every open doesn't grow rows).
// sendToUser's HTTP half is not covered here — it's a thin loop over web-push;
// what IS covered is the decision it makes per failure (isGoneStatus).

import Database from "better-sqlite3";
import { CREATE_TABLES, CREATE_TRIGGERS, migrateDb } from "./schema.ts";
import {
  buildPayload,
  deleteSubscription,
  isGoneStatus,
  isPushConfigured,
  listSubscriptions,
  LOCAL_PUSH_USER_ID,
  parseSubscription,
  pruneEndpoint,
  pushUserId,
  safeUrl,
  upsertSubscription,
  vapidPublicKey,
} from "./push.ts";

let failures = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.error(`✗ ${label}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_TABLES);
  migrateDb(db);
  db.exec(CREATE_TRIGGERS);
  return db;
}

// --- VAPID configuration ----------------------------------------------------
eq("no keys = not configured", isPushConfigured({} as NodeJS.ProcessEnv), false);
eq(
  "public key alone is not enough",
  isPushConfigured({ VAPID_PUBLIC_KEY: "pub" } as unknown as NodeJS.ProcessEnv),
  false,
);
eq(
  "both keys = configured",
  isPushConfigured({
    VAPID_PUBLIC_KEY: "pub",
    VAPID_PRIVATE_KEY: "priv",
  } as unknown as NodeJS.ProcessEnv),
  true,
);
eq(
  "public key is exposed, private key never asked for",
  vapidPublicKey({
    VAPID_PUBLIC_KEY: " pub ",
    VAPID_PRIVATE_KEY: "priv",
  } as unknown as NodeJS.ProcessEnv),
  "pub",
);

// --- who a request's subscriptions belong to --------------------------------
eq("hosted + session = that account", pushUserId(true, "u1"), "u1");
eq("hosted + no session = nobody (401)", pushUserId(true, null), null);
eq("local mode has no accounts, so the sentinel", pushUserId(false, null), LOCAL_PUSH_USER_ID);

// --- payload shaping --------------------------------------------------------
eq("a title is required", buildPayload({ body: "x" }), null);
eq("whitespace-only title is no title", buildPayload({ title: "   \n " }), null);
eq("body defaults to empty, url to /, tag to wm", buildPayload({ title: "Today" }), {
  title: "Today",
  body: "",
  url: "/",
  tag: "wm",
});
eq(
  "newlines collapse (iOS renders a notification on one line)",
  buildPayload({ title: "Today\n\nbrief", body: "a\tb   c" }),
  { title: "Today brief", body: "a b c", url: "/", tag: "wm" },
);
eq(
  "title clamps to 100 chars",
  buildPayload({ title: "x".repeat(300) })?.title.length,
  100,
);
eq("body clamps to 400 chars", buildPayload({ title: "t", body: "y".repeat(900) })?.body.length, 400);
eq(
  "an explicit tag survives (so 07:30 and 21:00 don't replace each other)",
  buildPayload({ title: "Nightly log", tag: "wm-nightly" })?.tag,
  "wm-nightly",
);
eq("non-string fields are ignored, not stringified", buildPayload({ title: "t", body: 42 }), {
  title: "t",
  body: "",
  url: "/",
  tag: "wm",
});

// notificationclick does openWindow(data.url); anything but a same-origin path
// would let a push open an arbitrary site out of the installed app.
eq("a relative path is kept", safeUrl("/b/abc?x=1#now"), "/b/abc?x=1#now");
eq("absolute URLs are refused", safeUrl("https://evil.example/steal"), "/");
eq("protocol-relative is refused", safeUrl("//evil.example"), "/");
eq("backslash-smuggled protocol-relative is refused", safeUrl("/\\evil.example"), "/");
eq("javascript: is refused", safeUrl("javascript:alert(1)"), "/");
eq("a non-string url is refused", safeUrl(null), "/");

// --- subscription parsing ---------------------------------------------------
const goodSub = {
  endpoint: "https://web.push.apple.com/abc123",
  keys: { p256dh: "BPk...", auth: "s3cr3t" },
  expirationTime: null,
};
eq("a browser PushSubscription parses", parseSubscription(goodSub), {
  endpoint: "https://web.push.apple.com/abc123",
  p256dh: "BPk...",
  auth: "s3cr3t",
});
eq("missing keys is refused (can't encrypt to it)", parseSubscription({ endpoint: goodSub.endpoint }), null);
eq(
  "missing auth alone is refused",
  parseSubscription({ endpoint: goodSub.endpoint, keys: { p256dh: "BPk..." } }),
  null,
);
eq("a non-https endpoint is refused", parseSubscription({ ...goodSub, endpoint: "http://x/y" }), null);
eq("garbage is refused", parseSubscription("hello"), null);
eq("null is refused", parseSubscription(null), null);

// --- upsert -----------------------------------------------------------------
{
  const db = freshDb();
  const sub = parseSubscription(goodSub)!;
  upsertSubscription(db, "u1", sub, "iPhone");
  upsertSubscription(db, "u1", sub, "iPhone");
  upsertSubscription(db, "u1", { ...sub, p256dh: "BRotated..." }, "iPhone");
  eq("re-subscribing the same endpoint stays one row", listSubscriptions(db, "u1").length, 1);
  eq("...and the row carries the rotated key", listSubscriptions(db, "u1")[0].p256dh, "BRotated...");

  const second = parseSubscription({
    endpoint: "https://fcm.googleapis.com/fcm/send/xyz",
    keys: { p256dh: "BAndroid", auth: "a2" },
  })!;
  upsertSubscription(db, "u1", second, "Pixel");
  eq("a second device is a second row", listSubscriptions(db, "u1").length, 2);

  // The endpoint is device+app, so the same endpoint under another account means
  // the device changed hands — the row moves rather than being duplicated.
  upsertSubscription(db, "u2", sub, "iPhone");
  eq("an endpoint belongs to exactly one user", listSubscriptions(db, "u1").length, 1);
  eq("...and it moved to the new one", listSubscriptions(db, "u2").length, 1);

  // Unsubscribe is user-scoped so one account can't kill another's device.
  eq("deleting someone else's endpoint does nothing", deleteSubscription(db, "u1", sub.endpoint), 0);
  eq("deleting your own removes it", deleteSubscription(db, "u2", sub.endpoint), 1);
  eq("...and it's gone", listSubscriptions(db, "u2").length, 0);

  eq("pruning by endpoint ignores ownership", pruneEndpoint(db, second.endpoint), 1);
  eq("pruning an unknown endpoint is a no-op", pruneEndpoint(db, "https://nope/x"), 0);
  db.close();
}

// --- what counts as "this subscription is gone for good" --------------------
eq("404 prunes", isGoneStatus(404), true);
eq("410 prunes", isGoneStatus(410), true);
eq("429 does NOT prune (rate limit is transient)", isGoneStatus(429), false);
eq("500 does NOT prune", isGoneStatus(500), false);
eq("a network error with no status does NOT prune", isGoneStatus(undefined), false);

if (failures) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall push tests passed");
