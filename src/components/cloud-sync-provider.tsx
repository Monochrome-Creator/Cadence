"use client";

import { useEffect } from "react";

import { useProdStore } from "@/store/use-prod-store";

/**
 * Kicks off the one-time cloud hydration when the app mounts. Renders nothing.
 * Pulling here (rather than inside a page) ensures every route — board,
 * flashcards, dashboard — shares the same synced state.
 */
export function CloudSyncProvider() {
  const hydrate = useProdStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return null;
}
