/**
 * In-app console capture for mobile PWA debugging.
 *
 * Patches console.error / console.warn once (client-side) so every message
 * that would normally disappear into the hidden mobile browser console is
 * also stored here and can be read inside the DebugPanel UI.
 *
 * The originals are always called too — DevTools still works normally.
 */

import { create } from "zustand";

export type LogLevel = "error" | "warn";

export interface LogEntry {
  id: number;
  level: LogLevel;
  /** Human-readable HH:mm:ss timestamp. */
  time: string;
  message: string;
}

interface DebugLogState {
  entries: LogEntry[];
  add: (level: LogLevel, args: unknown[]) => void;
  clear: () => void;
}

let _counter = 0;

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.stack ?? a.message;
      try {
        // Capture non-enumerable properties (e.g. PostgrestError).
        return JSON.stringify(a, Object.getOwnPropertyNames(a as object), 2);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

function nowHms(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export const useDebugLog = create<DebugLogState>()((set) => ({
  entries: [],
  add(level, args) {
    const entry: LogEntry = {
      id: _counter++,
      level,
      time: nowHms(),
      message: formatArgs(args),
    };
    set((s) => ({ entries: [entry, ...s.entries].slice(0, 100) }));
  },
  clear: () => set({ entries: [] }),
}));

/* ----------------------------- console patch ----------------------------- */

let _patched = false;

/**
 * Call once (client-side) to start capturing console messages.
 * Idempotent — safe to call multiple times.
 */
export function patchConsole(): void {
  if (typeof window === "undefined" || _patched) return;
  _patched = true;

  const { add } = useDebugLog.getState();

  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    origError(...args);
    add("error", args);
  };

  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    add("warn", args);
  };
}
