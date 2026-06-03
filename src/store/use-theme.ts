"use client";

import { create } from "zustand";

/** localStorage key — must match the inline no-flash script in layout.tsx. */
const STORAGE_KEY = "cadence-theme";

/** Toggle the root `.dark` class and persist the choice. */
function applyDark(dark: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
  } catch {
    // Private-mode / blocked storage — theme still applies for this session.
  }
}

interface ThemeState {
  dark: boolean;
  setDark: (dark: boolean) => void;
  toggle: () => void;
  /** Adopt whatever the pre-paint script already put on <html>. */
  syncFromDom: () => void;
}

/**
 * Lightweight theme store. The actual `.dark` class is set before paint by an
 * inline script (see layout.tsx) to avoid a flash; this store mirrors that for
 * React and drives the toggle button.
 */
export const useThemeStore = create<ThemeState>((set, get) => ({
  dark: false,
  setDark: (dark) => {
    applyDark(dark);
    set({ dark });
  },
  toggle: () => get().setDark(!get().dark),
  syncFromDom: () => {
    if (typeof document === "undefined") return;
    set({ dark: document.documentElement.classList.contains("dark") });
  },
}));
