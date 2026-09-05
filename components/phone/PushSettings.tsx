"use client";

import { useCallback, useEffect, useState } from "react";

// Notification settings for the phone app (More → Settings).
//
// The constraint that shapes this whole component: on iOS, Web Push exists ONLY
// inside a home-screen install (16.4+). In Safari-as-a-tab `PushManager` may not
// exist at all, and where it does, subscribing throws. So the first thing this
// renders is not a button — it's an honest answer about which of five states the
// device is in, and only one of them has a button.
//
// `Notification.requestPermission()` is called in exactly one place: inside the
// enable button's click handler. Calling it on mount (or in an effect) is the
// classic way to get permanently denied by a user who had no idea what the app
// wanted, and Safari requires the call to be user-gesture-initiated regardless.
//
// This is also the only place the service worker is registered — a visitor who
// never turns notifications on never installs one (public/sw.js).

type State =
  | "loading"
  | "unsupported" // no SW / PushManager / Notification on this browser
  | "unconfigured" // server has no VAPID keys
  | "needs-install" // iOS in a tab: Share → Add to Home Screen first
  | "denied" // permission refused; only Settings can undo it
  | "off" // supported and permitted-or-askable, but not subscribed
  | "on";

const SW_URL = "/sw.js";

// VAPID keys travel as base64url; applicationServerKey wants raw bytes. The
// buffer is allocated first (rather than reading `.buffer` off a Uint8Array) so
// the type is a plain ArrayBuffer, which is what BufferSource actually wants.
function vapidKeyBytes(base64: string): ArrayBuffer {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return buffer;
}

function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// Home-screen install? `display-mode: standalone` is the standard signal;
// navigator.standalone is the old iOS one and still the reliable read there.
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia("(display-mode: standalone)").matches || legacy === true;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as a Mac; the touch-point count is what gives it away.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export default function PushSettings() {
  const [state, setState] = useState<State>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Read-only probe: what the server supports, and whether this device already
  // has a live subscription. Never asks for permission.
  const refresh = useCallback(async () => {
    if (!isSupported()) {
      // iOS in a tab doesn't even expose PushManager — say the useful thing
      // ("install it") rather than the true-but-dead-end "not supported".
      setState(isIOS() && !isStandalone() ? "needs-install" : "unsupported");
      return;
    }
    let configured = false;
    try {
      const res = await fetch("/api/push/subscribe", { cache: "no-store" });
      const json = (await res.json()) as { configured?: boolean; publicKey?: string | null };
      configured = !!json.configured;
      setPublicKey(json.publicKey ?? null);
    } catch {
      configured = false;
    }
    if (!configured) return setState("unconfigured");
    if (isIOS() && !isStandalone()) return setState("needs-install");
    if (Notification.permission === "denied") return setState("denied");

    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    setState(sub ? "on" : "off");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The ONLY call site of Notification.requestPermission — a click handler.
  async function onEnableClick() {
    setBusy(true);
    setNote(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register(SW_URL);
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          // Required by Chrome, and the honest contract anyway: every push this
          // app sends shows a notification.
          userVisibleOnly: true,
          applicationServerKey: vapidKeyBytes(publicKey ?? ""),
        }));
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error(await res.text());
      setState("on");
      setNote("This device will get Working Memory notifications.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not turn notifications on.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onDisableClick() {
    setBusy(true);
    setNote(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_URL);
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        // Tell the server first: if unsubscribe() succeeds and the DELETE
        // doesn't, the row becomes a ghost that only a 410 will ever clean up.
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
      setNote("Notifications are off on this device.");
    } catch {
      setNote("Could not turn notifications off.");
    } finally {
      setBusy(false);
    }
  }

  async function onTestClick() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const json = (await res.json()) as { sent?: number; pruned?: number };
      setNote(
        json.sent
          ? `Sent to ${json.sent} device${json.sent === 1 ? "" : "s"}.`
          : "Nothing to send to — this device isn't subscribed.",
      );
      if (!json.sent) await refresh();
    } catch {
      setNote("Test failed to send.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="push-settings-heading"
      className="rounded-xl border border-[var(--veil-soft)] bg-[var(--wash)] p-4"
    >
      <h2
        id="push-settings-heading"
        className="text-[13px] font-medium text-[var(--text-mid)]"
      >
        Notifications
      </h2>

      <p className="mt-2 text-[15px] leading-[1.4] text-[var(--text-mid)]">{describe(state)}</p>

      {state === "needs-install" && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13px] leading-[1.45] text-[var(--text-lo)]">
          <li>Open this page in Safari.</li>
          <li>
            Tap <span className="text-[var(--text-mid)]">Share</span>.
          </li>
          <li>
            Tap <span className="text-[var(--text-mid)]">Add to Home Screen</span>.
          </li>
          <li>Open Working Memory from the home screen, then come back here.</li>
        </ol>
      )}

      {(state === "off" || state === "on") && (
        <div className="mt-4 flex flex-wrap gap-2">
          {state === "off" ? (
            <button
              type="button"
              onClick={onEnableClick}
              disabled={busy}
              className="min-h-[44px] rounded-lg border border-[var(--now-line)] bg-[var(--now-wash)] px-4 text-[15px] text-[var(--text-hi)] transition-colors active:opacity-80 disabled:opacity-50"
            >
              Enable notifications
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onTestClick}
                disabled={busy}
                className="min-h-[44px] rounded-lg border border-[var(--veil)] px-4 text-[15px] text-[var(--text-hi)] transition-colors active:opacity-80 disabled:opacity-50"
              >
                Send test
              </button>
              <button
                type="button"
                onClick={onDisableClick}
                disabled={busy}
                className="min-h-[44px] rounded-lg border border-[var(--veil-soft)] px-4 text-[15px] text-[var(--text-mid)] transition-colors active:opacity-80 disabled:opacity-50"
              >
                Turn off
              </button>
            </>
          )}
        </div>
      )}

      {note && (
        <p aria-live="polite" className="mt-3 text-[13px] leading-[1.45] text-[var(--text-lo)]">
          {note}
        </p>
      )}
    </section>
  );
}

function describe(state: State): string {
  switch (state) {
    case "loading":
      return "Checking this device…";
    case "unsupported":
      return "This browser can't receive push notifications.";
    case "unconfigured":
      return "Push isn't set up on the server yet (no VAPID keys).";
    case "needs-install":
      return "iOS only delivers notifications to the home-screen app.";
    case "denied":
      return "Notifications are blocked for this app. Turn them back on in the device's Settings — the browser won't ask again.";
    case "off":
      return "Get the morning brief and the nightly log on this device.";
    case "on":
      return "Notifications are on for this device.";
  }
}
