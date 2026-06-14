"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ListTodo,
  Plus,
  RefreshCw,
  Repeat,
  Sparkles,
  Sun,
  X,
} from "lucide-react";

import {
  useProdStore,
  resolveDailyPlan,
  suggestFocusCandidates,
  countActiveTodayTasks,
  todayKey,
  MAX_TODAY_TASKS,
  type Recurrence,
  type Task,
  type TaskPriority,
} from "@/store/use-prod-store";
import { holidayName } from "@/lib/sg-holidays";
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

/** Pull the YYYY-MM-DD portion out of a stored deadline (or "" if unset). */
function taskDeadlineIso(deadline: string): string {
  const match = deadline.match(/\d{4}-\d{2}-\d{2}/);
  if (!match || !isValid(parseISO(match[0]))) return "";
  return match[0];
}

/** Render the stored deadline as "29 May" (or "" when unset/invalid). */
function formatDeadline(deadline: string): string {
  const iso = taskDeadlineIso(deadline);
  return iso ? format(parseISO(iso), "dd MMM") : "";
}

/** Reason label so the plan reads like an assistant's suggestion, not a verdict. */
function planReason(task: Task, today: string): string {
  const iso = taskDeadlineIso(task.deadline);
  if (iso && iso < today) return "Overdue";
  if (iso && iso === today) return "Due today";
  if (task.recurrence !== "none") return RECURRENCE_LABELS[task.recurrence];
  return "From your backlog";
}

