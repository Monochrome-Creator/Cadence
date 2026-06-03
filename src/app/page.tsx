"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { format, isValid, parseISO } from "date-fns";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Flame,
  Layers,
  Moon,
  Play,
  Plus,
  Repeat,
  Sun,
  Target,
  Timer,
} from "lucide-react";

import {
  computeHistoryStats,
  useProdStore,
  type HistoryStats,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@/store/use-prod-store";
import { getSupabaseClient, isSupabaseConfigured } from "@/utils/supabase/client";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*                         Design tokens (board parity)                       */
/* -------------------------------------------------------------------------- */

const STATUS_PILL: Record<TaskStatus, string> = {
  "Working on it": "bg-[#f3e7d0] text-[#8a6d3b]",
  Stuck: "bg-[#f6e0e0] text-[#9b3b3b]",
  Done: "bg-[#e3ece0] text-[#4d7049]",
  "Not Started": "bg-[#efe9e0] text-[#8a7d6b]",
};

const PRIORITY_PILL: Record<TaskPriority, string> = {
  Low: "bg-[#e7edf0] text-[#5b7488]",
  Medium: "bg-[#f3ecd9] text-[#8a763b]",
  High: "bg-[#f6e6da] text-[#a35d4d]",
  Critical: "bg-[#f4dede] text-[#9b3b3b]",
};

type CategoryTheme = { pill: string; spine: string; tint: string };

/** Rotating palette of muted, premium color sets — mirrors the board. */
const CATEGORY_THEMES: CategoryTheme[] = [
  { pill: "bg-[#e3ece0] text-[#4d7049]", spine: "border-l-[#8aa877]", tint: "bg-[#f5f8f2]" },
  { pill: "bg-[#e7edf0] text-[#5b7488]", spine: "border-l-[#88a3b6]", tint: "bg-[#f3f7f9]" },
  { pill: "bg-[#f3ecd9] text-[#8a763b]", spine: "border-l-[#c6ac63]", tint: "bg-[#faf6ea]" },
  { pill: "bg-[#efe3ea] text-[#8a5d72]", spine: "border-l-[#b98ca6]", tint: "bg-[#faf3f7]" },
  { pill: "bg-[#f5e3da] text-[#a35d4d]", spine: "border-l-[#cf8e77]", tint: "bg-[#fcf4ef]" },
  { pill: "bg-[#e0ebe8] text-[#4f7d72]", spine: "border-l-[#7aa99b]", tint: "bg-[#f3f8f6]" },
];

const NEUTRAL_THEME: CategoryTheme = {
  pill: "bg-[#efe9e0] text-[#8a7d6b]",
  spine: "border-l-[var(--c-line-strong)]",
  tint: "bg-[var(--c-panel-soft)]",
};

const CANONICAL_THEMES: Record<string, CategoryTheme> = {
  Work: CATEGORY_THEMES[0],
  Personal: CATEGORY_THEMES[1],
  Health: CATEGORY_THEMES[2],
  Learning: CATEGORY_THEMES[3],
};

/** Same stable hashing rule the board uses so a label keeps its color. */
function categoryTheme(category: string): CategoryTheme {
  const key = category.trim();
  if (!key || key === "General") return NEUTRAL_THEME;
  if (CANONICAL_THEMES[key]) return CANONICAL_THEMES[key];
  let sum = 0;
  for (let i = 0; i < key.length; i++) sum += key.charCodeAt(i);
  return CATEGORY_THEMES[sum % CATEGORY_THEMES.length];
}

/* -------------------------------------------------------------------------- */
/*                            Time-of-day greeting                            */
/* -------------------------------------------------------------------------- */

type Greeting = { hello: string; intention: string; icon: typeof Sun };

function greetingFor(hour: number): Greeting {
  if (hour < 12) {
    return {
      hello: "Good morning",
      intention:
        "A calm start sets the whole day’s cadence. Pick one thing and begin.",
      icon: Sun,
    };
  }
  if (hour < 18) {
    return {
      hello: "Good afternoon",
      intention:
        "Steady wins the afternoon. Protect one focused block before the day slips.",
      icon: Sun,
    };
  }
  return {
    hello: "Good evening",
    intention:
      "Wind down gently. Close what you can, and let the rest wait for tomorrow.",
    icon: Moon,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

function formatDeadline(deadline: string): string {
  const match = deadline.match(/\d{4}-\d{2}-\d{2}/);
  if (!match || !isValid(parseISO(match[0]))) return "";
  return format(parseISO(match[0]), "dd MMM yyyy");
}

function fmtFocus(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/**
 * Friendly first name for the greeting. Uses the signed-in email's local part
 * when cloud auth is on; otherwise stays a warm, neutral default.
 */
function useGreetingName(): string {
  const [name, setName] = useState("there");

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        const email = data.user?.email;
        if (!email) return;
        const local = email.split("@")[0].replace(/[._-]+/g, " ").trim();
        if (local) setName(local.charAt(0).toUpperCase() + local.slice(1));
      })
      .catch(() => {
        // Stale/absent session — keep the neutral default.
      });
  }, []);

  return name;
}

