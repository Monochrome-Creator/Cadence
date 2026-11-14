"use client";

import { useEffect } from "react";

import {
  ensureUserRow,
  isSupabaseConfigured,
  setCurrentUser,
  withTimeout,
} from "@/store/cloud-sync";
import { getSupabaseClient } from "@/utils/supabase/client";
import {
  DEMO_STORAGE_KEY,
  IS_DEMO,
  seedDemoData,
  useProdStore,
} from "@/store/use-prod-store";

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
 * Doing this here (rather than per page) means every route — board, daily plan,
 * timer — shares the same restored state.
 */
export function CloudSyncProvider() {
  const hydrate = useProdStore((state) => state.hydrate);

  useEffect(() => {
    let cancelled = false;

    // Demo mode: rehydrate the isolated sample namespace and stop. No auth, no
    // cloud pull/push — the sandbox never touches a real account.
    if (IS_DEMO) {
      void (async () => {
        const firstRun =
          typeof localStorage !== "undefined" &&
          localStorage.getItem(DEMO_STORAGE_KEY) === null;
        await useProdStore.persist.rehydrate();
        if (cancelled) return;
        if (firstRun) seedDemoData();
        useProdStore.getState().syncEvent({ type: "disabled" });
        useProdStore.setState({ isHydrated: true, localReady: true });
      })();
      return () => {
        cancelled = true;
      };
    }

    let subscription: { unsubscribe: () => void } | null = null;

    /**
     * Recover after the tab returns to the foreground or the network comes
     * back. While a mobile PWA is frozen in the background its access token can
     * expire and its auto-refresh timer stops firing, so the next write would
     * silently fail. getSession() refreshes the token if needed (guarded by a
     * timeout so a wedged lock can't hang us), then forceSync() flushes pending
     * edits and re-pulls. On failure we flip to "offline" so the dot goes red.
     */
    const recover = () => {
      if (cancelled) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      const supabase = getSupabaseClient();
      if (!supabase) return;

      void (async () => {
        try {
          const { data } = await withTimeout(
            supabase.auth.getSession(),
            "resume getSession",
            8_000
          );
          if (cancelled) return;
          // getSession() transparently refreshes an expired token. A null
          // session here means the refresh token itself is gone/invalid — the
          // user is effectively signed out, so be honest and say so instead of
          // leaving the dot on a stale "synced".
          if (!data.session) {
            useProdStore.getState().syncEvent({ type: "signedOut" });
            return;
          }
          setCurrentUser(data.session.user.id, data.session.user.email);
          void useProdStore.getState().forceSync();
        } catch {
          if (!cancelled) {
            useProdStore.getState().syncEvent({
              type: "settled",
              by: "background",
              outcome: { ok: false, reason: "network" },
            });
          }
        }
      })();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") recover();
    };

    // Mobile browsers frequently restore a backgrounded PWA/tab from the
    // back/forward cache, where `visibilitychange` never fires — only
    // `pageshow` with `persisted: true`. Without this, a phone that was locked
    // for an hour resumes with an expired token and no recovery trigger, which
    // is the "UI works but nothing saves" case. Treat a bfcache restore the
    // same as a foreground resume.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) recover();
    };

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
      //     `SIGNED_IN` fires when the user explicitly logs in mid-session, and
      //     also at startup when the stored session is still valid.
      //
      // Supabase awaits this callback while it holds its auth lock, and at
      // startup that lock covers its own initialisation, which every data call
      // waits for. Awaiting data calls inside the callback therefore stalled the
      // first sync after a reload until they timed out: about a minute of
      // "Syncing…", with a false "Offline" on the way. So the callback only
      // records who is signed in; the cloud work runs after it returns, one
      // event at a time.
      let cloudWork: Promise<void> = Promise.resolve();

      const onSession = async (
        event: "SIGNED_IN" | "INITIAL_SESSION" | "TOKEN_REFRESHED",
        userId: string,
        email: string | undefined
      ) => {
        if (cancelled) return;

        if (event === "SIGNED_IN") {
          // User just logged in after the app was already open (e.g. came from
          // the login page). `INITIAL_SESSION` with no session previously set
          // isHydrated: true, which would cause hydrate() to exit immediately.
          // Reset it so the full cloud pull runs for the now-authenticated user.
          // Screens stay mounted meanwhile: they gate on `localReady`.
          useProdStore.setState({ isHydrated: false });
        }

        // Only run the full sync on session establishment, not token refresh.
        if (event !== "TOKEN_REFRESHED") {
          // Session confirmed — write the users row then pull cloud data.
          await ensureUserRow(userId, email);
          await hydrate();

          // If the DB was cold and the first sync failed, retry once after a
          // short pause to give Postgres time to finish waking up.
          if (!cancelled && useProdStore.getState().sync.status === "offline") {
            setTimeout(() => void useProdStore.getState().forceSync(), 6_000);
          }
        } else if (useProdStore.getState().sync.status === "offline") {
          // A token just refreshed (e.g. auto-refresh fired on focus) after a
          // period where writes were failing — retry the pending sync now
          // that we hold a valid token again.
          void useProdStore.getState().forceSync();
        }
      };

      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (cancelled) return;

        if ((event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") && session) {
          // Cache the confirmed identity so every data op (pullTasks, pushTasks,
          // ensureUserRow) can use it without an extra network call.
          const { id, email } = session.user;
          setCurrentUser(id, email);
          cloudWork = cloudWork
            .then(() => onSession(event, id, email))
            .catch((error) => console.error("[cadence] sign-in sync failed", error));
        } else if (
          event === "SIGNED_OUT" ||
          (event === "INITIAL_SESSION" && !session)
        ) {
          // Clear the cached identity so stale user data is never used.
          setCurrentUser(null);
          // No session — mark as hydrated so UI stops showing "Syncing".
          useProdStore.getState().syncEvent({ type: "signedOut" });
          useProdStore.setState({ isHydrated: true, localReady: true });
        }
      });

      subscription = data.subscription;
    })();

    // Listen for foreground/network resumes so a backgrounded mobile session
    // recovers instead of silently failing every write.
    if (isSupabaseConfigured) {
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("pageshow", onPageShow);
      window.addEventListener("online", recover);
    }

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", recover);
    };
  }, [hydrate]);

  return null;
}
