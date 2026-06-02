// Cadence service worker — KILL SWITCH (self-unregistering).
//
// Why this exists: earlier workers intercepted page navigations. On iOS, a
// worker that re-issues a redirected response (/ → /board, signed-out →
// /login) makes the browser show "this page couldn't load" on refresh, and
// because Safari shares the worker with the installed PWA, both break at once.
// Once a bad worker is active it keeps failing every navigation, so the page
// never loads far enough for the app to swap in a fixed worker — a deadlock.
//
// This script breaks that deadlock. The browser background-fetches /sw.js on
// its periodic update check (independent of whether the page loads), installs
// THIS worker, and on activate it deletes every cache, unregisters itself, and
// reloads open tabs. After that, no worker controls the origin: navigations go
// straight to the network and can never be intercepted again. The app no
// longer registers a worker (see pwa-install-prompt.tsx), so none comes back.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Wipe every cache this origin ever created.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));

      // Remove this worker entirely.
      await self.registration.unregister();

      // Reload open tabs so they re-fetch without a controlling worker.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        try {
          await client.navigate(client.url);
        } catch {
          // Some clients can't be navigated (cross-origin, etc.) — skip them.
        }
      }
    })(),
  );
});
