import type { NextConfig } from "next";

// When building for GitHub Pages (GITHUB_PAGES=true in the Actions workflow),
// export a fully-static site with the repo name as the base path.
const isGhPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Next infers the root from the
  // nearest lockfile walking upwards, which finds a stray ~/package-lock.json
  // and scopes the dev file watcher to the entire home directory.
  turbopack: { root: __dirname },
  ...(isGhPages && {
    output: "export",
    basePath: "/Cadence",
    trailingSlash: true,
    images: { unoptimized: true },
  }),
  async headers() {
    return [
      {
        // Never cache the worker script, so the browser's update check always
        // fetches the current (self-destructing) version and can evict an old
        // worker instead of replaying a stale copy.
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
      {
        // The recovery page must always come from the network — a cached copy
        // would replay a stale Clear-Site-Data response (or none at all).
        source: "/reset",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
        ],
      },
      {
        // An old service worker may still request this fallback; let it
        // revalidate every time so it can never pin a stale copy.
        source: "/offline.html",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
