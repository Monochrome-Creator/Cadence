"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, CalendarClock, Check, X } from "lucide-react";

import { NO_DEADLINE, useProdStore, type Task } from "@/store/use-prod-store";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*                       Missing-deadline reminder modal                       */
/* -------------------------------------------------------------------------- */

/**
 * An active board task that should have a deadline but doesn't. Done tasks are
 * finished and Inbox tasks haven't been triaged yet, so neither is nagged.
 * A task explicitly marked "no deadline" (the NO_DEADLINE sentinel) opted out.
 */
export function isMissingDeadline(task: Task): boolean {
  return (
    task.status !== "Done" && task.status !== "Inbox" && !task.deadline.trim()
  );
}

/**
 * Snooze record persisted in localStorage. `ids` are the no-deadline task ids
 * at dismissal time: if a NEW task without a deadline appears, it won't be in
 * the list and the reminder comes back early — otherwise it stays quiet until
 * `until`.
 */
type Snooze = { until: number; ids: string[] };

const SNOOZE_KEY = "cadence-deadline-nudge";
/** "Remind me later" — quiet for a few hours. */
const LATER_MS = 4 * 60 * 60 * 1000;
/** "Skip for now" — quiet for a day. */
const SKIP_MS = 24 * 60 * 60 * 1000;

