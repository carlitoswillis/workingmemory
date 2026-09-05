/* Working Memory service worker — Web Push only.
 *
 * A service worker is the *precondition* for Web Push (iOS 16.4+ delivers a
 * push by waking this file's `push` handler), so it exists for that and
 * nothing else. There is DELIBERATELY no fetch handler and no app-shell cache:
 * a caching layer that ships before it's designed is how a PWA starts serving
 * a stale board, and offline-first is a separate piece of work.
 *
 * Registered from components/phone/PushSettings.tsx only — never on page load —
 * so a visitor who never asks for notifications never installs a worker.
 */

// Take over as soon as an updated file is fetched, rather than waiting for
// every tab to close: a stale push handler would keep showing old notifications.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const ICON = "/icon-192.png";
const DEFAULT_TITLE = "Working Memory";

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Not JSON (a probe, or an older sender): fall back to the raw text.
    try {
      payload = { body: event.data.text() };
    } catch {
      payload = {};
    }
  }

  const title = typeof payload.title === "string" && payload.title ? payload.title : DEFAULT_TITLE;
  const url = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/";

  // iOS drops the push subscription if a push is received and NOT shown, so
  // this must always resolve to a showNotification — hence the fallbacks above.
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof payload.body === "string" ? payload.body : "",
      // Same tag replaces the previous notification instead of stacking, so a
      // re-sent brief shows once.
      tag: typeof payload.tag === "string" && payload.tag ? payload.tag : "wm",
      data: { url },
      icon: ICON,
      badge: ICON,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const absolute = new URL(target, self.location.origin).href;

      // Prefer focusing what's already open — on a home-screen install there is
      // exactly one window, and openWindow would otherwise stack a second.
      for (const client of clientList) {
        if ("focus" in client) {
          try {
            if ("navigate" in client && client.url !== absolute) await client.navigate(absolute);
          } catch {
            // navigate() is not allowed on every platform; focusing is enough.
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(absolute);
    })(),
  );
});
