"use client";

import { useEffect } from "react";

import { ensureUserRow, isSupabaseConfigured, setCurrentUser } from "@/store/cloud-sync";
import { getSupabaseClient } from "@/utils/supabase/client";
import { useProdStore } from "@/store/use-prod-store";

/**
 * Bootstraps store persistence when the app mounts. Renders nothing.
 *
 * Two layers, in order:
 *   1. Restore locally-saved data from localStorage (works fully offline). This
 *      runs after mount so the first client render still matches the server's
 *      seed render — avoiding a React hydration mismatch.
 *   2. Hand off to the cloud: when Supabase is configured we subscribe to
 *      `onAuthStateChange` and only call `ensureUserRow` + `hydrate()` after
 *      Supabase has confirmed a valid session — eliminating the startup race
 *      where `hydrate()` was previously called before the access token was ready.
 *
 * Doing this here (rather than per page) means every route — board, flashcards,
 * timer — shares the same restored state.
 */
export function CloudSyncProvider() {
  const hydrate = useProdStore((state) => state.hydrate);

  useEffect(() => {
    let cancelled = false;
    let subscription: { unsubscribe: () => void } | null = null;

    void (async () => {
      // 1. Local first — instant, offline-friendly.
      await useProdStore.persist.rehydrate();
      if (cancelled) return;

      // 2a. No Supabase configured — run hydrate immediately (it exits fast).
      if (!isSupabaseConfigured) {
        void hydrate();
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        void hydrate();
        return;
      }

      // 2b. Wait for Supabase to confirm auth state before touching the DB.
      //     `INITIAL_SESSION` fires once on startup (may carry null session).
      //     `SIGNED_IN` fires when the user explicitly logs in mid-session.
      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (cancelled) return;

        if ((event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") && session) {
          // Cache the confirmed identity so every data op (pullTasks, pushTasks,
          // ensureUserRow) can use it without an extra network call.
          setCurrentUser(session.user.id, session.user.email);

          if (event === "SIGNED_IN") {
            // User just logged in after the app was already open (e.g. came from
            // the login page). `INITIAL_SESSION` with no session previously set
            // isHydrated: true, which would cause hydrate() to exit immediately.
            // Reset it so the full cloud pull runs for the now-authenticated user.
            useProdStore.setState({ isHydrated: false });
          }

          // Only run the full sync on session establishment, not token refresh.
          if (event !== "TOKEN_REFRESHED") {
            // Session confirmed — write the users row then pull cloud data.
            await ensureUserRow(session.user.id, session.user.email ?? undefined);
            await hydrate();

            // If the DB was cold and the first sync failed, retry once after a
            // short pause to give Postgres time to finish waking up.
            if (
              !cancelled &&
              useProdStore.getState().connectionStatus === "offline"
            ) {
              setTimeout(
                () => void useProdStore.getState().forceSync(),
                6_000
              );
            }
          }
        } else if (
          event === "SIGNED_OUT" ||
          (event === "INITIAL_SESSION" && !session)
        ) {
          // Clear the cached identity so stale user data is never used.
          setCurrentUser(null);
          // No session — mark as hydrated so UI stops showing "Syncing".
          useProdStore.setState({ connectionStatus: "offline", isHydrated: true });
        }
      });

      subscription = data.subscription;
    })();

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, [hydrate]);

  return null;
}
