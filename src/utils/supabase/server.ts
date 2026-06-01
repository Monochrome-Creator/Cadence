import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/* -------------------------------------------------------------------------- */
/*                       Supabase server client (App Router)                  */
/* -------------------------------------------------------------------------- */
/**
 * Server-side Supabase client for Server Components, Route Handlers and Server
 * Functions. It reads/writes the auth session through Next.js cookies so the
 * user's session is available on the server.
 *
 * NOTE: in Next.js 16, `cookies()` is async and must be awaited. Writing
 * cookies during a Server Component render throws, so `setAll` is wrapped in a
 * try/catch — the auth proxy (`src/proxy.ts`) refreshes the session cookie on
 * every request, so a skipped write here is harmless.
 *
 * Returns `null` when Supabase env vars are absent, keeping the app usable in a
 * purely local mode without credentials.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function createClient(): Promise<SupabaseClient | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render — the proxy refreshes the
          // session cookie instead, so this can be safely ignored.
        }
      },
    },
  });
}
