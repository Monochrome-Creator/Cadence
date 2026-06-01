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

/**
 * Standard `@supabase/ssr` browser client factory. Throws if env vars are
 * missing — prefer {@link getSupabaseClient} in app code, which degrades to a
 * local-only mode instead of throwing.
 */
export function createClient(): SupabaseClient {
  return createBrowserClient(
    SUPABASE_URL as string,
    SUPABASE_ANON_KEY as string
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
