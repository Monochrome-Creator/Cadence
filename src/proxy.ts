import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/* -------------------------------------------------------------------------- */
/*                       Auth proxy (Next.js 16 "proxy")                      */
/* -------------------------------------------------------------------------- */
/**
 * Runs before every matched route. It (1) refreshes the Supabase auth session
 * cookie and (2) gates the workspace: signed-out users are redirected to
 * `/login`, and signed-in users are bounced away from `/login`.
 *
 * When Supabase is not configured, this is a pass-through so the app still runs
 * in local-only mode without credentials.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Routes reachable without a session. */
const PUBLIC_PATHS = ["/login", "/auth"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export async function proxy(request: NextRequest) {
  // No credentials → local-only mode, never redirect.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.next();
  }

  // Auth runs on every request, so a Supabase hiccup (transient network error,
  // stale/corrupt cookie, token-refresh failure) must never crash the whole
  // site. Any failure here fails OPEN: we fall through to local-only mode (the
  // client store still works, and cloud data stays protected by RLS) rather
  // than returning a 500 for every route.
  try {
    let response = NextResponse.next({ request });

    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    // IMPORTANT: getUser() refreshes the token and must run before the redirect.
    //
    // A paused/cold free-tier Supabase can make this hang on the first request
    // after idle (it doesn't error, it just stalls). Since auth runs on every
    // request, a stall would block the whole response until the platform kills
    // it — surfacing as "page couldn't load". Cap it so we fail open fast (the
    // catch below serves the app in local-only mode; cloud data stays safe
    // behind RLS) instead of hanging the initial load.
    const AUTH_TIMEOUT_MS = 2500;
    const {
      data: { user },
    } = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("auth-timeout")), AUTH_TIMEOUT_MS)
      ),
    ]);

    const { pathname } = request.nextUrl;

    // Signed out and visiting a protected route → send to login (remember target).
    if (!user && !isPublicPath(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    // Already signed in but on the login screen → go to the workspace.
    if (user && pathname === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.searchParams.delete("next");
      return NextResponse.redirect(url);
    }

    return response;
  } catch (error) {
    console.error("[cadence] auth proxy error — failing open", error);
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    /*
     * Run on every path EXCEPT static assets and the PWA files:
     * - _next/static, _next/image (build assets)
     * - favicon.ico, manifest.webmanifest (metadata)
     * - image files (icons, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:png|svg|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
