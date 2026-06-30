"use client";

import { useEffect, useMemo, useRef } from "react";
import { format, isValid, parseISO } from "date-fns";

import { useProdStore, type Task } from "@/store/use-prod-store";
import { useToastStore } from "@/store/use-toast";

/* -------------------------------------------------------------------------- */
/*                          Critical-overload guard                           */
/* -------------------------------------------------------------------------- */

/**
 * Most Critical-priority tasks that may share a single deadline day before we
 * warn. Piling more than this onto one date is the classic over-commit that
 * guarantees something slips — so the 4th triggers a nudge.
 */
const CRITICAL_PER_DAY_LIMIT = 3;

/** Pull the yyyy-MM-dd out of a stored deadline, or "" if unset/invalid. */
function deadlineIso(deadline: string): string {
  const match = deadline.match(/\d{4}-\d{2}-\d{2}/);
  return match && isValid(parseISO(match[0])) ? match[0] : "";
}

/** An active (non-Done, non-Inbox) Critical task that has a real deadline. */
function isHeavy(task: Task): boolean {
  return (
    task.priority === "Critical" &&
    task.status !== "Done" &&
    task.status !== "Inbox" &&
    !!deadlineIso(task.deadline)
  );
}

/**
 * Headless guard, mounted once in the root layout. Watches the task list and
 * fires a high-visibility toast the moment an edit (anywhere — board, calendar,
 * inbox) pushes a deadline day past {@link CRITICAL_PER_DAY_LIMIT} Critical
 * tasks. It warns rather than blocks: real deadlines are often externally
 * fixed, so the smart move is awareness, not a hard wall.
 */
export function OverloadGuard() {
  const isHydrated = useProdStore((s) => s.isHydrated);
  const tasks = useProdStore((s) => s.tasks);
  const showToast = useToastStore((s) => s.showToast);

  // Deadline dates currently holding MORE than the limit of Critical tasks,
  // mapped to their count.
  const overloaded = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) {
      if (!isHeavy(t)) continue;
      const iso = deadlineIso(t.deadline);
      counts.set(iso, (counts.get(iso) ?? 0) + 1);
    }
    const result = new Map<string, number>();
    for (const [iso, n] of counts) {
      if (n > CRITICAL_PER_DAY_LIMIT) result.set(iso, n);
    }
    return result;
  }, [tasks]);

  // Stable signature so the effect only re-runs when the overloaded set changes.
  const overloadedKey = [...overloaded.entries()]
    .map(([iso, n]) => `${iso}:${n}`)
    .sort()
    .join("|");

  // Dates we've already warned about. Seeded once after hydration so a day that
  // was ALREADY overloaded on login doesn't spam a toast every visit — we only
  // alert when a fresh edit newly pushes a day over the limit.
  const warnedRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!isHydrated) return;
    // First run after hydration: record the baseline silently.
    if (warnedRef.current === null) {
      warnedRef.current = new Set(overloaded.keys());
      return;
    }
    const warned = warnedRef.current;
    for (const [iso, n] of overloaded) {
      if (warned.has(iso)) continue;
      warned.add(iso);
      showToast({
        variant: "error",
        message: `${n} Critical tasks now share ${format(
          parseISO(iso),
          "d MMM"
        )}. Stacking heavy work on one day is how deadlines slip — spread them out.`,
      });
    }
    // Forget days that dropped back under the limit so a later re-crossing alerts again.
    for (const iso of warned) {
      if (!overloaded.has(iso)) warned.delete(iso);
    }
    // `overloadedKey` is the stable stand-in for `overloaded`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, overloadedKey]);

  return null;
}
