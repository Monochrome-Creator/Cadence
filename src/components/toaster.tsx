"use client";

import { TriangleAlert, X } from "lucide-react";

import { useToastStore } from "@/store/use-toast";
import { cn } from "@/lib/utils";

/**
 * Fixed toast stack, centered along the bottom (above the mobile nav bar). The
 * "error" variant is the high-visibility red treatment used by the GTD capacity
 * guard; "default" is a neutral warm panel. Auto-dismiss is handled by the
 * store — here we only render and offer a manual close.
 */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismissToast = useToastStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((toast) => {
        const isError = toast.variant === "error";
        return (
          <div
            key={toast.id}
            role="alert"
            aria-live="assertive"
            className={cn(
              "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border px-4 py-3 shadow-[0_8px_28px_rgba(74,64,54,0.18)] [animation:toast-in_0.22s_cubic-bezier(0.2,0.7,0.3,1)]",
              isError
                ? "border-[#d68b85] bg-[#c2453f] text-white"
                : "border-[var(--c-line)] bg-[var(--c-panel)] text-[var(--c-ink-2)]"
            )}
          >
            {isError && (
              <TriangleAlert className="mt-0.5 size-5 shrink-0" strokeWidth={2.2} />
            )}
            <p className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug">
              {toast.message}
            </p>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss"
              className={cn(
                "-mr-1 -mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full transition-colors",
                isError
                  ? "text-white/80 hover:bg-white/15 hover:text-white"
                  : "text-[var(--c-dim)] hover:bg-[var(--c-beige)] hover:text-[var(--c-ink-2)]"
              )}
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
