"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { format, isValid, parseISO } from "date-fns";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Repeat,
  SkipForward,
  Trash2,
  X,
} from "lucide-react";

import { todayKey, useProdStore, type Task } from "@/store/use-prod-store";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*                          Overdue review modal                              */
/* -------------------------------------------------------------------------- */

/**
 * After a task has been pushed back this many times, the review stops offering
 * a frictionless reschedule and nudges the user to actually decide — the
 * "three strikes" commitment device that breaks the postpone-forever loop.
 */
const STRIKES_LIMIT = 3;

/** Pull the yyyy-MM-dd out of a stored deadline, or "" if unset/invalid. */
function deadlineIso(deadline: string): string {
  const match = deadline.match(/\d{4}-\d{2}-\d{2}/);
  return match && isValid(parseISO(match[0])) ? match[0] : "";
}

/** An active, non-Inbox task whose deadline is in the past. */
function isOverdue(task: Task, today: string): boolean {
  if (task.status === "Done" || task.status === "Inbox") return false;
  const iso = deadlineIso(task.deadline);
  return !!iso && iso < today;
}

/** Render a stored deadline as "14 Jun" (or "" when unset/invalid). */
function dueLabel(deadline: string): string {
  const iso = deadlineIso(deadline);
  return iso ? format(parseISO(iso), "d MMM") : "";
}

/** Short label for a repeat interval, e.g. "week" for a weekly task. */
function recurrenceUnit(recurrence: Task["recurrence"]): string {
  switch (recurrence) {
    case "daily":
      return "day";
    case "weekly":
      return "week";
    case "monthly":
      return "month";
    case "quarterly":
      return "quarter";
    default:
      return "";
  }
}

/**
 * Snooze record persisted in localStorage. `ids` are the overdue task ids at
 * dismissal: if a NEW task falls overdue it won't be in the list, so the review
 * comes back early — otherwise it stays quiet until `until`.
 */
type Snooze = { until: number; ids: string[] };

const SNOOZE_KEY = "cadence-overdue-nudge";
/** "Later" — quiet for a few hours. */
const LATER_MS = 4 * 60 * 60 * 1000;
/** "Not now" — quiet for ~a day. */
const SKIP_MS = 20 * 60 * 60 * 1000;

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
    // Storage full/blocked — worst case the review reappears next visit.
  }
}

/**
 * "These tasks are past due — what now?" popup, mounted once in the root layout
 * so it surfaces on every visit (not just the board). Auto-opens after hydrate
 * when active tasks are overdue, unless snoozed or the missed-day review is
 * already up (we never stack two popups). Each task can be rescheduled (which
 * bumps its postpone count), marked done, or dropped. Once a task has been
 * postponed {@link STRIKES_LIMIT}× the easy reschedule steps aside to push a
 * real decision.
 */
