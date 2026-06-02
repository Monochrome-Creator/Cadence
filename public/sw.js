// Cadence service worker — lifecycle + cache cleanup only.
//
// Deliberately does NOT intercept fetches. A worker that never touches a page
// navigation physically cannot break one. An earlier version intercepted
// navigations and re-issued redirected responses (/ → /board, signed-out
// routes → /login), which surfaced as "this page couldn't load" on refresh
// once the worker (not the browser) controlled the page. Removing the fetch
// handler ends that entire class of bug.
//
// This worker exists only so the app stays installable as a PWA and so we can
// purge stale caches left by older worker versions.

// Nothing to precache — every request goes straight to the network.
self.addEventListener("install", () => {
  self.skipWaiting();
});

// Take control immediately and delete every cache from any prior worker
// version (this clears the old asset/offline caches that could serve stale
// content or break navigations).
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Let a freshly-installed worker take over immediately instead of waiting for
// every tab to close, so updates apply without an uninstall.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
