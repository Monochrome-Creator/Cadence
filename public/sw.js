// Derive the base path from where this file is served so the same script
// works on both GitHub Pages (/Cadence/sw.js) and Vercel (/sw.js).
//   GitHub Pages : self.location.pathname = "/Cadence/sw.js" → BASE = "/Cadence"
//   Vercel       : self.location.pathname = "/sw.js"         → BASE = ""
const BASE = self.location.pathname.replace("/sw.js", "");

const CACHE = "cadence-v2";
const OFFLINE_URL = BASE + "/offline.html";

// Pages to warm the cache on install. Using Promise.allSettled (not
// cache.addAll) so a single 404 cannot block the whole SW installation.
const SHELL = [
  BASE + "/",
  BASE + "/board/",
  BASE + "/flashcards/",
  BASE + "/timer/",
  BASE + "/login/",
  BASE + "/offline/",
  OFFLINE_URL,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
  );
  // Activate immediately — don't wait for old tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Wipe every cache version except the current one.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
        )
      )
  );
  return self.clients.claim();
});

// NetworkFirst for navigation requests:
//   1. Try the network  → cache the response, return it.
//   2. Network fails    → serve the cached version if available.
//   3. Nothing cached   → serve the offline fallback page.
//
// Never throw from respondWith — Android Chrome standalone mode shows
// "This page couldn't load" if the SW rejects instead of responding.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then((c) => c.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((cached) => cached || caches.match(OFFLINE_URL))
      )
  );
});
