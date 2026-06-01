// Cadence service worker — minimal, offline-fallback only.
//
// Deliberately does NOT cache app assets. Caching Next.js App Router output
// (hashed chunks + RSC payloads) risks serving stale pieces from an old deploy
// against fresh HTML, which breaks the page. So every request goes straight to
// the network; we only step in to show a cached offline screen when a page
// navigation fails because there's no connection.

const CACHE = "cadence-v2";
const OFFLINE_URL = "/offline";

// Precache just the offline fallback page.
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

// Take control immediately and delete any caches from older worker versions
// (this clears the previous asset cache that could serve stale content).
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only handle top-level page navigations; let everything else hit the
  // network untouched.
  if (request.method !== "GET" || request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(OFFLINE_URL).then((res) => res ?? Response.error()),
    ),
  );
});
