"use client";

import { useEffect, useRef, useState } from "react";
import { Bug, Copy, Trash2, X } from "lucide-react";

import { patchConsole, useDebugLog } from "@/store/use-debug-log";
import { cn } from "@/lib/utils";

/* ----------------------- console patch (mount once) ---------------------- */

function ConsoleCapture() {
  useEffect(() => {
    patchConsole();
  }, []);
  return null;
}

/* ------------------------------ copy helper ------------------------------ */

function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
  } else {
    // Fallback for older mobile WebViews.
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.focus();
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
}

/* ------------------------------- panel UI -------------------------------- */

export function DebugPanel() {
  const entries = useDebugLog((s) => s.entries);
  const clear = useDebugLog((s) => s.clear);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<number | "all" | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const errorCount = entries.filter((e) => e.level === "error").length;
  const warnCount = entries.filter((e) => e.level === "warn").length;

  function handleCopy(id: number, message: string) {
    copyText(message);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  function handleCopyAll() {
    const text = entries
      .map((e) => `[${e.time}] ${e.level.toUpperCase()}: ${e.message}`)
      .join("\n\n");
    copyText(text);
    setCopied("all");
    setTimeout(() => setCopied(null), 1500);
  }

  // Close on backdrop tap.
  function handleBackdropClick(e: React.MouseEvent) {
    if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }

  // Don't render the trigger when there's nothing to show.
  if (entries.length === 0 && !open) {
    return <ConsoleCapture />;
  }

  return (
    <>
      <ConsoleCapture />

      {/* Floating trigger button — above mobile nav on small screens */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open debug log"
          className={cn(
            "fixed z-50 flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium shadow-lg transition-all",
            // Position: above mobile bottom nav on mobile, simple bottom-right on desktop.
            "bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-4 md:bottom-6 md:right-6",
            errorCount > 0
              ? "bg-red-600 text-white"
              : "bg-yellow-500 text-yellow-950"
          )}
        >
          <Bug className="size-3.5" />
          {errorCount > 0 && <span>{errorCount} error{errorCount !== 1 ? "s" : ""}</span>}
          {errorCount === 0 && warnCount > 0 && <span>{warnCount} warn{warnCount !== 1 ? "s" : ""}</span>}
        </button>
      )}

      {/* Backdrop + slide-up drawer */}
      {open && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm"
          onClick={handleBackdropClick}
        >
          <div
            ref={drawerRef}
            className="flex max-h-[78vh] flex-col rounded-t-3xl bg-[var(--c-cream)] shadow-2xl"
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-[var(--c-line-strong)]" />
            </div>

            {/* Header */}
            <div className="flex items-center gap-2 border-b border-[var(--c-line)] px-4 py-3">
              <Bug className="size-4 text-[var(--c-accent)]" />
              <span className="flex-1 font-heading text-base font-semibold text-[var(--c-ink)]">
                Debug Log
              </span>
              {entries.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={handleCopyAll}
                    title="Copy all entries"
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--c-ink-3)] transition-colors hover:bg-[var(--c-beige)] hover:text-[var(--c-ink)]"
                  >
                    <Copy className="size-3.5" />
                    {copied === "all" ? "Copied!" : "Copy all"}
                  </button>
                  <button
                    type="button"
                    onClick={clear}
                    title="Clear log"
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--c-dim)] transition-colors hover:bg-[var(--c-beige)] hover:text-red-600"
                  >
                    <Trash2 className="size-3.5" />
                    Clear
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close debug log"
                className="ml-1 flex size-7 items-center justify-center rounded-full text-[var(--c-dim)] transition-colors hover:bg-[var(--c-beige)] hover:text-[var(--c-ink)]"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Entries list */}
            <div className="flex-1 overflow-y-auto px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
              {entries.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--c-dim)]">No log entries.</p>
              ) : (
                <div className="space-y-2">
                  {entries.map((entry) => (
                    <div
                      key={entry.id}
                      className={cn(
                        "group relative rounded-2xl border p-3 text-xs",
                        entry.level === "error"
                          ? "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30"
                          : "border-yellow-200 bg-yellow-50 dark:border-yellow-900/40 dark:bg-yellow-950/20"
                      )}
                    >
                      <div className="mb-1.5 flex items-center gap-2">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                            entry.level === "error"
                              ? "bg-red-600 text-white"
                              : "bg-yellow-500 text-yellow-950"
                          )}
                        >
                          {entry.level}
                        </span>
                        <span className="font-mono text-[10px] text-[var(--c-dim)]">
                          {entry.time}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy(entry.id, entry.message)}
                          title="Copy this entry"
                          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--c-dim)] transition-colors hover:bg-white/60 hover:text-[var(--c-ink)]"
                        >
                          <Copy className="size-3" />
                          {copied === entry.id ? "Copied!" : "Copy"}
                        </button>
                      </div>
                      {/* Selectable message so user can manually long-press select too */}
                      <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-[var(--c-ink-2)] select-text">
                        {entry.message}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
