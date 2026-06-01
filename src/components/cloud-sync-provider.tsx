"use client";

import { useEffect } from "react";

import { useProdStore } from "@/store/use-prod-store";

/**
 * Bootstraps store persistence when the app mounts. Renders nothing.
 *
 * Two layers, in order:
 *   1. Restore locally-saved data from localStorage (works fully offline). This
 *      runs after mount so the first client render still matches the server's
 *      seed render — avoiding a React hydration mismatch.
 *   2. Hand off to the cloud: when Supabase is configured and a user is signed
 *      in, `hydrate()` pulls the cloud copy (the source of truth) over the top.
 *
 * Doing this here (rather than per page) means every route — board, flashcards,
 * timer — shares the same restored state.
 */
export function CloudSyncProvider() {
  const hydrate = useProdStore((state) => state.hydrate);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 1. Local first — instant, offline-friendly.
      await useProdStore.persist.rehydrate();
      if (cancelled) return;
      // 2. Cloud takes over when configured + signed in.
      void hydrate();
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrate]);

  return null;
}
