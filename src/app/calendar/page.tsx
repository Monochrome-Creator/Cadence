"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, isValid, parseISO } from "date-fns";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  RefreshCw,
  Repeat,
  Sun,
} from "lucide-react";

import {
  useProdStore,
  resolveDailyPlan,
  todayKey,
  type Recurrence,
  type Task,
  type TaskPriority,
} from "@/store/use-prod-store";
import { cn } from "@/lib/utils";

/** Soft priority pills, matching the dashboard's terracotta/beige palette. */
const PRIORITY_PILL: Record<TaskPriority, string> = {
  Critical: "bg-[#f6dada] text-[#9b3b3b]",
  High: "bg-[#f6e6da] text-[#a35d4d]",
  Medium: "bg-[#eef0e7] text-[#5f6b4a]",
  Low: "bg-[var(--c-beige-2)] text-[var(--c-dim)]",
};

const RECURRENCE_LABELS: Record<Recurrence, string> = {
  none: "No repeat",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

/** Render the stored deadline as "29 May" (or "" when unset/invalid). */
function formatDeadline(deadline: string): string {
  const match = deadline.match(/\d{4}-\d{2}-\d{2}/);
  if (!match || !isValid(parseISO(match[0]))) return "";
  return format(parseISO(match[0]), "dd MMM");
}

/** Reason label so the plan reads like an assistant's suggestion, not a verdict. */
function planReason(task: Task, today: string): string {
  const iso = task.deadline?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso && iso < today) return "Overdue";
  if (iso && iso === today) return "Due today";
  if (task.recurrence !== "none") return RECURRENCE_LABELS[task.recurrence];
  return "From your backlog";
}

function PlanCard({
  task,
  today,
  onComplete,
  variant,
  onPromote,
}: {
  task: Task;
  today: string;
  onComplete: (id: string) => void;
  variant: "main" | "optional";
  onPromote?: (id: string) => void;
}) {
  const done = task.status === "Done";
  const deadline = formatDeadline(task.deadline);
  const reason = planReason(task, today);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border p-4 transition-all",
        variant === "main"
          ? "border-[var(--c-line)] bg-[var(--c-panel)] shadow-[0_1px_4px_rgba(74,64,54,0.05)]"
          : "border-[var(--c-line)] bg-[var(--c-panel-soft)]",
        done && "opacity-55"
      )}
    >
      <button
        type="button"
        onClick={() => onComplete(task.id)}
        disabled={done}
        title={done ? "Completed" : "Mark complete"}
        aria-label={done ? "Completed" : "Mark complete"}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors",
          done
            ? "border-[#6f9e6a] bg-[#6f9e6a] text-white"
            : "border-[var(--c-line-strong)] text-transparent hover:border-[#6f9e6a] hover:text-[#6f9e6a]/40"
        )}
      >
        <Check className="size-4" strokeWidth={3} />
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-[15px] font-medium",
            done ? "text-[var(--c-dim)] line-through" : "text-[var(--c-ink-2)]"
          )}
        >
          {task.title || "Untitled task"}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-[var(--c-dim)]">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium",
              reason === "Overdue"
                ? "bg-[#f6dada] text-[#9b3b3b]"
                : reason === "Due today"
                  ? "bg-[#f6e6da] text-[#a35d4d]"
                  : "bg-[var(--c-beige-2)] text-[var(--c-dim)]"
            )}
          >
            {reason}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium",
              PRIORITY_PILL[task.priority]
            )}
          >
            {task.priority}
          </span>
          {task.recurrence !== "none" && (
            <span className="inline-flex items-center gap-1 text-[var(--c-faint)]">
              <Repeat className="size-3" />
            </span>
          )}
          {deadline && reason !== "Due today" && reason !== "Overdue" && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3 text-[var(--c-faint)]" />
              {deadline}
            </span>
          )}
        </div>
      </div>

      {variant === "optional" && onPromote && !done && (
        <button
          type="button"
          onClick={() => onPromote(task.id)}
          title="Add to today's focus"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-3 py-1.5 text-[12px] font-medium text-[#a35d4d] transition-colors hover:border-[#e7c4c4] hover:bg-[#fcf4ef]"
        >
          <Plus className="size-3.5" />
          Focus
        </button>
      )}
    </div>
  );
}

