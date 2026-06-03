"use client";

import { useProdStore } from "@/store/use-prod-store";

/**
 * Subtle cloud-connection indicator pinned to the top-right corner.
 *   - Green  → synced with Supabase.
 *   - Amber  → connecting / syncing in the background (pulses).
 *   - Red    → offline, running on local on-device data.
 *
 * The label shows on wider screens; on phones the dot stands alone with the
 * label available via the native tooltip (title) for a minimal footprint.
 */
const STATUS_CONFIG = {
  synced: { dot: "bg-emerald-500", label: "Synced to Cloud", pulse: false },
  connecting: { dot: "bg-amber-500", label: "Syncing…", pulse: true },
  offline: { dot: "bg-rose-500", label: "Offline Mode", pulse: false },
} as const;

export function ConnectionStatus() {
  const status = useProdStore((state) => state.connectionStatus);
  const { dot, label, pulse } = STATUS_CONFIG[status];

  return (
    <div
      role="status"
      aria-live="polite"
      title={label}
      className="fixed right-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-40 flex items-center gap-1.5 rounded-full border border-[var(--c-line)] bg-[var(--c-panel-soft)] px-2.5 py-1 text-xs font-medium text-[var(--c-ink-3)] shadow-sm backdrop-blur-sm md:right-4 md:top-4"
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
    </div>
  );
}
