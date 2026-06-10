/**
 * Device recovery route for browsers wedged on stale state (service worker
 * caches, cookies, localStorage) — the Android Chrome "page couldn't load on
 * refresh" failure. Loading this URL makes the browser itself wipe everything
 * for this origin via the `Clear-Site-Data` response header, which works even
 * when the app's own JavaScript is too broken to run. "storage" also evicts any
 * registered service worker.
 *
 * Plain `Response` + inline HTML (no React) so the page has zero dependencies
 * on the app shell it is trying to recover from.
 */

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reset · Cadence</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #fdfbf7; color: #4a4036; font-family: system-ui, -apple-system, sans-serif; }
  main { max-width: 22rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
  p { font-size: 0.875rem; line-height: 1.5; color: #8a7d6b; margin: 0 0 1.5rem; }
  a { display: inline-block; background: #a35d4d; color: #fff; text-decoration: none;
      padding: 0.625rem 1.5rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 500; }
</style>
</head>
<body>
<main>
  <h1>Device reset complete</h1>
  <p>Cached files, cookies, and local data were cleared on this device only.
     You'll need to sign in again. Your cloud data is untouched.</p>
  <a href="/?fresh=1">Back to Cadence</a>
</main>
</body>
</html>`;

export function GET() {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The browser wipes this origin's data as it receives the response —
      // no JavaScript required on the (possibly broken) client.
      "Clear-Site-Data": '"cache", "cookies", "storage"',
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