/* -------------------------------------------------------------------------- */
/*                              Visual primitives                             */
/* -------------------------------------------------------------------------- */

function ProgressRing({
  size = 128,
  stroke = 13,
  progress,
  children,
}: {
  size?: number;
  stroke?: number;
  progress: number;
  children: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, progress)));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="block -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className="stroke-[var(--c-beige)]"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#a35d4d"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          className="[transition:stroke-dashoffset_0.8s_cubic-bezier(0.2,0.7,0.3,1)]"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  );
}

/** Seven day-dots; `state` is "done" | "today" | "off" per weekday (Mon→Sun). */
function StreakStrip({
  days,
  size = 26,
}: {
  days: ("done" | "today" | "off")[];
  size?: number;
}) {
  const labels = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <div className="flex gap-1.5">
      {labels.map((label, i) => {
        const state = days[i] ?? "off";
        const done = state === "done";
        const today = state === "today";
        return (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div
              className={cn(
                "flex items-center justify-center rounded-full border-[1.5px]",
                done
                  ? "border-transparent bg-[#a35d4d] text-white"
                  : today
                    ? "border-[#a35d4d] bg-[#f6e6da] text-[#a35d4d]"
                    : "border-transparent bg-[var(--c-beige)] text-[var(--c-faint)]"
              )}
              style={{ width: size, height: size }}
            >
              {done ? (
                <Check className="size-3.5" strokeWidth={2.6} />
              ) : (
                <span
                  className={cn(
                    "size-[5px] rounded-full",
                    today ? "bg-[#a35d4d]" : "bg-[var(--c-faint)]"
                  )}
                />
              )}
            </div>
            <span
              className={cn(
                "text-[10px] font-semibold",
                today ? "text-[#a35d4d]" : "text-[var(--c-dim)]"
              )}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MiniBars({ data, height = 34 }: { data: number[]; height?: number }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((v, i) => (
        <div
          key={i}
          className={cn(
            "w-1.5 rounded-[3px]",
            i === data.length - 1 ? "bg-[#a35d4d]" : "bg-[#a35d4d]/30"
          )}
          style={{ height: `${Math.max(12, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function StatTile({
  icon: Icon,
  value,
  unit,
  label,
  accent,
}: {
  icon: typeof Timer;
  value: string | number;
  unit?: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[var(--c-dim)]">
        <Icon className={cn("size-4", accent && "text-[#a35d4d]")} />
        <span className="text-[11px] font-semibold tracking-[0.04em] uppercase">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-mono text-2xl font-semibold text-[var(--c-ink-2)] tabular-nums">
          {value}
        </span>
        {unit && <span className="text-sm font-medium text-[var(--c-dim)]">{unit}</span>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                Focus task row                              */
/* -------------------------------------------------------------------------- */

function FocusRow({
  task,
  isActive,
  onToggle,
}: {
  task: Task;
  isActive: boolean;
  onToggle: () => void;
}) {
  const theme = categoryTheme(task.category);
  const done = task.status === "Done";
  const deadline = formatDeadline(task.deadline);
  const subDone = task.subtasks.filter((s) => s.status === "done").length;
  const category = task.category.trim() || "General";

  return (
    <div
      className={cn(
        "rounded-2xl border border-l-4 border-[var(--c-line)] shadow-[0_1px_4px_rgba(74,64,54,0.04)] transition-all hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(74,64,54,0.07)]",
        theme.spine,
        isActive ? "border-[#a35d4d]/40 bg-[#fcf4ef] ring-1 ring-[#a35d4d]/25" : theme.tint,
        // Dark mode flattens the pale category tints to a single warm panel.
        "dark:bg-[var(--c-panel)]"
      )}
    >
      <div className="flex items-center gap-3 p-4 md:gap-4 md:px-[18px]">
        {/* Focus target toggle */}
        <button
          type="button"
          onClick={onToggle}
          title={isActive ? "Active focus task" : "Set as focus task"}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors md:size-[34px]",
            isActive
              ? "bg-[#a35d4d] text-white"
              : "bg-[var(--c-beige)] text-[var(--c-dim)] hover:bg-[var(--c-beige-2)] hover:text-[#a35d4d]"
          )}
        >
          <Target className="size-4" />
        </button>

        {/* Title + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {done && (
              <span className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-[#6f9e6a] text-white">
                <Check className="size-3" strokeWidth={3} />
              </span>
            )}
            <span
              className={cn(
                "truncate text-[15px] font-medium",
                done ? "text-[var(--c-dim)] line-through" : "text-[var(--c-ink-2)]"
              )}
            >
              {task.title || "Untitled task"}
            </span>
            {task.recurrence !== "none" && (
              <Repeat className="size-3.5 shrink-0 text-[var(--c-faint)]" />
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-[var(--c-dim)]">
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                theme.pill
              )}
            >
              {category}
            </span>
            {deadline && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-3.5 text-[var(--c-faint)]" />
                {deadline}
              </span>
            )}
            {task.subtasks.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Layers className="size-3 text-[var(--c-faint)]" />
                {subDone}/{task.subtasks.length} micro-tasks
              </span>
            )}
          </div>
        </div>

        {/* Status + priority pills — hidden on the tightest phones */}
        <span
          className={cn(
            "hidden shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium sm:inline-flex",
            STATUS_PILL[task.status]
          )}
        >
          {task.status}
        </span>
        <span
          className={cn(
            "hidden shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium md:inline-flex",
            PRIORITY_PILL[task.priority]
          )}
        >
          {task.priority}
        </span>

        {/* Pomodoros */}
        <div className="flex shrink-0 items-center gap-1.5 text-[13.5px] text-[var(--c-ink-3)]">
          <Timer className="size-4 text-[#a35d4d]" />
          <span className="font-mono font-semibold tabular-nums">
            {task.pomodorosLogged}
          </span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Stat-band cards                               */
/* -------------------------------------------------------------------------- */

function GoalRingCard({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const remaining = Math.max(0, total - done);
  return (
    <div className="flex items-center gap-5 rounded-3xl border border-[var(--c-line)] bg-[var(--c-panel)] p-[22px] shadow-[0_1px_3px_rgba(74,64,54,0.05)]">
      <ProgressRing progress={total > 0 ? done / total : 0}>
        <span className="font-mono text-3xl font-semibold text-[var(--c-ink-2)] tabular-nums">
          {pct}%
        </span>
        <span className="text-[10.5px] font-semibold tracking-[0.05em] text-[var(--c-dim)] uppercase">
          done
        </span>
      </ProgressRing>
      <div className="min-w-0">
        <p className="font-heading text-lg font-semibold text-[var(--c-ink-2)]">Daily goal</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--c-ink-3)]">
          <b className="text-[var(--c-ink-2)]">
            {done} of {total}
          </b>{" "}
          focus tasks complete.
        </p>
        <p className="mt-2 text-[13px] text-[var(--c-dim)]">
          {remaining > 0
            ? `${remaining} to go — you’re almost there.`
            : "All done — beautifully paced."}
        </p>
      </div>
    </div>
  );
}

function StreakCard({
  streak,
  bestStreak,
  days,
}: {
  streak: number;
  bestStreak: number;
  days: ("done" | "today" | "off")[];
}) {
  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-[var(--c-line)] bg-[var(--c-panel)] p-[22px] shadow-[0_1px_3px_rgba(74,64,54,0.05)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11.5px] font-semibold tracking-[0.04em] text-[var(--c-dim)] uppercase">
            Current streak
          </p>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-[34px] leading-none font-semibold text-[var(--c-ink-2)] tabular-nums">
              {streak}
            </span>
            <span className="text-sm font-medium text-[var(--c-ink-3)]">days</span>
          </div>
        </div>
        {streak > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f6e6da] px-3 py-[7px] text-[12.5px] font-medium text-[#a35d4d]">
            <Flame className="size-[15px]" /> on a roll
          </span>
        )}
      </div>
      <StreakStrip days={days} />
      <p className="text-[12.5px] text-[var(--c-dim)]">
        Best streak <b className="text-[var(--c-ink-3)]">{bestStreak} days</b> — keep the
        cadence going.
      </p>
    </div>
  );
}

function FocusStatsCard({
  pomodoros,
  focusMinutes,
  sessions,
  week,
}: {
  pomodoros: number;
  focusMinutes: number;
  sessions: number;
  week: number[];
}) {
  const focused = fmtFocus(focusMinutes);
  const [focusValue, focusUnit] = focused.includes(" ")
    ? [focused.split(" ")[0], focused.split(" ").slice(1).join(" ")]
    : [focused, undefined];
  return (
    <div className="flex flex-col gap-[18px] rounded-3xl border border-[var(--c-line)] bg-[var(--c-panel)] p-[22px] shadow-[0_1px_3px_rgba(74,64,54,0.05)]">
      <div className="flex items-center justify-between">
        <p className="font-heading text-base font-semibold text-[var(--c-ink-2)]">
          Focus today
        </p>
        <MiniBars data={week} />
      </div>
      <div className="grid grid-cols-3 gap-3.5">
        <StatTile icon={Timer} value={pomodoros} label="Pomodoros" accent />
        <StatTile icon={Play} value={focusValue} unit={focusUnit} label="Focused" />
        <StatTile icon={Check} value={sessions} label="Sessions" />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 Home page                                  */
/* -------------------------------------------------------------------------- */

/**
 * Stable, date-independent stats for SSR and the first client paint (before the
 * store rehydrates), so the consistency tracker never triggers a hydration
 * mismatch. Real values are computed from `history` once mounted.
 */
const EMPTY_HISTORY_STATS: HistoryStats = {
  streak: 0,
  bestStreak: 0,
  days: ["off", "off", "off", "off", "off", "off", "off"],
  week: [0, 0, 0, 0, 0, 0, 0],
};

export default function HomePage() {
  const tasks = useProdStore((state) => state.tasks);
  const activeTaskId = useProdStore((state) => state.activeTaskId);
  const setActiveTask = useProdStore((state) => state.setActiveTask);
  const sessionsCompleted = useProdStore((state) => state.sessionsCompleted);
  const history = useProdStore((state) => state.history);

  const name = useGreetingName();

  // Compute the greeting on the client only, so SSR and first paint agree.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client clock read to avoid SSR mismatch
    setNow(new Date());
  }, []);

  // Derive consistency metrics from the real daily log — but only after mount
  // (gated on `now`) so the date-dependent strip never mismatches on hydration.
  const stats = useMemo(
    () => (now ? computeHistoryStats(history) : EMPTY_HISTORY_STATS),
    [now, history]
  );
  const greeting = greetingFor(now?.getHours() ?? 8);
  const GreetingIcon = greeting.icon;
  const dateLabel = now ? format(now, "EEEE, MMMM d") : "";

  // Today's focus: the active task first, then the rest in board order.
  const focusTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      if (a.id === activeTaskId) return -1;
      if (b.id === activeTaskId) return 1;
      return a.order - b.order;
    });
  }, [tasks, activeTaskId]);

  const goalDone = focusTasks.filter((t) => t.status === "Done").length;
  const goalTotal = focusTasks.length;

  const toggle = (id: string) =>
    setActiveTask(activeTaskId === id ? null : id);

  return (
    <div className="px-5 py-7 md:px-8 md:py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 md:gap-[22px]">
        {/* Greeting header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[13.5px] font-medium whitespace-nowrap text-[var(--c-dim)]">
              <GreetingIcon className="size-4 text-[#a35d4d]" />
              <span>{dateLabel || " "}</span>
            </div>
            <h1 className="font-heading mt-2.5 text-3xl leading-tight font-semibold tracking-tight text-[var(--c-ink-2)] md:text-[38px]">
              {greeting.hello}, {name}.
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--c-ink-3)]">
              {greeting.intention}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <ThemeToggle size={42} />
            <Link
              href="/board"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-4 py-2.5 text-[13.5px] font-medium text-[var(--c-ink-3)] transition-colors hover:bg-[var(--c-beige-2)] hover:text-[var(--c-accent)]"
            >
              <Plus className="size-4" /> New task
            </Link>
            <Link
              href="/timer"
              className="inline-flex items-center gap-2 rounded-full bg-[#a35d4d] px-[18px] py-2.5 text-[13.5px] font-medium text-white shadow-[0_1px_3px_rgba(74,64,54,0.12)] transition-colors hover:bg-[#8f4f41]"
            >
              <Play className="size-[15px]" /> Start focus
            </Link>
          </div>
        </header>

        {/* Stat band */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_1fr_1.1fr]">
          <GoalRingCard done={goalDone} total={goalTotal} />
          <StreakCard
            streak={stats.streak}
            bestStreak={stats.bestStreak}
            days={stats.days}
          />
          <FocusStatsCard
            pomodoros={sessionsCompleted}
            focusMinutes={sessionsCompleted * 25}
            sessions={sessionsCompleted}
            week={stats.week}
          />
        </section>

        {/* Today's focus */}
        <section>
          <div className="mb-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="font-heading text-xl font-semibold whitespace-nowrap text-[var(--c-ink-2)] md:text-[22px]">
                Today’s focus
              </h2>
              <span className="rounded-full bg-[var(--c-beige)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--c-dim)]">
                {focusTasks.length} {focusTasks.length === 1 ? "task" : "tasks"}
              </span>
            </div>
            <Link
              href="/board"
              className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-[#a35d4d] hover:underline"
            >
              View full board <ArrowRight className="size-[15px]" />
            </Link>
          </div>

          {focusTasks.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {focusTasks.map((task) => (
                <FocusRow
                  key={task.id}
                  task={task}
                  isActive={task.id === activeTaskId}
                  onToggle={() => toggle(task.id)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] py-12 text-center text-sm text-[var(--c-dim)]">
              Nothing on the board yet.{" "}
              <Link href="/board" className="font-medium text-[#a35d4d] hover:underline">
                Add your first task
              </Link>
              .
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