export default function CalendarPage() {
  const tasks = useProdStore((state) => state.tasks);
  const dailyPlan = useProdStore((state) => state.dailyPlan);
  const ensureDailyPlan = useProdStore((state) => state.ensureDailyPlan);
  const regenerateDailyPlan = useProdStore((state) => state.regenerateDailyPlan);
  const planCompleteTask = useProdStore((state) => state.planCompleteTask);
  const planMoveToToday = useProdStore((state) => state.planMoveToToday);

  const [showOptional, setShowOptional] = useState(false);
  const today = todayKey();

  // Make sure a plan exists for today (handles first visit / day rollover).
  useEffect(() => {
    ensureDailyPlan();
  }, [ensureDailyPlan]);

  const { main, optional } = useMemo(
    () => resolveDailyPlan(dailyPlan, tasks, today),
    [dailyPlan, tasks, today]
  );

  const mainDone = main.filter((t) => t.status === "Done").length;
  const allMainDone = main.length > 0 && mainDone === main.length;
  const prettyDate = format(new Date(), "EEEE, d MMMM");

  return (
    <div className="px-5 py-7 md:px-8 md:py-10">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 md:gap-7">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--c-dim)]">
              <CalendarDays className="size-4 text-[#a35d4d]" />
              <span>{prettyDate}</span>
            </div>
            <h1 className="font-heading mt-2.5 text-3xl leading-tight font-semibold tracking-tight text-[var(--c-ink-2)] md:text-[38px]">
              Daily Plan
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--c-ink-3)]">
              A calm, realistic focus for today — just one or two things that
              matter most. Everything else waits quietly in your backlog.
            </p>
          </div>
          <button
            type="button"
            onClick={regenerateDailyPlan}
            title="Rebuild today's plan from your current tasks"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--c-line)] bg-[var(--c-panel-soft)] px-3 py-2 text-[12.5px] font-medium text-[var(--c-ink-3)] transition-colors hover:border-[#e7c4c4] hover:bg-[#fcf4ef] hover:text-[#a35d4d]"
          >
            <RefreshCw className="size-3.5" />
            Replan
          </button>
        </header>

        {/* Today's focus */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-[var(--c-dim)] uppercase">
              <Sun className="size-4 text-[#a35d4d]" />
              Today&rsquo;s focus
            </h2>
            {main.length > 0 && (
              <span className="text-[12.5px] font-medium text-[var(--c-dim)] tabular-nums">
                {mainDone}/{main.length} done
              </span>
            )}
          </div>

          {main.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {main.map((task) => (
                <PlanCard
                  key={task.id}
                  task={task}
                  today={today}
                  onComplete={planCompleteTask}
                  variant="main"
                />
              ))}
              {allMainDone && (
                <p className="px-1 pt-1 text-[13.5px] text-[#5f6b4a]">
                  That&rsquo;s your focus done for today. Anything more is a bonus.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] py-10 text-center text-sm text-[var(--c-dim)]">
              Nothing needs your focus today. Add tasks on the{" "}
              <Link href="/board" className="font-medium text-[#a35d4d] hover:underline">
                board
              </Link>{" "}
              and they&rsquo;ll be planned for you.
            </div>
          )}
        </section>

        {/* Optional / backlog */}
        {optional.length > 0 && (
          <section className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setShowOptional((v) => !v)}
              className="flex items-center justify-between rounded-2xl px-1 py-1 text-left"
            >
              <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-[var(--c-dim)] uppercase">
                Optional &middot; Backlog
                <span className="rounded-full bg-[var(--c-beige-2)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--c-dim)]">
                  {optional.length}
                </span>
              </h2>
              {showOptional ? (
                <ChevronUp className="size-4 text-[var(--c-dim)]" />
              ) : (
                <ChevronDown className="size-4 text-[var(--c-dim)]" />
              )}
            </button>

            {showOptional ? (
              <div className="flex flex-col gap-2.5">
                {optional.map((task) => (
                  <PlanCard
                    key={task.id}
                    task={task}
                    today={today}
                    onComplete={planCompleteTask}
                    onPromote={planMoveToToday}
                    variant="optional"
                  />
                ))}
              </div>
            ) : (
              <p className="px-1 text-[13.5px] text-[var(--c-dim)]">
                {optional.length} more task{optional.length === 1 ? "" : "s"} waiting
                — not required today.{" "}
                <button
                  type="button"
                  onClick={() => setShowOptional(true)}
                  className="font-medium text-[#a35d4d] hover:underline"
                >
                  Show them
                </button>
              </p>
            )}
          </section>
        )}

        <Link
          href="/board"
          className="inline-flex items-center gap-1.5 self-start text-[13.5px] font-medium text-[#a35d4d] hover:underline"
        >
          Manage all tasks on the board <ArrowRight className="size-[15px]" />
        </Link>
      </div>
    </div>
  );
}
