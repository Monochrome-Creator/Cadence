import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/* -------------------------------------------------------------------------- */
/*                       Supabase browser client (App Router)                 */
/* -------------------------------------------------------------------------- */
/**
 * Browser-side Supabase client used by Client Components and the Zustand store.
 *
 * Identity comes from the Supabase Auth session cookie (set at sign-in), so the
 * client automatically scopes every request to the logged-in user — that is
 * what the `auth.uid()` Row Level Security policies in `supabase/schema.sql`
 * match against. No custom headers are needed.
 *
 * Credentials are read exclusively from the environment — never hardcoded:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-public-key>
 *
 * The anon key is safe to expose in the browser because RLS gates all access.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when both env vars are present and cloud sync can be enabled. */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Reuse one browser client across the app (avoids duplicate connections during
// Fast Refresh / re-renders).
let browserClient: SupabaseClient | null = null;

/** How long to wait for the auth lock before proceeding without it. */
const LOCK_ACQUIRE_TIMEOUT_MS = 5_000;

/**
 * Token-refresh lock that can never deadlock.
 *
 * supabase-js serialises token refreshes with the Web Locks API so two tabs
 * can't rotate the refresh token simultaneously. On mobile, a tab that gets
 * frozen in the background can leave that lock held — and when the user
 * returns, every auth-gated request (getSession, refreshSession, any DB call)
 * blocks forever waiting on a lock that never releases. That is the root cause
 * of the "only a brand-new incognito tab works" bug.
 *
 * This wrapper still coordinates normally, but if it cannot acquire the lock
 * within a few seconds it runs the work anyway instead of hanging. Liveness
 * beats perfect cross-tab coordination for a single-tab mobile PWA — and within
 * one tab the lock is uncontended, so the timeout only ever trips on the exact
 * stuck-context case we're fixing.
 */
function timeoutLock<R>(
  name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>
): Promise<R> {
  // No Web Locks support (older browser / SSR) — just run it.
  if (typeof navigator === "undefined" || !navigator.locks) return fn();

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    LOCK_ACQUIRE_TIMEOUT_MS
  );

  return navigator.locks
    .request(name, { mode: "exclusive", signal: controller.signal }, () => fn())
    .then(
      (result) => result,
      (error: unknown) => {
        // AbortError = we couldn't acquire the lock in time. Run without it
        // rather than wedge the session. Any other error is a real failure.
        if (error instanceof DOMException && error.name === "AbortError") {
          return fn();
        }
        throw error;
      }
    )
    .finally(() => clearTimeout(timer));
}

/**
 * Standard `@supabase/ssr` browser client factory. Throws if env vars are
 * missing — prefer {@link getSupabaseClient} in app code, which degrades to a
 * local-only mode instead of throwing.
 *
 * `storage` is intentionally left to `@supabase/ssr` (it uses cookies so the
 * server can read the session); we only override the auth-resilience knobs.
 */
export function createClient(): SupabaseClient {
  return createBrowserClient(
    SUPABASE_URL as string,
    SUPABASE_ANON_KEY as string,
    {
      auth: {
        // Keep the session alive and refreshing across reloads and resumes.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Deadlock-proof refresh lock (see timeoutLock above).
        lock: timeoutLock,
      },
    }
  );
}

/**
 * Returns the shared browser client, or `null` when the project has not been
 * configured yet. Callers must handle the `null` case so the app keeps working
 * in a purely local (offline) mode without credentials.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!browserClient) browserClient = createClient();
  return browserClient;
}
