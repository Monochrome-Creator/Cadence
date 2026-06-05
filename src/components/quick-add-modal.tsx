"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Inbox as InboxIcon } from "lucide-react";

import { useProdStore } from "@/store/use-prod-store";

/**
 * Global Quick-Add modal — a frictionless capture surface that floats above the
 * whole app. Cmd+K (Mac) / Ctrl+K (Windows) opens it from anywhere; submitting
 * drops the task straight into the Inbox (status "Inbox") without navigating
 * away from the current page. Esc or a backdrop click dismisses it.
 */
export function QuickAddModal() {
  const pathname = usePathname();
  const addTask = useProdStore((state) => state.addTask);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auth screens render their own full-bleed layout — no app chrome there.
  const isAuthRoute = pathname === "/login" || pathname.startsWith("/auth");

  // Global keyboard shortcut: Cmd/Ctrl+K toggles the modal; Esc closes it.
  useEffect(() => {
    if (isAuthRoute) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isAuthRoute]);

  // Focus the field whenever the modal opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (isAuthRoute || !open) return null;

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    addTask({
      title: trimmed,
      status: "Inbox",
      priority: "Medium",
      deadline: "",
      pomodorosLogged: 0,
    });
    setDraft("");
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 px-4 pt-[18vh] backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick add to inbox"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] p-2 shadow-[0_20px_60px_rgba(74,64,54,0.25)]"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-center gap-3 rounded-xl px-3 py-2"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#e9e6f0] text-[#6a5b88]">
            <InboxIcon className="size-[18px]" />
          </span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add to inbox…"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-[var(--c-ink-2)] placeholder:text-[var(--c-dim)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="shrink-0 rounded-lg bg-[#a35d4d] px-4 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-[#8f4f41] disabled:opacity-40"
          >
            Add
          </button>
        </form>
        <div className="flex items-center justify-between px-4 pt-1 pb-2 text-[11.5px] text-[var(--c-dim)]">
          <span>Drops straight into your Inbox</span>
          <span>
            <kbd className="rounded border border-[var(--c-line)] bg-[var(--c-beige)] px-1.5 py-0.5 font-mono">
              Esc
            </kbd>{" "}
            to close
          </span>
        </div>
      </div>
    </div>
  );
}
