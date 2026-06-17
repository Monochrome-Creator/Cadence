"use client";

import { useEffect, useState } from "react";
import { LogOut, Sparkles } from "lucide-react";

import { exitDemo, IS_DEMO } from "@/store/use-prod-store";

/**
 * Slim banner shown only in demo mode. Makes it obvious the data is a sandbox
 * and gives a one-click way back to the real sign-in screen.
 *
 * `IS_DEMO` is a module constant read at load; gating the render behind a
 * mounted flag keeps the server and first client render identical (both null),
 * avoiding a hydration mismatch.
 */
export function DemoBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the module-load demo flag after mount
    setShow(IS_DEMO);
  }, []);

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-[#a35d4d] px-4 py-1.5 text-xs font-medium text-white shadow-sm">
      <span className="flex items-center gap-1.5">
        <Sparkles className="size-3.5" />
        Demo mode — this is a sample workspace, not your account.
      </span>
      <button
        type="button"
        onClick={() => exitDemo()}
        className="inline-flex items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 font-semibold transition-colors hover:bg-white/25"
      >
        <LogOut className="size-3" />
        Exit demo
      </button>
    </div>
  );
}
