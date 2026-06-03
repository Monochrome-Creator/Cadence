// Cadence service worker — inert by design.
//
// First principle: the ONLY reason a normal browser profile behaves differently
// from an incognito window is a service worker that caches or intercepts
// requests. Every past "page won't load on refresh, but incognito is fine"
// report traces back to a worker that either:
//   - served a stale precached app shell whose hashed /_next chunks no longer
//     exist after a redeploy (chunk 404 -> the page can't boot), or
//   - returned a response the browser rejects for a navigation (e.g. a
//     redirected response when the app had auth middleware).
//
// So this worker does the opposite of a caching worker:
//   - it caches nothing,
//   - it NEVER intercepts navigations, so the browser performs every page load
//     and refresh natively — byte-for-byte the incognito behaviour,
//   - on activation it deletes every cache left behind by older workers, which
//     is what actually unbricks devices stuck on a stale shell.
//
// Once this worker is active the app can no longer be bricked by the worker.
// The empty fetch listener exists only so the app stays installable: Chrome
// requires a registered fetch handler to offer "Add to Home Screen".
//
// Recovery version: cadence-recovery-v5.

self.addEventListener("install", () => {
  // Activate immediately, replacing any older (caching) worker without waiting
  // for every tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Purge every cache from previous worker versions. These legacy precaches
      // are the real source of the stale-chunk "page unable to load" failures.
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));

      // Control existing clients right away so the next navigation is clean.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// Intentionally inert. We register a fetch listener so the app stays
// installable, but we never call respondWith — so every request, and crucially
// every navigation, is handled by the browser exactly as it would be with no
// service worker at all. A worker that does not own navigations cannot break
// them.
self.addEventListener("fetch", () => {});
