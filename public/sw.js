// Cadence service worker — minimal, offline-fallback only.
//
// Deliberately does NOT cache app assets. Caching Next.js App Router output
// (hashed chunks + RSC payloads) risks serving stale pieces from an old deploy
// against fresh HTML, which breaks the page. So every request goes straight to
// the network; we only step in to show a cached offline screen when a page
// navigation fails because there's no connection.

const CACHE = "cadence-v3";
const OFFLINE_URL = "/offline.html";

// Last-resort fallback used if the worker was installed on an unreliable
// connection before the offline page could be cached.
const OFFLINE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#fdfbf7">
    <title>Cadence - Offline</title>
    <style>
      * { box-sizing: border-box; }
      body { align-items: center; background: #fdfbf7; color: #4a4036; display: flex; font-family: system-ui, sans-serif; justify-content: center; margin: 0; min-height: 100vh; padding: 24px; text-align: center; }
      main { background: #fff; border: 1px solid #e8e0d5; border-radius: 24px; box-shadow: 0 2px 8px rgba(74, 64, 54, .05); max-width: 420px; padding: 40px; }
      h1 { font-size: 24px; margin: 0 0 10px; }
      p { color: #8a7d6b; font-size: 14px; line-height: 1.55; margin: 0; }
      button { background: #a35d4d; border: 0; border-radius: 10px; color: #fff; font: inherit; font-weight: 600; margin-top: 22px; padding: 11px 18px; }
    </style>
  </head>
  <body>
    <main>
      <h1>You're offline</h1>
      <p>Cadence can't reach the network right now. Your saved work is still on this device.</p>
      <button onclick="location.reload()">Try again</button>
    </main>
  </body>
</html>`;

// Precache just the offline fallback page. Do not fail installation if the
// network drops during this request: the inline fallback below still works.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .catch(() => undefined),
  );
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

// The page asks a freshly-installed worker to take over immediately (instead of
// waiting for all tabs to close), so updates apply without an uninstall.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only handle top-level page navigations; let everything else hit the
  // network untouched.
  if (request.method !== "GET" || request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(() =>
      caches
        .match(OFFLINE_URL)
        .then(
          (res) =>
            res ??
            new Response(OFFLINE_HTML, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            }),
        ),
    ),
  );
});
