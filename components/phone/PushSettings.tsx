// STUB — replaced by push package
//
// Web Push is owned by a separate package: the service worker, /api/push/*, the
// `push_subscriptions` table and the `web-push` dependency all live there. This file
// exists so the More sheet can render the "Turn on notifications" control without
// package B depending on any of that having landed yet — and so the merge is a
// straight file swap rather than an edit to PhoneMore.tsx.
//
// The contract the real component has to keep: a client component, default export,
// no required props, rendering its own section (heading included) or nothing at all.
// The permission request must happen inside a click handler — nothing may call
// `Notification.requestPermission()` on mount, on open, or on a timer.

"use client";

export default function PushSettings() {
  return null;
}