function PlanCard({
  task,
  today,
  onComplete,
  onRemove,
}: {
  task: Task;
  today: string;
  onComplete: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const done = task.status === "Done";
  const deadline = formatDeadline(task.deadline);
  const reason = planReason(task, today);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[0_1px_4px_rgba(74,64,54,0.05)] transition-all",
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

      {!done && (
        <button
          type="button"
          onClick={() => onRemove(task.id)}
          title="Remove from today's focus"
          aria-label="Remove from today's focus"
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--c-faint)] transition-colors hover:bg-[var(--c-beige)] hover:text-[#9b3b3b]"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

/**
 * Opt-in nudge: surfaces one ranked suggestion (overdue > due today >
 * priority) the user hasn't pulled into focus yet. "Add to focus" sends it to
 * today; "Refresh" cycles to the next candidate. Nothing is added automatically.
 */
function SuggestionCard({
  tasks,
  today,
}: {
  tasks: Task[];
  today: string;
}) {
  const sendTaskToToday = useProdStore((s) => s.sendTaskToToday);
  const [cursor, setCursor] = useState(0);
  const [full, setFull] = useState(false);

  const candidates = useMemo(
    () => suggestFocusCandidates(tasks, today),
    [tasks, today]
  );
  const focusFull = countActiveTodayTasks(tasks) >= MAX_TODAY_TASKS;

  if (candidates.length === 0) return null;

  const task = candidates[cursor % candidates.length];
  const reason = planReason(task, today);
  const deadline = formatDeadline(task.deadline);

  const handleAdd = () => {
    const ok = sendTaskToToday(task.id);
    if (!ok) {
      setFull(true);
      return;
    }
    setFull(false);
    setCursor(0);
  };

  return (
    <section className="rounded-2xl border border-[#ecd9c8] bg-gradient-to-br from-[#fbf1e7] to-[var(--c-panel)] p-4 shadow-[0_1px_4px_rgba(74,64,54,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-[#a35d4d] uppercase">
          <Sparkles className="size-4" />
          Suggested next
        </h2>
        {candidates.length > 1 && (
          <button
            type="button"
            onClick={() => setCursor((c) => c + 1)}
            title="Show another suggestion"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-3 py-1.5 text-[12px] font-medium text-[var(--c-dim)] transition-colors hover:border-[#e4c4a8] hover:text-[#a35d4d]"
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-[var(--c-ink-2)]">
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
            {deadline && reason !== "Due today" && reason !== "Overdue" && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3 text-[var(--c-faint)]" />
                {deadline}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={handleAdd}
          disabled={focusFull}
          title={
            focusFull
              ? `Today's focus is full (max ${MAX_TODAY_TASKS})`
              : "Add to today's focus"
          }
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-medium transition-colors",
            focusFull
              ? "cursor-not-allowed bg-[var(--c-beige-2)] text-[var(--c-faint)]"
              : "bg-[#a35d4d] text-white hover:bg-[#925040]"
          )}
        >
          <Plus className="size-4" />
          Add to focus
        </button>
      </div>

      {(focusFull || full) && (
        <p className="mt-2.5 text-[12.5px] text-[#9b3b3b]">
          Today&rsquo;s focus is full ({MAX_TODAY_TASKS} max). Clear one before
          adding more.
        </p>
      )}
    </section>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Month calendar for planning. Monday-start, marks Singapore public holidays,
 * shows a dot per task deadline, and lets the user click a day to schedule a
 * task onto it (sets that task's deadline to the chosen day).
 */
function PlanningCalendar({ tasks, today }: { tasks: Task[]; today: string }) {
  const updateTask = useProdStore((s) => s.updateTask);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<string | null>(null);

  // Group task deadlines by ISO day for quick per-cell lookup.
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const iso = taskDeadlineIso(t.deadline);
      if (!iso) continue;
      const list = map.get(iso);
      if (list) list.push(t);
      else map.set(iso, [t]);
    }
    return map;
  }, [tasks]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [viewMonth]);

  const selectedTasks = selected ? (byDay.get(selected) ?? []) : [];
  // Tasks not yet on the selected day that the user could schedule onto it.
  const schedulable = useMemo(() => {
    if (!selected) return [];
    return tasks
      .filter(
        (t) =>
          t.status !== "Done" &&
          t.status !== "Inbox" &&
          taskDeadlineIso(t.deadline) !== selected
      )
      .sort((a, b) => a.order - b.order);
  }, [tasks, selected]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-[var(--c-dim)] uppercase">
          <CalendarDays className="size-4 text-[#a35d4d]" />
          Plan your month
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setViewMonth((m) => subMonths(m, 1))}
            title="Previous month"
            aria-label="Previous month"
            className="flex size-8 items-center justify-center rounded-full text-[var(--c-dim)] transition-colors hover:bg-[var(--c-beige)] hover:text-[#a35d4d]"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-[120px] text-center text-[13.5px] font-semibold text-[var(--c-ink-2)]">
            {format(viewMonth, "MMMM yyyy")}
          </span>
          <button
            type="button"
            onClick={() => setViewMonth((m) => addMonths(m, 1))}
            title="Next month"
            aria-label="Next month"
            className="flex size-8 items-center justify-center rounded-full text-[var(--c-dim)] transition-colors hover:bg-[var(--c-beige)] hover:text-[#a35d4d]"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] p-2.5 shadow-[0_1px_4px_rgba(74,64,54,0.05)] md:p-3.5">
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="pb-1.5 text-center text-[11px] font-semibold tracking-wide text-[var(--c-faint)] uppercase"
            >
              {d}
            </div>
          ))}
          {days.map((day) => {
            const iso = format(day, "yyyy-MM-dd");
            const inMonth = isSameMonth(day, viewMonth);
            const isToday = iso === today;
            const isSelected = iso === selected;
            const holiday = holidayName(iso);
            const dayTasks = byDay.get(iso) ?? [];

            return (
              <button
                key={iso}
                type="button"
                onClick={() => setSelected((cur) => (cur === iso ? null : iso))}
                title={holiday ?? format(day, "EEEE, d MMMM")}
                className={cn(
                  "flex min-h-[58px] flex-col items-stretch gap-1 rounded-xl border p-1.5 text-left transition-colors md:min-h-[68px]",
                  isSelected
                    ? "border-[#a35d4d] bg-[#fbf1e7]"
                    : holiday
                      ? "border-transparent bg-[#f6e6da]/60 hover:border-[var(--c-line-strong)]"
                      : "border-transparent hover:border-[var(--c-line-strong)] hover:bg-[var(--c-beige)]/50",
                  !inMonth && "opacity-40"
                )}
              >
                <span className="flex items-center justify-between">
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-[12.5px] font-medium tabular-nums",
                      isToday
                        ? "bg-[#a35d4d] text-white"
                        : holiday
                          ? "text-[#a35d4d]"
                          : "text-[var(--c-ink-3)]"
                    )}
                  >
                    {format(day, "d")}
                  </span>
                  {dayTasks.length > 0 && (
                    <span className="rounded-full bg-[var(--c-beige-2)] px-1.5 text-[10px] font-semibold tabular-nums text-[var(--c-dim)]">
                      {dayTasks.length}
                    </span>
                  )}
                </span>
                {holiday && (
                  <span className="truncate text-[10px] leading-tight font-medium text-[#a35d4d]">
                    {holiday}
                  </span>
                )}
                {dayTasks.length > 0 && (
                  <span className="mt-auto flex flex-wrap gap-0.5">
                    {dayTasks.slice(0, 4).map((t) => (
                      <span
                        key={t.id}
                        className={cn(
                          "size-1.5 rounded-full",
                          t.status === "Done"
                            ? "bg-[#6f9e6a]"
                            : "bg-[#cf9a7e]"
                        )}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected-day planning panel */}
      {selected && (
        <div className="rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel-soft)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14.5px] font-semibold text-[var(--c-ink-2)]">
                {format(parseISO(selected), "EEEE, d MMMM")}
              </p>
              {holidayName(selected) && (
                <p className="mt-0.5 text-[12.5px] font-medium text-[#a35d4d]">
                  {holidayName(selected)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              title="Close"
              aria-label="Close day"
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--c-faint)] transition-colors hover:bg-[var(--c-beige)] hover:text-[var(--c-ink-3)]"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Tasks already scheduled on this day */}
          {selectedTasks.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5">
              {selectedTasks.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] px-3 py-2"
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      t.status === "Done" ? "bg-[#6f9e6a]" : "bg-[#cf9a7e]"
                    )}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[13.5px]",
                      t.status === "Done"
                        ? "text-[var(--c-dim)] line-through"
                        : "text-[var(--c-ink-3)]"
                    )}
                  >
                    {t.title || "Untitled task"}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateTask(t.id, { deadline: "" })}
                    title="Remove from this day"
                    aria-label="Remove deadline"
                    className="flex size-6 shrink-0 items-center justify-center rounded-full text-[var(--c-faint)] transition-colors hover:bg-[var(--c-beige)] hover:text-[#9b3b3b]"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Schedule another task onto this day */}
          <div className="mt-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-[var(--c-dim)]">
              <CalendarPlus className="size-3.5" />
              Schedule a task here
            </p>
            {schedulable.length > 0 ? (
              <div className="flex max-h-44 flex-col gap-1 overflow-y-auto pr-1">
                {schedulable.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => updateTask(t.id, { deadline: selected })}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--c-beige)]"
                  >
                    <Plus className="size-3.5 shrink-0 text-[#a35d4d]" />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--c-ink-3)]">
                      {t.title || "Untitled task"}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                        PRIORITY_PILL[t.priority]
                      )}
                    >
                      {t.priority}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-[var(--c-faint)]">
                No other tasks to schedule.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default function CalendarPage() {
  const tasks = useProdStore((state) => state.tasks);
  const dailyPlan = useProdStore((state) => state.dailyPlan);
  const ensureDailyPlan = useProdStore((state) => state.ensureDailyPlan);
  const planCompleteTask = useProdStore((state) => state.planCompleteTask);
  const planRemoveFromToday = useProdStore((state) => state.planRemoveFromToday);
  const clearManualFocus = useProdStore((state) => state.clearManualFocus);

  const today = todayKey();

  // Make sure a plan exists for today (handles first visit / day rollover).
  useEffect(() => {
    ensureDailyPlan();
  }, [ensureDailyPlan]);

  const { main, manual } = useMemo(
    () => resolveDailyPlan(dailyPlan, tasks),
    [dailyPlan, tasks]
  );

  const mainDone = main.filter((t) => t.status === "Done").length;
  const allMainDone = main.length > 0 && mainDone === main.length;
  const manualDone = manual.filter((t) => t.status === "Done").length;
  const manualOpen = manual.length - manualDone;
  const prettyDate = format(new Date(), "EEEE, d MMMM");

  return (
    <div className="px-5 py-7 md:px-8 md:py-10">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 md:gap-7">
        <header className="flex flex-col gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--c-dim)]">
              <CalendarDays className="size-4 text-[#a35d4d]" />
              <span>{prettyDate}</span>
            </div>
            <h1 className="font-heading mt-2.5 text-3xl leading-tight font-semibold tracking-tight text-[var(--c-ink-2)] md:text-[38px]">
              Daily Plan
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--c-ink-3)]">
              Your focus for today is whatever you mark on the{" "}
              <Link href="/board" className="font-medium text-[#a35d4d] hover:underline">
                Workspace
              </Link>{" "}
              with{" "}
              <span className="font-medium text-[#a35d4d]">Send to Today</span>.
              Nothing shows here until you choose it — so the list stays exactly as
              long as you want it.
            </p>
          </div>
        </header>

        {/* Opt-in suggestion — never auto-added */}
        <SuggestionCard tasks={tasks} today={today} />

        {/* Today's focus — driven by the Workspace "Send to Today" mark */}
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
                  onRemove={planRemoveFromToday}
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
              No focus tasks yet. Open the{" "}
              <Link href="/board" className="font-medium text-[#a35d4d] hover:underline">
                Workspace
              </Link>{" "}
              and hit <span className="font-medium text-[#a35d4d]">Send to Today</span>{" "}
              on the tasks you want to focus on.
            </div>
          )}
        </section>

        {/* Manual focus — tasks pulled forward from a missed day */}
        {manual.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-[var(--c-dim)] uppercase">
                <ListTodo className="size-4 text-[#a35d4d]" />
                Manual focus
                <span className="rounded-full bg-[var(--c-beige-2)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--c-dim)]">
                  {manualDone}/{manual.length}
                </span>
              </h2>
              {manualOpen > 0 && (
                <button
                  type="button"
                  onClick={clearManualFocus}
                  title="Mark every manual-focus task done for the day"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--c-line)] bg-[var(--c-panel-soft)] px-3 py-1.5 text-[12px] font-medium text-[#5f6b4a] transition-colors hover:border-[#cdd6bd] hover:bg-[#eef0e7]"
                >
                  <CheckCheck className="size-3.5" />
                  Clear for the day
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2.5">
              {manual.map((task) => (
                <PlanCard
                  key={task.id}
                  task={task}
                  today={today}
                  onComplete={planCompleteTask}
                  onRemove={planRemoveFromToday}
                />
              ))}
              {manualOpen === 0 && (
                <p className="px-1 pt-1 text-[13.5px] text-[#5f6b4a]">
                  Manual focus cleared. Nice work.
                </p>
              )}
            </div>
          </section>
        )}

        {/* Month calendar for planning ahead */}
        <PlanningCalendar tasks={tasks} today={today} />

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
