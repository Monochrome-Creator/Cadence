// Cadence service worker — push notifications only.
//
// Strictly limited to Web Push: this worker exists ONLY to receive `push`
// events and handle notification clicks (the Memento Mori Sunday-morning
// reminder — see src/lib/push.ts and src/app/api/push/send-weekly/route.ts).
// It intentionally has NO fetch handler and never writes to caches. An
// earlier version of this file was a caching worker that ended up wedging
// devices on a stale app shell after a redeploy (hashed /_next chunk 404s);
// do not add a fetch handler or any cache.* write here — that bug is exactly
// what this constraint prevents.

self.addEventListener("install", () => {
  // Activate immediately instead of waiting for tabs to close, so a
  // newly-registered worker starts receiving push events right away.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // One-time defensive cleanup: drop any caches left by an old (pre-2026)
      // caching worker version. This worker itself never writes to caches.
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

// Intentionally no fetch handler: navigations and requests are never
// intercepted, so every page load/refresh is handled natively by the browser.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Cadence";
  const url = data.url || "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Focus an already-open Cadence tab instead of opening a duplicate.
      for (const client of allClients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
