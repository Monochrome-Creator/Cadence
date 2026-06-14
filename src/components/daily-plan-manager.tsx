"use client";

import { useEffect, useMemo } from "react";
import { format, isValid, parseISO } from "date-fns";
import { CalendarClock, Check, X } from "lucide-react";

import { useProdStore, type Task } from "@/store/use-prod-store";
import { cn } from "@/lib/utils";

/**
 * Headless coordinator for the auto-planner, mounted once in the root layout.
 *
 * Responsibilities:
 *   1. After the store hydrates, reopen any recurring tasks whose calendar
 *      period has elapsed, then ensure today's Daily Plan exists.
 *   2. Re-run that pass whenever the tab returns to the foreground, so a device
 *      left open overnight rolls over to the new day without a manual refresh.
 *   3. Surface the "you missed these" review modal when the previous day's plan
 *      had unfinished main tasks. Responding clears it so it won't repeat.
 *
 * Renders only the review modal (or nothing).
 */
export function DailyPlanManager() {
  const isHydrated = useProdStore((state) => state.isHydrated);
  const refreshRecurringTasks = useProdStore((state) => state.refreshRecurringTasks);
  const ensureDailyPlan = useProdStore((state) => state.ensureDailyPlan);

  // Day-rollover pass: reopen elapsed recurring tasks, then (re)build the plan.
  useEffect(() => {
    if (!isHydrated) return;

    const run = () => {
      refreshRecurringTasks();
      ensureDailyPlan();
    };
    run();

    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [isHydrated, refreshRecurringTasks, ensureDailyPlan]);

  return <DailyReviewModal />;
}

/** Render the missed-plan deadline as "Friday, 13 Jun" (or "yesterday"). */
function reviewDateLabel(date: string): string {
  const parsed = parseISO(date);
  if (!isValid(parsed)) return "your last plan";
  return format(parsed, "EEEE, d MMM");
}

function DailyReviewModal() {
  const pendingReview = useProdStore((state) => state.pendingReview);
  const tasks = useProdStore((state) => state.tasks);
  const dismissReview = useProdStore((state) => state.dismissReview);
  const planMoveToToday = useProdStore((state) => state.planMoveToToday);
  const planCompleteTask = useProdStore((state) => state.planCompleteTask);

  // Resolve the stored IDs against live tasks; skip any that were deleted or are
  // already done (e.g. completed elsewhere before the user opened the modal).
  const missed: Task[] = useMemo(() => {
    if (!pendingReview) return [];
    const byId = new Map(tasks.map((t) => [t.id, t] as const));
    return pendingReview.taskIds
      .map((id) => byId.get(id))
      .filter((t): t is Task => t != null && t.status !== "Done");
  }, [pendingReview, tasks]);

  // `pendingReview` is null until the store hydrates on the client, so the
  // server render and first client render both produce null — no flash.
  if (!pendingReview) return null;

  // Nothing left to review (all moved/completed/deleted) — clear it silently.
  if (missed.length === 0) {
    return <SilentDismiss onDone={dismissReview} />;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(40,33,28,0.35)] p-4 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-[var(--c-line)] bg-[var(--c-panel)] shadow-[0_12px_40px_rgba(74,64,54,0.18)]">
        <div className="flex items-start gap-3 px-5 pt-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#f6e6da] text-[#a35d4d]">
            <CalendarClock className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-xl font-semibold tracking-tight text-[var(--c-ink-2)]">
              Picking up where you left off
            </h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--c-ink-3)]">
              {missed.length === 1 ? "This task" : `These ${missed.length} tasks`}{" "}
              from {reviewDateLabel(pendingReview.date)} didn&rsquo;t get done. No
              pressure — just tidy it up.
            </p>
          </div>
          <button
            type="button"
            onClick={dismissReview}
            title="Skip for now"
            aria-label="Skip for now"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--c-dim)] transition-colors hover:bg-[var(--c-beige)] hover:text-[var(--c-ink-2)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <ul className="mt-4 flex max-h-[40vh] flex-col gap-2 overflow-y-auto px-5">
          {missed.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-2 rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel-soft)] p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-[var(--c-ink-2)]">
                  {task.title || "Untitled task"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => planCompleteTask(task.id)}
                title="Mark complete"
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#eef0e7] px-2.5 py-1.5 text-[12px] font-medium text-[#5f6b4a] transition-colors hover:bg-[#e3e8d6]"
              >
                <Check className="size-3.5" strokeWidth={2.5} />
                Done
              </button>
              <button
                type="button"
                onClick={() => planMoveToToday(task.id)}
                title="Move to today's plan"
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#f6e6da] px-2.5 py-1.5 text-[12px] font-medium text-[#a35d4d] transition-colors hover:bg-[#f0d8c6]"
              >
                Today
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <button
            type="button"
            onClick={dismissReview}
            className={cn(
              "rounded-full px-4 py-2 text-[13px] font-medium text-[var(--c-ink-3)] transition-colors",
              "hover:bg-[var(--c-beige)] hover:text-[var(--c-ink-2)]"
            )}
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

/** Clears a stale review (all items handled) once, after paint. */
function SilentDismiss({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    onDone();
  }, [onDone]);
  return null;
}
