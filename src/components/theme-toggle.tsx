"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { useThemeStore } from "@/store/use-theme";

/**
 * Sun/moon theme toggle. Shows the icon for the mode you'd switch TO. Renders a
 * stable neutral icon until mounted so the server and first client paint agree,
 * then reflects the real (pre-paint) theme.
 */
export function ThemeToggle({ size = 42 }: { size?: number }) {
  const dark = useThemeStore((s) => s.dark);
  const toggle = useThemeStore((s) => s.toggle);
  const syncFromDom = useThemeStore((s) => s.syncFromDom);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    syncFromDom();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time post-mount flag to avoid an SSR/client icon mismatch
    setMounted(true);
  }, [syncFromDom]);

  const showDark = mounted && dark;

  return (
    <button
      type="button"
      onClick={toggle}
      title={showDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={showDark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex shrink-0 items-center justify-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] text-[var(--c-accent)] shadow-[0_1px_3px_rgba(74,64,54,0.06)] transition-colors hover:bg-[var(--c-beige-2)]"
      style={{ width: size, height: size }}
    >
      {showDark ? (
        <Sun style={{ width: size * 0.42, height: size * 0.42 }} />
      ) : (
        <Moon style={{ width: size * 0.42, height: size * 0.42 }} />
      )}
    </button>
  );
}
