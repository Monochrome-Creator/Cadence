// Cadence service worker — KILL SWITCH (self-unregistering).
//
// Why this exists: earlier workers intercepted page navigations. On iOS/Android,
// a worker that re-issues a redirected response (/ → /board, signed-out →
// /login) makes the browser show "this page couldn't load" on refresh, and
// because Safari/Chrome shares the worker with the installed PWA, both break
// at once. Once a bad worker is active it keeps failing every navigation, so
// the page never loads far enough for the app to swap in a fixed worker — a
// deadlock.
//
// This script breaks that deadlock. The browser background-fetches /sw.js on
// its periodic update check (independent of whether the page loads), installs
// THIS worker, and on activate it deletes every cache and unregisters itself.
// No client.navigate() — calling navigate() after unregister() races with
// Chrome's cleanup and causes another "this page couldn't load" on Android.
// After this worker runs, no worker controls the origin: navigations go
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

      // Remove this worker entirely. The next navigation goes straight to the
      // network — no need to force one here (doing so after unregister() races
      // with Chrome's cleanup and causes "this page couldn't load" on Android).
      await self.registration.unregister();
    })(),
  );
});
