"use client";

import { useProdStore } from "@/store/use-prod-store";

/**
 * Cloud-connection indicator pinned to the top-right corner.
 *   - Green  → synced with Supabase.
 *   - Amber  → connecting / syncing in the background (pulses).
 *   - Red    → offline — tap/click to retry the sync immediately.
 *
 * Tapping when synced also triggers a forceSync so the user can pull the
 * latest tasks from the cloud on any device without reloading the page.
 */
const STATUS_CONFIG = {
  synced: {
    dot: "bg-emerald-500",
    label: "Synced",
    hint: "Tap to pull latest",
    pulse: false,
    clickable: true,
  },
  connecting: {
    dot: "bg-amber-500",
    label: "Syncing…",
    hint: "Syncing…",
    pulse: true,
    clickable: false,
  },
  offline: {
    dot: "bg-rose-500",
    label: "Offline — tap to retry",
    hint: "Tap to retry sync",
    pulse: false,
    clickable: true,
  },
} as const;

export function ConnectionStatus() {
  const status = useProdStore((state) => state.connectionStatus);
  const forceSync = useProdStore((state) => state.forceSync);
  const { dot, label, hint, pulse, clickable } = STATUS_CONFIG[status];

  return (
    <button
      type="button"
      onClick={clickable ? () => void forceSync() : undefined}
      disabled={!clickable}
      aria-label={hint}
      title={hint}
      className="fixed right-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-40 flex items-center gap-1.5 rounded-full border border-[var(--c-line)] bg-[var(--c-panel-soft)] px-2.5 py-1 text-xs font-medium text-[var(--c-ink-3)] shadow-sm backdrop-blur-sm transition-opacity md:right-4 md:top-4 disabled:cursor-default enabled:cursor-pointer enabled:hover:opacity-80 enabled:active:opacity-60"
    >
      <span className="relative flex size-2">
        {pulse && (
          <span
            className={`absolute inline-flex size-full animate-ping rounded-full ${dot} opacity-60`}
          />
        )}
        <span className={`relative inline-flex size-2 rounded-full ${dot}`} />
      </span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
