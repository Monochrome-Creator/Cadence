// Cadence service worker — recovery-only, no app caching.
//
// First principle: a PWA refresh is only as reliable as the active service
// worker. If that worker caches pages, redirects, RSC payloads, or old chunks,
// one stale normal-browser profile can fail while incognito works perfectly.
//
// This worker therefore behaves like a clean/incognito load:
//   - delete every old cache on activation
//   - never cache app pages or assets
//   - let every request hit the network
//   - return a tiny built-in offline page only when a navigation truly fails

// Recovery version: cadence-recovery-v4.

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

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));

      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET" || request.mode !== "navigate") return;

  event.respondWith(
    (async () => {
      try {
        return await fetch(request);
      } catch {
        return new Response(OFFLINE_HTML, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
    })(),
  );
});