export function OverdueReviewModal() {
  const isHydrated = useProdStore((s) => s.isHydrated);
  const tasks = useProdStore((s) => s.tasks);
  const pendingReview = useProdStore((s) => s.pendingReview);
  const postponeTask = useProdStore((s) => s.postponeTask);
  const skipRecurrence = useProdStore((s) => s.skipRecurrence);
  const completeAndRepeatTask = useProdStore((s) => s.completeAndRepeatTask);
  const updateTask = useProdStore((s) => s.updateTask);
  const deleteTask = useProdStore((s) => s.deleteTask);

  // Auth screens (login / password reset / OAuth callback) render their own
  // full-bleed layout with no app chrome and no real session yet — the review
  // must never surface there, even if localStorage still holds overdue tasks
  // from a previous session.
  const pathname = usePathname();
  const isAuthRoute =
    pathname === "/login" ||
    pathname === "/reset" ||
    pathname.startsWith("/auth");

  const today = todayKey();
  const overdue = useMemo(
    () => tasks.filter((t) => isOverdue(t, today)),
    [tasks, today]
  );
  // Stable identity of the overdue set — the auto-open effect keys off this so
  // it re-evaluates when a task falls overdue or is resolved.
  const overdueKey = overdue.map((t) => t.id).join("|");

  const [open, setOpen] = useState(false);
  // Per-task draft reschedule dates (yyyy-MM-dd).
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    // Don't stack on top of the "you missed these" review; wait our turn.
    // Never auto-open on auth screens (no session yet).
    if (isAuthRoute || !isHydrated || pendingReview || overdue.length === 0)
      return;
    const snooze = readSnooze();
    if (
      snooze &&
      Date.now() < snooze.until &&
      overdue.every((t) => snooze.ids.includes(t.id))
    ) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-open once the overdue set is known after hydration.
    setOpen(true);
    // `overdueKey` stands in for `overdue`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthRoute, isHydrated, overdueKey, pendingReview]);

  if (isAuthRoute || !open || overdue.length === 0) return null;

  const dismiss = (ms: number) => {
    writeSnooze(
      ms,
      overdue.map((t) => t.id)
    );
    setDrafts({});
    setOpen(false);
  };

  const reschedule = (id: string) => {
    const date = drafts[id];
    if (!date) return;
    postponeTask(id, date);
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(40,33,28,0.35)] p-4 backdrop-blur-sm sm:items-center"
      onClick={() => dismiss(LATER_MS)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Overdue tasks review"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-[var(--c-line)] bg-[var(--c-panel)] shadow-[0_20px_60px_rgba(74,64,54,0.25)]"
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#f6e6da] text-[#a35d4d]">
            <CalendarClock className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-xl font-semibold tracking-tight text-[var(--c-ink-2)]">
              Past due — what now?
            </h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--c-ink-3)]">
              {overdue.length === 1 ? "This task is" : `These ${overdue.length} tasks are`}{" "}
              past their date. Give it a new day, finish it, or let it go — small
              decisions beat a growing pile.
            </p>
          </div>
          <button
            type="button"
            onClick={() => dismiss(LATER_MS)}
            title="Later"
            aria-label="Later"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--c-dim)] transition-colors hover:bg-[var(--c-beige)] hover:text-[var(--c-ink-2)]"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Scrollable task list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <div className="flex flex-col gap-3 pb-2">
            {overdue.map((task) => {
              const repeats = task.recurrence !== "none";
              const unit = recurrenceUnit(task.recurrence);
              const strikes = task.postponeCount ?? 0;
              // Strikes/escalation only apply to one-off tasks — a repeating task
              // is meant to keep coming back, so it never "runs out of moves".
              const escalated = !repeats && strikes >= STRIKES_LIMIT;
              const due = dueLabel(task.deadline);

              return (
                <div
                  key={task.id}
                  className={cn(
                    "flex flex-col gap-2 rounded-2xl border p-3",
                    escalated
                      ? "border-[#e7b9ad] bg-[#fbeee8]"
                      : "border-[var(--c-line)] bg-[var(--c-panel-soft)]"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[14.5px] leading-snug font-medium break-words text-[var(--c-ink-2)]">
                        {task.title || "Untitled task"}
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-[var(--c-dim)]">
                        {due && `was due ${due}`}
                        {due && task.category.trim() ? " · " : ""}
                        {task.category.trim() || (!due ? task.status : "")}
                      </p>
                    </div>
                    {repeats ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#eae4f2] px-2 py-0.5 text-[11px] font-semibold text-[#6b5b8a] capitalize">
                        <Repeat className="size-3" />
                        {task.recurrence}
                      </span>
                    ) : (
                      strikes > 0 && (
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            escalated
                              ? "bg-[#f6dada] text-[#9b3b3b]"
                              : "bg-[var(--c-beige-2)] text-[var(--c-dim)]"
                          )}
                        >
                          Moved {strikes}×
                        </span>
                      )
                    )}
                  </div>

                  {escalated && (
                    <p className="flex items-center gap-1.5 text-[12px] font-medium text-[#9b3b3b]">
                      <AlertTriangle className="size-3.5 shrink-0" />
                      Postponed {strikes} times. Finish it, shrink it, or drop it.
                    </p>
                  )}

                  {repeats && (
                    <p className="flex items-center gap-1.5 text-[12px] text-[var(--c-dim)]">
                      <Repeat className="size-3.5 shrink-0 text-[#6b5b8a]" />
                      Repeats {task.recurrence}. Skip this one to bump it to the
                      next {unit} — the repeat day stays put.
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {repeats ? (
                      <button
                        type="button"
                        onClick={() => skipRecurrence(task.id)}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#a35d4d] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[#8f4f41]"
                      >
                        <SkipForward className="size-3.5" />
                        Skip to next {unit}
                      </button>
                    ) : (
                      <>
                        <input
                          type="date"
                          min={today}
                          value={drafts[task.id] ?? ""}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [task.id]: e.target.value,
                            }))
                          }
                          aria-label={`New date for ${task.title || "untitled task"}`}
                          className="h-9 min-w-0 flex-1 appearance-none rounded-lg border border-[var(--c-line-strong)] bg-[var(--c-panel)] px-2.5 text-[13px] font-medium text-[var(--c-ink-2)] outline-none transition-colors [color-scheme:light] focus:border-[#a35d4d] dark:[color-scheme:dark]"
                        />
                        <button
                          type="button"
                          onClick={() => reschedule(task.id)}
                          disabled={!drafts[task.id]}
                          className={cn(
                            "inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-[13px] font-medium transition-colors disabled:opacity-40",
                            escalated
                              ? "text-[var(--c-dim)] hover:bg-[var(--c-beige)] hover:text-[var(--c-ink-3)]"
                              : "bg-[#a35d4d] text-white hover:bg-[#8f4f41]"
                          )}
                        >
                          {escalated ? "Postpone again" : "Reschedule"}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        repeats
                          ? completeAndRepeatTask(task.id)
                          : updateTask(task.id, { status: "Done" })
                      }
                      title="Mark done"
                      className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-[#eef0e7] px-3 text-[13px] font-medium text-[#5f6b4a] transition-colors hover:bg-[#e3e8d6]"
                    >
                      <Check className="size-3.5" strokeWidth={2.5} />
                      Done
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTask(task.id)}
                      title="Drop this task"
                      aria-label="Drop this task"
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-[var(--c-dim)] transition-colors hover:bg-[#f6dada] hover:text-[#9b3b3b]"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-5">
          <button
            type="button"
            onClick={() => dismiss(SKIP_MS)}
            className="rounded-full px-4 py-2 text-[13px] font-medium text-[var(--c-ink-3)] transition-colors hover:bg-[var(--c-beige)] hover:text-[var(--c-ink-2)]"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
