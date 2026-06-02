import { NextResponse, type NextRequest } from "next/server";

/* -------------------------------------------------------------------------- */
/*                       Auth proxy (Next.js 16 "proxy")                      */
/* -------------------------------------------------------------------------- */
/**
 * Runs before page routes and keeps the signed-out experience pointed at
 * `/login`. It deliberately does NOT call Supabase: the workspace is
 * local-first, and a stale mobile session must never block page rendering.
 *
 * The browser sync layer validates the session in the background and Supabase
 * Row Level Security protects cloud data. If a cookie is stale or malformed,
 * the board still opens with its on-device copy and reports offline mode.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Routes reachable without a session. */
const PUBLIC_PATHS = ["/login", "/auth", "/offline"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

/**
 * `@supabase/ssr` stores the browser session in `sb-*-auth-token` cookies. Long
 * sessions may be split into `.0`, `.1`, etc. chunks, so match the shared stem.
 */
function hasSupabaseSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"));
}

export function proxy(request: NextRequest) {
  // No credentials → local-only mode, never redirect.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname) || hasSupabaseSessionCookie(request)) {
    return NextResponse.next();
  }

  // Signed out and visiting a protected route → send to login (remember target).
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Run on every path EXCEPT static assets and the PWA files:
     * - _next/static, _next/image (build assets)
     * - favicon.ico, manifest.webmanifest (metadata)
     * - sw.js, offline.html (auth-independent PWA recovery files)
     * - image files (icons, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|.*\\.(?:png|svg|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
