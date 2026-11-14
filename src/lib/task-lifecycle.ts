// The rules for finishing a task and for the Daily Action limit, in one place for the
// store and the REST API.
//
// A recurring task stays one card: finishing it marks it Done and stamps the calendar
// period it was finished in, and the app reopens it once that period has passed. A
// Done recurring task WITHOUT the stamp looks like one left over from an earlier
// period and is reopened at once, so every route to Done goes through completeTask.

import {
  format,
  getISOWeek,
  getISOWeekYear,
  getMonth,
  getQuarter,
  getYear,
} from "date-fns";

import type { Recurrence } from "@/store/use-prod-store";

/**
 * The GTD capacity constraint: at most this many *active* tasks may be promoted to
 * the Dashboard's Daily Action list at once. Keeps the day's commitments to a
 * focused, finishable handful.
 */
export const MAX_TODAY_TASKS = 5;

/** Statuses that do not take up a Daily Action slot: finished, or not yet triaged. */
export const NOT_ACTIVE_TODAY: readonly string[] = ["Done", "Inbox"];

type Completable = {
  status: string;
  recurrence: Recurrence;
  lastCompletedPeriod?: string;
};

/**
 * Calendar-period key for a recurring task: constant within one occurrence window,
 * different in the next.
 *   daily     -> "2026-06-14"   (the calendar day)
 *   weekly    -> "2026-W24"     (ISO week — Mon-anchored, year-correct at edges)
 *   monthly   -> "2026-06"      (calendar month)
 *   quarterly -> "2026-Q2"      (calendar quarter)
 */
export function periodKey(recurrence: Recurrence, date: Date): string {
  switch (recurrence) {
    case "daily":
      return format(date, "yyyy-MM-dd");
    case "weekly":
      return `${getISOWeekYear(date)}-W${String(getISOWeek(date)).padStart(2, "0")}`;
    case "monthly":
      return `${getYear(date)}-${String(getMonth(date) + 1).padStart(2, "0")}`;
    case "quarterly":
      return `${getYear(date)}-Q${getQuarter(date)}`;
    default:
      return format(date, "yyyy-MM-dd");
  }
}

/** The task as Done. A recurring task also gets the stamp that keeps it Done this period. */
export function completeTask<T extends Completable>(task: T, now: Date): T {
  return {
    ...task,
    status: "Done",
    ...(task.recurrence !== "none"
      ? { lastCompletedPeriod: periodKey(task.recurrence, now) }
      : {}),
  };
}

/** True when a finished recurring task belongs to an earlier period and should reopen. */
export function isDueToReopen(task: Completable, now: Date): boolean {
  return (
    task.recurrence !== "none" &&
    task.status === "Done" &&
    task.lastCompletedPeriod !== periodKey(task.recurrence, now)
  );
}

/**
 * Count of active Daily Action tasks: flagged isToday and neither Done nor in the
 * Inbox. Completed today-tasks don't count against the cap, so finishing one frees
 * a slot.
 */
export function countActiveToday(
  tasks: readonly { isToday?: boolean; status: string }[]
): number {
  return tasks.filter((t) => t.isToday && !NOT_ACTIVE_TODAY.includes(t.status))
    .length;
}
