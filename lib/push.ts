import type Database from "better-sqlite3";

// Web Push for the phone app (2026-09-04). iOS only delivers Web Push to a
// HOME-SCREEN INSTALL (16.4+, standalone display mode); Android delivers it to
// an ordinary tab too. Both speak the same VAPID + Push API protocol, so there
// is exactly one code path here.
//
// Deliberately free of `next/*` and `lib/db` imports — same rule as lib/auth.ts
// and lib/bridge.ts — so `node lib/push.test.ts` can exercise the payload
// shaping and the upsert directly, and so `web-push` (a chunky CJS dep that
// pulls in an HTTP/ECDH stack) is only loaded when something actually sends.
//
// There is NO scheduler in the app: the owner's Mac triggers the 07:30 "Today"
// and 21:00 "Nightly log" pushes by POSTing /api/push/send with BRAIN_TOKEN,
// the same bearer /api/context uses (lib/bridge.ts). The app never wakes itself.

// Local single-user mode has no accounts at all (DEMO_MODE off → every
// getRequestUserId() is null), so subscriptions there are filed under one
// sentinel id. It is not a users(id) — which is why push_subscriptions.user_id
// carries no foreign key.
export const LOCAL_PUSH_USER_ID = "local";

// Whose subscriptions is this request talking about? Hosted → the signed-in
// account (null = not signed in = 401). Local → the sentinel, since there is
// nobody to sign in as. Split out from the routes so it is testable.
export function pushUserId(demoMode: boolean, sessionUserId: string | null): string | null {
  return demoMode ? sessionUserId : LOCAL_PUSH_USER_ID;
}

// ---------------------------------------------------------------------------
// VAPID configuration

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

// `mailto:` or an https URL, per RFC 8292 §2.1. A bad subject makes web-push
// throw at send time, so default to a valid one rather than shipping a 500.
const DEFAULT_SUBJECT = "mailto:push@workingmemory.local";

export function vapidConfig(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  if (!publicKey || !privateKey) return null;
  const subject = env.VAPID_SUBJECT?.trim() || DEFAULT_SUBJECT;
  return { publicKey, privateKey, subject };
}

// Unset keys = the feature doesn't exist (the /api/export + BRAIN_TOKEN
// pattern): the client renders "not configured" and the routes 404.
export function isPushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return vapidConfig(env) !== null;
}

export function vapidPublicKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return vapidConfig(env)?.publicKey ?? null;
}

// ---------------------------------------------------------------------------
// Payload shaping (pure)

export type PushInput = {
  title?: unknown;
  body?: unknown;
  url?: unknown;
  tag?: unknown;
};

export type PushPayload = { title: string; body: string; url: string; tag: string };

const MAX_TITLE = 100;
const MAX_BODY = 400;
const MAX_TAG = 64;
const MAX_URL = 512;

// One notification per tag REPLACES the previous one on both platforms, so the
// 07:30 brief re-sent twice shows once. Default groups every push from the app.
export const DEFAULT_TAG = "wm";

// Only same-origin paths: the SW's notificationclick does openWindow(url), and
// a caller-supplied absolute URL would turn a push into an open redirect out of
// the installed app. Anything else collapses to "/".
export function safeUrl(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  const url = raw.trim().slice(0, MAX_URL);
  // "//evil.com" is protocol-relative and "/\evil.com" is treated as such by
  // some parsers — a path must start with exactly one slash and no backslash.
  if (!url.startsWith("/") || url.startsWith("//") || url.startsWith("/\\")) return "/";
  return url;
}

const clean = (raw: unknown, max: number): string =>
  typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, max) : "";

// Returns null when there is nothing worth showing — a notification with no
// title is a silent, unactionable badge on iOS.
export function buildPayload(input: PushInput): PushPayload | null {
  const title = clean(input.title, MAX_TITLE);
  if (!title) return null;
  return {
    title,
    body: clean(input.body, MAX_BODY),
    url: safeUrl(input.url),
    tag: clean(input.tag, MAX_TAG) || DEFAULT_TAG,
  };
}

// ---------------------------------------------------------------------------
// Subscriptions

export type StoredSubscription = { endpoint: string; p256dh: string; auth: string };

