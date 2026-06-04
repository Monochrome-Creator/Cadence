// Cadence self-destructing service worker.
//
// Cadence no longer uses a service worker. This file exists for ONE reason: to
// remove the worker from devices that still have an older (caching) one
// registered. Simply deleting this file does not help — the browser's update
// check then gets a 404 and KEEPS the old worker running, so a device stuck on
// a stale app shell (hashed /_next chunks that 404 after a redeploy) stays
// stuck. A self-destructing worker is the only way to evict it remotely.
//
// The browser fetches this script on its own during the periodic registration
// update check (no page code registers it anymore). When it sees this new
// version it installs, activates, clears all caches, and unregisters itself —
// after which the device has no service worker at all and every navigation goes
// straight to the network, exactly like an incognito window.

self.addEventListener("install", () => {
  // Replace the old worker immediately instead of waiting for tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache left by previous (caching) worker versions — this is
      // what frees a device wedged on a stale shell.
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));

      // Take control of open pages so their next navigation is clean (this
      // worker has no fetch handler, so it never intercepts), then remove the
      // registration for good.
      await self.clients.claim();
      await self.registration.unregister();
    })(),
  );
});

// Intentionally no fetch handler: navigations are never intercepted, so every
// page load and refresh is handled natively by the browser — a worker that does
// not own navigations cannot break them.
