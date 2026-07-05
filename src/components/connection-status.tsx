"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, RefreshCw } from "lucide-react";

import { useProdStore } from "@/store/use-prod-store";
import { getSupabaseClient } from "@/utils/supabase/client";

/**
 * Cloud-connection indicator pinned to the top-right corner.
 *   - Green  → synced with Supabase.
 *   - Amber  → connecting / syncing in the background (pulses).
 *   - Red    → offline.
 *
 * Tapping the dot opens a small menu with two recovery actions:
 *   - Reconnect — force a fresh sync (refreshes an expired token and pulls the
 *     latest tasks). Enough whenever the session is still recoverable.
 *   - Sign out & re-link — when the refresh token is gone for good, the only
 *     real fix is to re-authenticate; this clears the dead session and routes
 *     to /login so a clean session replaces the wedged one.
 */
const STATUS_CONFIG = {
  synced: { dot: "bg-emerald-500", label: "Synced", pulse: false },
  connecting: { dot: "bg-amber-500", label: "Syncing…", pulse: true },
  offline: { dot: "bg-rose-500", label: "Offline", pulse: false },
  // Distinct from "offline": the device is online but the server rejected the
  // write (auth/RLS/schema). Orange so it reads as "attention" not "no network".
  error: { dot: "bg-orange-500", label: "Sync error", pulse: false },
} as const;

export function ConnectionStatus() {
  const status = useProdStore((state) => state.connectionStatus);
  const lastSyncError = useProdStore((state) => state.lastSyncError);
  const forceSync = useProdStore((state) => state.forceSync);
  const clearLocalData = useProdStore((state) => state.clearLocalData);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { dot, label, pulse } = STATUS_CONFIG[status];

  // Close the menu on any click/tap outside it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const reconnect = () => {
    setOpen(false);
    void forceSync();
  };

  const signOut = async () => {
    setOpen(false);
    const supabase = getSupabaseClient();
    if (supabase) await supabase.auth.signOut();
    // Wipe the on-device cache on explicit sign-out so no account data lingers
    // on a shared device (and no stale unsynced outbox carries into a re-link).
    clearLocalData();
    router.replace("/login");
    router.refresh();
  };

  return (
    <div
      ref={containerRef}
      className="fixed top-[calc(env(safe-area-inset-top)+0.5rem)] right-3 z-40 md:top-4 md:right-4"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Connection: ${label}. Open sync menu`}
        title={label}
        className="flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--c-line)] bg-[var(--c-panel-soft)] px-2.5 py-1 text-xs font-medium text-[var(--c-ink-3)] shadow-sm backdrop-blur-sm transition-opacity hover:opacity-80 active:opacity-60"
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

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] p-1 shadow-[0_8px_30px_rgba(74,64,54,0.18)]"
        >
          {status === "error" && lastSyncError && (
            <p className="m-1 rounded-lg bg-orange-50 px-3 py-2 text-[11px] leading-snug break-words text-orange-900">
              {lastSyncError}
            </p>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={reconnect}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-[var(--c-ink-3)] transition-colors hover:bg-[var(--c-beige)]"
          >
            <RefreshCw className="size-3.5 shrink-0 text-[var(--c-dim)]" />
            Reconnect
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-[#9b3b3b] transition-colors hover:bg-[#f6e0e0]"
          >
            <LogOut className="size-3.5 shrink-0" />
            Sign out &amp; re-link
          </button>
        </div>
      )}
    </div>
  );
}