// A browser's PushSubscription.toJSON(): {endpoint, keys:{p256dh, auth}}. Both
// keys are required — an aes128gcm encrypt without them throws.
export function parseSubscription(raw: unknown): StoredSubscription | null {
  if (!raw || typeof raw !== "object") return null;
  const sub = raw as { endpoint?: unknown; keys?: unknown };
  const endpoint = typeof sub.endpoint === "string" ? sub.endpoint.trim() : "";
  if (!/^https:\/\/[^\s]+$/.test(endpoint) || endpoint.length > 2000) return null;
  const keys = (sub.keys ?? {}) as { p256dh?: unknown; auth?: unknown };
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh.trim() : "";
  const auth = typeof keys.auth === "string" ? keys.auth.trim() : "";
  if (!p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

// Keyed by endpoint, NOT by (user, endpoint): a push endpoint is a device+app
// pair the browser hands out once, so the same endpoint arriving under a second
// account means the phone was handed over — the row moves, it doesn't fork.
// ON CONFLICT keeps created_at and refreshes last_seen_at, so a re-subscribe on
// every app open is a cheap heartbeat rather than a churn of rows.
export function upsertSubscription(
  db: Database.Database,
  userId: string,
  sub: StoredSubscription,
  userAgent?: string | null,
): void {
  db.prepare(
    `insert into push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
       values (?, ?, ?, ?, ?, ?)
     on conflict(endpoint) do update set
       user_id      = excluded.user_id,
       p256dh       = excluded.p256dh,
       auth         = excluded.auth,
       user_agent   = excluded.user_agent,
       last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(
    // Deterministic-enough id; the endpoint's UNIQUE index is the real key.
    `ps_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    userId,
    sub.endpoint,
    sub.p256dh,
    sub.auth,
    (userAgent ?? "").slice(0, 300),
  );
}

// Scoped to the user so one account can't unsubscribe another's device.
export function deleteSubscription(
  db: Database.Database,
  userId: string,
  endpoint: string,
): number {
  return db
    .prepare("delete from push_subscriptions where user_id = ? and endpoint = ?")
    .run(userId, endpoint).changes;
}

export function listSubscriptions(db: Database.Database, userId: string): StoredSubscription[] {
  return db
    .prepare(
      "select endpoint, p256dh, auth from push_subscriptions where user_id = ? order by created_at",
    )
    .all(userId) as StoredSubscription[];
}

// A 404/410 from the push service is the browser telling us the subscription is
// permanently gone (app deleted, notifications revoked). Anything else — a 429,
// a 500, a network blip — is transient and MUST NOT delete the row.
export function isGoneStatus(status: unknown): boolean {
  return status === 404 || status === 410;
}

export function pruneEndpoint(db: Database.Database, endpoint: string): number {
  return db.prepare("delete from push_subscriptions where endpoint = ?").run(endpoint).changes;
}

// ---------------------------------------------------------------------------
// Sending

export type SendResult = { sent: number; pruned: number };

// `db` is a parameter rather than a getMainDb() call inside so this module stays
// importable by the plain-node test (lib/db pulls in next/headers).
export async function sendToUser(
  db: Database.Database,
  userId: string,
  input: PushInput,
): Promise<SendResult> {
  const config = vapidConfig();
  if (!config) return { sent: 0, pruned: 0 };
  const payload = buildPayload(input);
  if (!payload) return { sent: 0, pruned: 0 };

  const subs = listSubscriptions(db, userId);
  if (subs.length === 0) return { sent: 0, pruned: 0 };

  const mod = await import("web-push");
  const webpush = (mod as unknown as { default?: typeof mod }).default ?? mod;
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  const json = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;

  // Sequential on purpose: this fires a handful of times a day to at most a
  // couple of devices, and a serial loop keeps the SQLite prune writes simple.
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        json,
        { TTL: 60 * 60 * 6, urgency: "normal" },
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: unknown })?.statusCode;
      if (isGoneStatus(status)) {
        pruned += pruneEndpoint(db, sub.endpoint);
      } else {
        console.warn(`[push] send failed (${String(status ?? "no status")})`);
      }
    }
  }

  return { sent, pruned };
}
