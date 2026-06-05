"use client";

import Link from "next/link";
import { format, isValid, parseISO } from "date-fns";
import { ArrowRight, CalendarDays, Repeat, X } from "lucide-react";

import {
  useProdStore,
  type Recurrence,
  type Task,
} from "@/store/use-prod-store";
import { cn } from "@/lib/utils";

/** Human labels for each recurrence interval. */
const RECURRENCE_LABELS: Record<Recurrence, string> = {
  none: "No repeat",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

/** Render the stored deadline as "29 May 2026" (or "" when unset/invalid). */
function formatDeadline(deadline: string): string {
  const match = deadline.match(/\d{4}-\d{2}-\d{2}/);
  if (!match || !isValid(parseISO(match[0]))) return "";
  return format(parseISO(match[0]), "dd MMM yyyy");
}

function ScheduleRow({
  task,
  onCancel,
}: {
  task: Task;
  onCancel: (id: string) => void;
}) {
  const nextDue = formatDeadline(task.deadline);
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[0_1px_4px_rgba(74,64,54,0.04)]">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#f6e6da] text-[#a35d4d]">
        <Repeat className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-[var(--c-ink-2)]">
          {task.title || "Untitled task"}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[var(--c-dim)]">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#f6e6da] px-2 py-0.5 text-[11px] font-medium text-[#a35d4d]">
            <Repeat className="size-3" />
            {RECURRENCE_LABELS[task.recurrence]}
          </span>
          {nextDue && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-3.5 text-[var(--c-faint)]" />
              Next: {nextDue}
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onCancel(task.id)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--c-line)] bg-[var(--c-panel-soft)] px-3 py-2 text-[12.5px] font-medium text-[#9b3b3b] transition-colors hover:border-[#e7c4c4] hover:bg-[#f6e0e0]"
      >
        <X className="size-3.5" />
        Cancel Recurrence
      </button>
    </div>
  );
}

export default function RecurringPage() {
  const tasks = useProdStore((state) => state.tasks);
  const cancelRecurrence = useProdStore((state) => state.cancelRecurrence);

  // All tasks with an active schedule (recurrence is not "none"). The store is
  // hydrated straight from Supabase, so filtering it here is the synced view.
  const scheduled = tasks.filter((t) => t.recurrence !== "none");

  return (
    <div className="px-5 py-7 md:px-8 md:py-10">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 md:gap-[22px]">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--c-dim)]">
              <Repeat className="size-4 text-[#a35d4d]" />
              <span>Scheduled Tasks</span>
            </div>
            <h1 className="font-heading mt-2.5 text-3xl leading-tight font-semibold tracking-tight text-[var(--c-ink-2)] md:text-[38px]">
              Recurring Templates
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--c-ink-3)]">
              Audit every task that spawns a fresh copy on completion. Cancel a
              schedule to stop it from cloning.
            </p>
          </div>
          <Link
            href="/board"
            className="inline-flex shrink-0 items-center gap-1.5 text-[13.5px] font-medium text-[#a35d4d] hover:underline"
          >
            Open board <ArrowRight className="size-[15px]" />
          </Link>
        </header>

        {scheduled.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {scheduled.map((task) => (
              <ScheduleRow
                key={task.id}
                task={task}
                onCancel={cancelRecurrence}
              />
            ))}
          </div>
        ) : (
          <div
            className={cn(
              "rounded-2xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] py-12 text-center text-sm text-[var(--c-dim)]"
            )}
          >
            No recurring tasks yet. Set a repeat interval on any task from the{" "}
            <Link href="/board" className="font-medium text-[#a35d4d] hover:underline">
              board
            </Link>
            .
          </div>
        )}
      </div>
    </div>
  );
}