function readSnooze(): Snooze | null {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snooze;
    if (typeof parsed.until !== "number" || !Array.isArray(parsed.ids)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSnooze(ms: number, ids: string[]) {
  try {
    localStorage.setItem(
      SNOOZE_KEY,
      JSON.stringify({ until: Date.now() + ms, ids } satisfies Snooze)
    );
  } catch {
    // Storage full/blocked — worst case the reminder reappears next visit.
  }
}

/**
 * Friendly "these tasks have no deadline" popup for /board.
 *
 * - Auto-opens (via `onAutoOpen`) once the store has hydrated when active
 *   tasks are missing deadlines — unless snoozed. Dismissing writes a snooze
 *   to localStorage so a refresh doesn't immediately re-nag; a brand-new
 *   no-deadline task re-triggers it early.
 * - Each listed task gets a visible native date input (mobile-friendly, no
 *   overlays); Save commits via the store's `updateTask`, so changes sync to
 *   Supabase exactly like an edit made on the card.
 * - Also offers the browser-notification permission prompt in context, instead
 *   of ambushing the user on page load.
 */
export function DeadlineReminderModal({
  open,
  onClose,
  onAutoOpen,
}: {
  open: boolean;
  onClose: () => void;
  onAutoOpen: () => void;
}) {
  const tasks = useProdStore((state) => state.tasks);
  const isHydrated = useProdStore((state) => state.isHydrated);
  const updateTask = useProdStore((state) => state.updateTask);

  const missing = useMemo(() => tasks.filter(isMissingDeadline), [tasks]);
  // Stable identity of the no-deadline set — the auto-open effect keys off
  // this, so it re-evaluates when a task gains/loses a deadline or is created.
  const missingKey = missing.map((t) => t.id).join("|");

  // Per-task draft dates (yyyy-MM-dd), committed together on Save.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Notification permission, for the in-modal enable button. Lazy init keeps
  // SSR happy (modal renders nothing until opened on the client anyway).
  const [notifPermission, setNotifPermission] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported"
  );

  useEffect(() => {
    if (!isHydrated || missing.length === 0) return;
    const snooze = readSnooze();
    if (
      snooze &&
      Date.now() < snooze.until &&
      missing.every((t) => snooze.ids.includes(t.id))
    ) {
      return;
    }
    onAutoOpen();
    // `missingKey` stands in for `missing`; onAutoOpen is a stable setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, missingKey]);

  if (!open || missing.length === 0) return null;

  const dismiss = (ms: number) => {
    writeSnooze(
      ms,
      missing.map((t) => t.id)
    );
    setDrafts({});
    onClose();
  };

  const save = () => {
    const unfilled: string[] = [];
    for (const task of missing) {
      const date = drafts[task.id];
      if (date) updateTask(task.id, { deadline: date });
      else unfilled.push(task.id);
    }
    // Don't re-nag immediately about the ones deliberately left blank.
    if (unfilled.length > 0) writeSnooze(SKIP_MS, unfilled);
    setDrafts({});
    onClose();
  };

  const enableNotifications = () => {
    void Notification.requestPermission().then(setNotifPermission);
  };

  const filledCount = missing.filter((t) => drafts[t.id]).length;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/30 backdrop-blur-[2px] sm:items-center sm:px-4"
      onClick={() => dismiss(LATER_MS)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Set missing deadlines"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-3xl border border-[var(--c-line)] bg-[var(--c-panel)] shadow-[0_20px_60px_rgba(74,64,54,0.25)] sm:rounded-2xl"
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--c-beige)] text-[#a35d4d]">
            <CalendarClock className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-lg font-semibold text-[var(--c-ink-2)]">
              A few tasks could use a deadline
            </h2>
            <p className="mt-0.5 text-[13px] leading-snug text-[var(--c-dim)]">
              Tasks with a date are easier to plan. Set one where it helps —
              or skip, no pressure.
            </p>
          </div>
          <button
            type="button"
            onClick={() => dismiss(LATER_MS)}
            aria-label="Close"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--c-dim)] transition-colors hover:bg-[var(--c-beige)] hover:text-[var(--c-ink-2)]"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Scrollable task list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <div className="flex flex-col gap-3 pb-2">
            {/* div, not label: a wrapping label would re-route taps on the
                "No deadline needed" button into the date input. */}
            {missing.map((task) => (
              <div
                key={task.id}
                className="flex flex-col gap-1.5 rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel-soft)] p-3"
              >
                <span className="text-[15px] leading-snug font-medium break-words text-[var(--c-ink-2)]">
                  {task.title || "Untitled task"}
                </span>
                <span className="text-[11.5px] text-[var(--c-dim)]">
                  {task.category.trim() || "General"} · {task.status}
                </span>
                <input
                  type="date"
                  value={
                    drafts[task.id] === NO_DEADLINE
                      ? ""
                      : (drafts[task.id] ?? "")
                  }
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [task.id]: e.target.value,
                    }))
                  }
                  aria-label={`Deadline for ${task.title || "untitled task"}`}
                  className="mt-0.5 block min-h-11 w-full appearance-none rounded-lg border border-[var(--c-line-strong)] bg-[var(--c-panel)] px-3 text-[16px] font-medium text-[var(--c-ink-2)] outline-none transition-colors [color-scheme:light] focus:border-[#a35d4d] focus:ring-2 focus:ring-[#a35d4d]/15 md:text-sm dark:[color-scheme:dark]"
                />
                {/* Opt this task out of deadlines entirely — it leaves the
                    reminder for good (until the deadline is cleared again). */}
                <button
                  type="button"
                  aria-pressed={drafts[task.id] === NO_DEADLINE}
                  onClick={() =>
                    setDrafts((prev) => ({
                      ...prev,
                      [task.id]:
                        prev[task.id] === NO_DEADLINE ? "" : NO_DEADLINE,
                    }))
                  }
                  className={cn(
                    "mt-1 flex min-h-9 items-center gap-1.5 self-start rounded-full border px-3 text-[13px] font-medium transition-colors",
                    drafts[task.id] === NO_DEADLINE
                      ? "border-[#a35d4d]/30 bg-[var(--c-beige-2)] text-[#a35d4d]"
                      : "border-[var(--c-line)] bg-transparent text-[var(--c-dim)] hover:bg-[var(--c-beige)] hover:text-[var(--c-ink-3)]"
                  )}
                >
                  {drafts[task.id] === NO_DEADLINE && (
                    <Check className="size-3.5" />
                  )}
                  No deadline needed
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Notification permission, offered in context rather than on load. */}
        {notifPermission === "default" && (
          <div className="mx-5 mt-1 flex items-center gap-2.5 rounded-xl bg-[var(--c-beige)] px-3 py-2.5">
            <Bell className="size-4 shrink-0 text-[#a35d4d]" />
            <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-[var(--c-ink-3)]">
              Want a heads-up when a deadline is close?
            </p>
            <button
              type="button"
              onClick={enableNotifications}
              className="shrink-0 rounded-lg bg-[#a35d4d] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#8f4f41]"
            >
              Enable
            </button>
          </div>
        )}

        {/* Actions — stacked, thumb-sized rows on phones. */}
        <div className="flex flex-col gap-2 p-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => dismiss(SKIP_MS)}
            className="min-h-11 rounded-xl px-4 text-sm font-medium text-[var(--c-dim)] transition-colors hover:bg-[var(--c-beige)] hover:text-[var(--c-ink-2)] sm:min-h-9"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={() => dismiss(LATER_MS)}
            className="min-h-11 rounded-xl border border-[var(--c-line-strong)] px-4 text-sm font-medium text-[var(--c-ink-3)] transition-colors hover:bg-[var(--c-beige)] sm:min-h-9"
          >
            Remind me later
          </button>
          <button
            type="button"
            onClick={save}
            disabled={filledCount === 0}
            className={cn(
              "min-h-11 rounded-xl bg-[#a35d4d] px-4 text-sm font-medium text-white transition-colors hover:bg-[#8f4f41] disabled:opacity-40 sm:min-h-9"
            )}
          >
            Save deadline{filledCount > 1 ? "s" : ""}
            {filledCount > 0 ? ` (${filledCount})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
