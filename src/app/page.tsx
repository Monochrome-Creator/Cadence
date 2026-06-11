"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  differenceInCalendarDays,
  format,
  isValid,
  parseISO,
  subDays,
} from "date-fns";
import {
  ArrowRight,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronDown,
  Flame,
  Layers,
  Moon,
  Pencil,
  Play,
  Plus,
  Repeat,
  Scale,
  Sparkles,
  Sun,
  SunDim,
  Target,
  Timer,
  TriangleAlert,
} from "lucide-react";

import {
  computeHistoryStats,
  computeL3Fraction,
  DAILY_GOAL_POINTS,
  TASK_POINTS,
  useProdStore,
  type Goal,
  type HistoryStats,
  type LifePillar,
  type Recurrence,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@/store/use-prod-store";
import { getSupabaseClient, isSupabaseConfigured } from "@/utils/supabase/client";
import { PILLAR_ORDER, PILLAR_THEME } from "@/lib/life-pillars";
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
  Inbox: "bg-[#e9e6f0] text-[#6a5b88]",
};

const PRIORITY_PILL: Record<TaskPriority, string> = {
  Low: "bg-[#e7edf0] text-[#5b7488]",
  Medium: "bg-[#f3ecd9] text-[#8a763b]",
  High: "bg-[#f6e6da] text-[#a35d4d]",
  Critical: "bg-[#f4dede] text-[#9b3b3b]",
};

/** Lower rank = more important — drives the dashboard "Today's focus" order. */
const PRIORITY_RANK: Record<TaskPriority, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

/** How many of the most important tasks the dashboard surfaces at once. */
const FOCUS_LIMIT = 5;

/** Human labels for the recurrence interval, mirrored from the board. */
const RECURRENCE_LABELS: Record<Recurrence, string> = {
  none: "No repeat",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

/** Tasks due within this many days (overdue included) raise a deadline alert. */
const DEADLINE_ALERT_DAYS = 7;

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
 * Friendly name for the greeting. Prefers a user-set display name (stored in
 * Supabase auth `user_metadata.display_name`, so it follows the account across
 * devices with no schema change), then falls back to the email's local part,
 * then a warm neutral default. `saveName` persists an edited name; `canEdit`
 * is true only once a real session is confirmed.
 */
function useGreetingName(): {
  name: string;
  editableValue: string;
  canEdit: boolean;
  saveName: (next: string) => void;
} {
  const [fallback, setFallback] = useState("there");
  const [custom, setCustom] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        const user = data.user;
        if (!user) return;
        setCanEdit(true);
        const meta = user.user_metadata as { display_name?: string } | undefined;
        const customName = meta?.display_name?.trim();
        setCustom(customName ? customName : null);
        const email = user.email;
        if (email) {
          const local = email.split("@")[0].replace(/[._-]+/g, " ").trim();
          if (local) setFallback(local.charAt(0).toUpperCase() + local.slice(1));
        }
      })
      .catch(() => {
        // Stale/absent session — keep the neutral default.
      });
  }, []);

  const saveName = useCallback((next: string) => {
    const trimmed = next.trim();
    setCustom(trimmed ? trimmed : null);
    const supabase = getSupabaseClient();
    if (!supabase) return;
    // Persist to auth metadata so the name syncs across devices. Fire-and-forget;
    // local state already reflects the change for an instant UI update.
    void supabase.auth.updateUser({ data: { display_name: trimmed } });
  }, []);

  const name = custom ?? fallback;
  return { name, editableValue: custom ?? fallback, canEdit, saveName };
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
  const updateTask = useProdStore((state) => state.updateTask);
  const removeTaskFromToday = useProdStore((state) => state.removeTaskFromToday);
  const theme = categoryTheme(task.category);
  const done = task.status === "Done";
  const deadline = formatDeadline(task.deadline);
  const l3 = computeL3Fraction(task.subtasks);
  const subDone =
    l3.total > 0
      ? l3.done
      : task.subtasks.filter((s) => s.status === "done").length;
  const subTotal = l3.total > 0 ? l3.total : task.subtasks.length;
  const category = task.category.trim() || "General";

  return (
    <div
      className={cn(
        "rounded-2xl border border-l-4 border-[var(--c-line)] shadow-[0_1px_4px_rgba(74,64,54,0.04)] transition-all hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(74,64,54,0.07)]",
        theme.spine,
        isActive ? "border-[#a35d4d]/40 bg-[#fcf4ef] ring-1 ring-[#a35d4d]/25" : theme.tint,
        // Dark mode flattens the pale category tints to a single warm panel.
        "dark:bg-[var(--c-panel)]",
        // Completed tasks fade back so the active focus list stays prominent.
        done && "opacity-50"
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
            {task.lifePillar && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                  PILLAR_THEME[task.lifePillar].badge
                )}
              >
                <Sparkles className="size-3" />
                {PILLAR_THEME[task.lifePillar].label}
              </span>
            )}
            {deadline && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-3.5 text-[var(--c-faint)]" />
                {deadline}
              </span>
            )}
            {task.recurrence !== "none" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#f6e6da] px-2 py-0.5 text-[11px] font-medium text-[#a35d4d]">
                <Repeat className="size-3" />
                {RECURRENCE_LABELS[task.recurrence]}
              </span>
            )}
            {task.subtasks.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Layers className="size-3 text-[var(--c-faint)]" />
                {subDone}/{subTotal} micro-tasks
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
            "hidden shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-medium md:inline-flex",
            PRIORITY_PILL[task.priority]
          )}
        >
          {task.priority}
          <span
            className="font-mono text-[10px] font-semibold tabular-nums opacity-70"
            title={`Worth ${TASK_POINTS[task.priority]} effort points`}
          >
            +{TASK_POINTS[task.priority]}
          </span>
        </span>

        {/* This Evening toggle — moves the task between day and after-hours */}
        {!done && (
          <button
            type="button"
            onClick={() => updateTask(task.id, { isEvening: !task.isEvening })}
            title={task.isEvening ? "Move to daytime" : "Move to This Evening"}
            aria-pressed={!!task.isEvening}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
              task.isEvening
                ? "bg-[#e9e6f0] text-[#6a5b88]"
                : "text-[var(--c-faint)] hover:bg-[var(--c-beige)] hover:text-[#6a5b88]"
            )}
          >
            <Moon className="size-4" />
          </button>
        )}

        {/* Remove from Today — demotes back to the Workspace backlog (isToday=false) */}
        {!done && (
          <button
            type="button"
            onClick={() => removeTaskFromToday(task.id)}
            title="Remove from Today — back to Workspace"
            aria-label="Remove from Today"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--c-faint)] transition-colors hover:bg-[var(--c-beige)] hover:text-[#a35d4d]"
          >
            <SunDim className="size-4" />
          </button>
        )}

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
  // Clamp so over-achieving the daily goal (e.g. 4 of 3) caps the ring at 100%.
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const ringProgress = total > 0 ? Math.min(1, done / total) : 0;
  const remaining = Math.max(0, total - done);
  return (
    <div className="flex items-center gap-5 rounded-3xl border border-[var(--c-line)] bg-[var(--c-panel)] p-[22px] shadow-[0_1px_3px_rgba(74,64,54,0.05)]">
      <ProgressRing progress={ringProgress}>
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
          effort points earned today.
        </p>
        <p className="mt-2 text-[13px] text-[var(--c-dim)]">
          {remaining > 0
            ? `${remaining} pts to go — you’re almost there.`
            : "Goal hit — beautifully paced."}
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
/*                       Balance — the Four Pillars widget                     */
/* -------------------------------------------------------------------------- */

/**
 * "Balance" widget: four minimal progress bars — one per life pillar — showing
 * how the user's completed work over the last 7 days is distributed across
 * Wealth, Health, Career, and Personal IP. Each bar is normalised to the
 * busiest pillar so the longest bar marks where energy is going and the empty
 * ones flag neglected areas. Counts come from the daily history log.
 */
function LifePillarsWidget({
  totals,
}: {
  totals: Record<LifePillar, number>;
}) {
  const max = Math.max(1, ...PILLAR_ORDER.map((p) => totals[p]));
  const sum = PILLAR_ORDER.reduce((acc, p) => acc + totals[p], 0);
  // Surface the most-neglected pillar as a gentle nudge (only once there's
  // enough activity for the comparison to be meaningful).
  const neglected = sum >= 3
    ? [...PILLAR_ORDER].sort((a, b) => totals[a] - totals[b])[0]
    : null;

  return (
    <div className="flex flex-col gap-[18px] rounded-3xl border border-[var(--c-line)] bg-[var(--c-panel)] p-[22px] shadow-[0_1px_3px_rgba(74,64,54,0.05)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scale className="size-[18px] text-[#a35d4d]" />
          <p className="font-heading text-base font-semibold text-[var(--c-ink-2)]">
            Balance
          </p>
        </div>
        <span className="text-[11px] font-medium tracking-[0.03em] text-[var(--c-dim)] uppercase">
          Last 7 days
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {PILLAR_ORDER.map((pillar) => {
          const theme = PILLAR_THEME[pillar];
          const count = totals[pillar];
          const width = sum === 0 ? 0 : Math.round((count / max) * 100);
          return (
            <div key={pillar} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="flex items-center gap-1.5 font-medium text-[var(--c-ink-3)]">
                  <span className={cn("size-2 rounded-full", theme.dot)} />
                  {theme.label}
                </span>
                <span className="font-mono text-[12px] font-semibold tabular-nums text-[var(--c-dim)]">
                  {count}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--c-beige)]">
                <div
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{ width: `${width}%`, backgroundColor: theme.fill }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[12px] leading-relaxed text-[var(--c-dim)]">
        {sum === 0
          ? "Tag tasks with a life pillar to see where your week's energy is going."
          : neglected
            ? `${PILLAR_THEME[neglected].label} is getting the least attention this week.`
            : "A balanced week so far — nicely paced across the board."}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                       North Star — goals overview widget                   */
/* -------------------------------------------------------------------------- */

/**
 * Dashboard widget showing up to 3 active goals with live task-progress bars.
 * Serves as a constant reminder of the big picture while working through the
 * daily task list. Renders nothing when no goals exist yet.
 */
function NorthStarWidget({
  goals,
  tasks,
}: {
  goals: Goal[];
  tasks: Task[];
}) {
  const active = goals.filter((g) => g.status === "active").slice(0, 3);
  if (active.length === 0) return null;

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-[var(--c-line)] bg-[var(--c-panel)] p-[22px] shadow-[0_1px_3px_rgba(74,64,54,0.05)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="size-[18px] text-[#a35d4d]" />
          <p className="font-heading text-base font-semibold text-[var(--c-ink-2)]">
            North Star
          </p>
        </div>
        <Link
          href="/goals"
          className="text-[12px] font-medium text-[#a35d4d] hover:underline"
        >
          Manage goals →
        </Link>
      </div>

      <div className="flex flex-col gap-4">
        {active.map((goal) => {
          const linked = tasks.filter((t) => t.goalId === goal.id);
          const done = linked.filter((t) => t.status === "Done").length;
          const total = linked.length;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          const pillar = goal.lifePillar ? PILLAR_THEME[goal.lifePillar] : null;

          return (
            <div key={goal.id} className="flex flex-col gap-2">
              <div className="flex items-start gap-2.5">
                <span
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg"
                  style={
                    pillar
                      ? { backgroundColor: `${pillar.fill}22` }
                      : { backgroundColor: "var(--c-beige)" }
                  }
                >
                  <Target
                    className="size-3.5"
                    style={pillar ? { color: pillar.fill } : { color: "#a35d4d" }}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-[var(--c-ink-2)]">
                    {goal.title}
                  </p>
                  {goal.description && (
                    <p className="mt-0.5 truncate text-[12px] text-[var(--c-dim)]">
                      {goal.description}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  {total > 0 ? (
                    <span className="font-mono text-[12px] font-semibold tabular-nums text-[var(--c-dim)]">
                      {pct}%
                    </span>
                  ) : (
                    <span className="text-[11px] text-[var(--c-faint)]">
                      No tasks
                    </span>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--c-beige)]">
                <div
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: pillar ? pillar.fill : "#a35d4d",
                  }}
                />
              </div>

              {/* Meta pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                {pillar && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      PILLAR_THEME[goal.lifePillar!].badge
                    )}
                  >
                    <Sparkles className="size-2.5" />
                    {pillar.label}
                  </span>
                )}
                {total > 0 && (
                  <span className="text-[11.5px] text-[var(--c-dim)]">
                    {done}/{total} tasks done
                  </span>
                )}
                {goal.targetDate && (
                  <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--c-dim)]">
                    <CalendarDays className="size-3 text-[var(--c-faint)]" />
                    {format(parseISO(goal.targetDate), "dd MMM yyyy")}
                  </span>
                )}
              </div>

              {/* Separator (not on last item) */}
              {active.indexOf(goal) < active.length - 1 && (
                <div className="border-t border-dashed border-[var(--c-line)] pt-0.5" />
              )}
            </div>
          );
        })}
      </div>

      {goals.filter((g) => g.status === "active").length > 3 && (
        <Link
          href="/goals"
          className="text-center text-[12.5px] font-medium text-[#a35d4d] hover:underline"
        >
          +{goals.filter((g) => g.status === "active").length - 3} more goals →
        </Link>
      )}
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

/* -------------------------------------------------------------------------- */
/*                   Action Center — approaching deadlines                    */
/* -------------------------------------------------------------------------- */

/** Human label for how much runway a task has left (overdue included). */
function deadlineLabel(daysLeft: number): string {
  if (daysLeft < 0) {
    const n = Math.abs(daysLeft);
    return `${n} day${n === 1 ? "" : "s"} overdue`;
  }
  if (daysLeft === 0) return "Due today";
  if (daysLeft === 1) return "Due tomorrow";
  return `${daysLeft} days left`;
}

/**
 * Right-rail alert column: under-prioritised tasks closing in on (or past)
 * their deadline, each with a one-click escalate to High.
 */
function DeadlineAlerts({
  alerts,
  onEscalate,
}: {
  alerts: { task: Task; daysLeft: number }[];
  onEscalate: (id: string) => void;
}) {
  return (
    <aside className="lg:col-span-1">
      <div className="mb-3.5 flex items-center gap-2">
        <TriangleAlert className="size-[18px] text-[#a35d4d]" />
        <h2 className="font-heading text-xl font-semibold text-[var(--c-ink-2)] md:text-[22px]">
          Approaching Deadlines
        </h2>
        {alerts.length > 0 && (
          <span className="rounded-full bg-[#f4dede] px-2 py-0.5 text-[12px] font-semibold text-[#9b3b3b]">
            {alerts.length}
          </span>
        )}
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] px-4 py-10 text-center text-[13px] text-[var(--c-dim)]">
          Nothing urgent. Low-priority tasks due within {DEADLINE_ALERT_DAYS}{" "}
          days surface here.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {alerts.map(({ task, daysLeft }) => {
            const overdue = daysLeft < 0;
            return (
              <div
                key={task.id}
                className={cn(
                  "rounded-2xl border border-l-4 p-3.5 shadow-[0_1px_4px_rgba(74,64,54,0.05)]",
                  overdue
                    ? "border-[#e7c4c4] border-l-[#c2453f] bg-[#fbeaea] dark:border-[#5e3433] dark:bg-[#34211f]"
                    : "border-[#ecd9bf] border-l-[#cf9442] bg-[#fbf2e2] dark:border-[#5a4a2c] dark:bg-[#2f2719]"
                )}
              >
                <p className="line-clamp-2 text-[14px] font-semibold text-[var(--c-ink-2)]">
                  {task.title || "Untitled task"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold",
                      overdue
                        ? "bg-[#f4dede] text-[#9b3b3b] dark:bg-[#4a2a2a] dark:text-[#e9b6b6]"
                        : "bg-[#f3e7d0] text-[#8a6d3b] dark:bg-[#433719] dark:text-[#e2c489]"
                    )}
                  >
                    <CalendarDays className="size-3" />
                    {deadlineLabel(daysLeft)}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      PRIORITY_PILL[task.priority]
                    )}
                  >
                    {task.priority}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onEscalate(task.id)}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#a35d4d] px-3 py-2 text-[12.5px] font-semibold text-white shadow-[0_1px_2px_rgba(74,64,54,0.12)] transition-colors hover:bg-[#8f4f41] active:bg-[#7c453a]"
                >
                  <ArrowUp className="size-3.5" /> Escalate to High
                </button>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

export default function HomePage() {
  const tasks = useProdStore((state) => state.tasks);
  const goals = useProdStore((state) => state.goals);
  const activeTaskId = useProdStore((state) => state.activeTaskId);
  const setActiveTask = useProdStore((state) => state.setActiveTask);
  const escalatePriority = useProdStore((state) => state.escalatePriority);
  const sessionsCompleted = useProdStore((state) => state.sessionsCompleted);
  const history = useProdStore((state) => state.history);

  const { name, editableValue, canEdit, saveName } = useGreetingName();
  // Inline editing of the greeting name.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const startEditName = () => {
    setNameDraft(editableValue === "there" ? "" : editableValue);
    setEditingName(true);
  };
  const commitName = () => {
    saveName(nameDraft);
    setEditingName(false);
  };

  // "Completed Today" accordion — defaults collapsed so finished work stays
  // tucked away until the user wants to review it.
  const [showCompleted, setShowCompleted] = useState(false);

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

  // Balance widget: completed tasks per life pillar over the trailing 7 days,
  // summed from the daily history log. Gated on `now` so the date-relative
  // window only runs on the client and never mismatches the server render.
  const pillarTotals = useMemo(() => {
    const totals: Record<LifePillar, number> = {
      Wealth: 0,
      Health: 0,
      Career: 0,
      Personal_IP: 0,
    };
    if (!now) return totals;
    for (let i = 0; i < 7; i++) {
      const dayPillars = history[format(subDays(now, i), "yyyy-MM-dd")]?.pillars;
      if (!dayPillars) continue;
      for (const pillar of PILLAR_ORDER) {
        totals[pillar] += dayPillars[pillar] ?? 0;
      }
    }
    return totals;
  }, [now, history]);

  // Rank tasks by importance so the dashboard can surface what matters now
  // rather than the whole board: the pinned focus task leads, then incomplete
  // work, then higher priority, then the nearest deadline.
  const rankedTasks = useMemo(() => {
    const deadlineValue = (d: string | undefined) => {
      const match = d?.match(/\d{4}-\d{2}-\d{2}/);
      return match ? Date.parse(match[0]) : Number.POSITIVE_INFINITY;
    };
    return [...tasks].sort((a, b) => {
      if (a.id === activeTaskId) return -1;
      if (b.id === activeTaskId) return 1;
      const aDone = a.status === "Done" ? 1 : 0;
      const bDone = b.status === "Done" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) {
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      }
      const aDl = deadlineValue(a.deadline);
      const bDl = deadlineValue(b.deadline);
      if (aDl !== bDl) return aDl - bDl;
      return a.order - b.order;
    });
  }, [tasks, activeTaskId]);

  // Strict GTD Daily Action list: the dashboard surfaces ONLY tasks the user
  // explicitly promoted from the Workspace via "Send to Today" (isToday). The
  // Workspace backlog and the Inbox holding pen never appear here. Completed
  // today-tasks leave "Today's focus" and collect in the "Completed Today"
  // section.
  const activeTasks = useMemo(
    () =>
      rankedTasks.filter(
        (t) => t.isToday && t.status !== "Done" && t.status !== "Inbox"
      ),
    [rankedTasks]
  );
  const completedTasks = useMemo(
    () => rankedTasks.filter((t) => t.isToday && t.status === "Done"),
    [rankedTasks]
  );

  // Daytime vs. after-hours: evening tasks render under their own "This Evening"
  // header so workday and after-hours work stay psychologically separate.
  const dayTasks = useMemo(
    () => activeTasks.filter((t) => !t.isEvening),
    [activeTasks]
  );
  const eveningTasks = useMemo(
    () => activeTasks.filter((t) => t.isEvening),
    [activeTasks]
  );

  // Today's focus shows only the most important handful of daytime tasks — the
  // rest live on the board (linked below).
  const focusTasks = useMemo(
    () => dayTasks.slice(0, FOCUS_LIMIT),
    [dayTasks]
  );

  // Daily goal: a target of DAILY_GOAL_POINTS weighted effort points earned
  // *today*, read from the consistency log (not the all-time board count).
  const goalDone = now
    ? history[format(now, "yyyy-MM-dd")]?.points ?? 0
    : 0;
  const goalTotal = DAILY_GOAL_POINTS;

  // Action Center: under-prioritised tasks whose deadline is within a week
  // (overdue included). Gated on `now` so the date-relative math runs only on
  // the client and never mismatches the server render.
  const alertTasks = useMemo(() => {
    if (!now) return [] as { task: Task; daysLeft: number }[];
    const out: { task: Task; daysLeft: number }[] = [];
    for (const task of tasks) {
      if (task.status === "Done" || task.status === "Inbox") continue;
      if (task.priority === "High" || task.priority === "Critical") continue;
      const match = task.deadline?.match(/\d{4}-\d{2}-\d{2}/);
      if (!match) continue;
      const due = parseISO(match[0]);
      if (!isValid(due)) continue;
      const daysLeft = differenceInCalendarDays(due, now);
      if (daysLeft <= DEADLINE_ALERT_DAYS) out.push({ task, daysLeft });
    }
    return out.sort((a, b) => a.daysLeft - b.daysLeft);
  }, [tasks, now]);

  const toggle = (id: string) =>
    setActiveTask(activeTaskId === id ? null : id);

  return (
    <div className="px-5 py-7 md:px-8 md:py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 md:gap-[22px]">
        {/* Greeting header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[13.5px] font-medium whitespace-nowrap text-[var(--c-dim)]">
              <GreetingIcon className="size-4 text-[#a35d4d]" />
              <span>{dateLabel || " "}</span>
            </div>
            <h1 className="font-heading mt-2.5 text-3xl leading-tight font-semibold tracking-tight text-[var(--c-ink-2)] md:text-[38px]">
              {greeting.hello},{" "}
              {editingName ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  placeholder="your name"
                  maxLength={40}
                  style={{ width: `${Math.max(nameDraft.length, 6) + 1}ch` }}
                  className="max-w-full rounded-md border border-[#a35d4d]/40 bg-[var(--c-panel)] px-1.5 align-baseline outline-none focus:ring-2 focus:ring-[#a35d4d]/20"
                />
              ) : canEdit ? (
                <button
                  type="button"
                  onClick={startEditName}
                  title="Edit your name"
                  className="group/name inline-flex items-center gap-1.5 rounded-md border border-transparent px-1 align-baseline transition-colors hover:border-[var(--c-line)] hover:bg-[var(--c-panel-soft)]"
                >
                  {name}
                  <Pencil className="size-4 shrink-0 text-[var(--c-faint)] opacity-50 transition-opacity group-hover/name:opacity-100" />
                </button>
              ) : (
                name
              )}
              .
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

        {/* Balance — the Four Pillars of the life-OS */}
        <LifePillarsWidget totals={pillarTotals} />

        {/* North Star — big goals with live progress */}
        <NorthStarWidget goals={goals} tasks={tasks} />

        {/* Focus board + Action Center sidebar */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Today's focus */}
        <section className="lg:col-span-2">
          <div className="mb-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="font-heading text-xl font-semibold whitespace-nowrap text-[var(--c-ink-2)] md:text-[22px]">
                Today’s focus
              </h2>
              <span className="rounded-full bg-[var(--c-beige)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--c-dim)]">
                {dayTasks.length > FOCUS_LIMIT
                  ? `Top ${focusTasks.length} of ${dayTasks.length}`
                  : `${focusTasks.length} ${focusTasks.length === 1 ? "task" : "tasks"}`}
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
          ) : eveningTasks.length > 0 ? (
            // Daytime list is clear but evening work remains — skip the empty
            // state and let the "This Evening" block below carry the section.
            null
          ) : completedTasks.length > 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] py-12 text-center text-sm text-[var(--c-dim)]">
              All caught up — every task you picked for today is done. ✨
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] py-12 text-center text-sm text-[var(--c-dim)]">
              No tasks picked for today yet. Open your{" "}
              <Link href="/board" className="font-medium text-[#a35d4d] hover:underline">
                Workspace
              </Link>{" "}
              and tap the sun to send up to {FOCUS_LIMIT} here.
            </div>
          )}

          {/* This Evening — after-hours tasks, set apart from the day's focus */}
          {eveningTasks.length > 0 && (
            <div className="mt-6">
              <div className="mb-3 flex items-center gap-2.5 border-t border-dashed border-[var(--c-line)] pt-5">
                <Moon className="size-4 text-[#6a5b88]" />
                <h3 className="text-[13px] font-semibold tracking-[0.04em] text-[var(--c-dim)] uppercase">
                  This Evening
                </h3>
                <span className="rounded-full bg-[#e9e6f0] px-2 py-0.5 text-[11px] font-medium text-[#6a5b88]">
                  {eveningTasks.length}
                </span>
              </div>
              <div className="flex flex-col gap-2.5">
                {eveningTasks.map((task) => (
                  <FocusRow
                    key={task.id}
                    task={task}
                    isActive={task.id === activeTaskId}
                    onToggle={() => toggle(task.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </section>

          {/* Action Center — approaching-deadline alerts */}
          <DeadlineAlerts alerts={alertTasks} onEscalate={escalatePriority} />
        </div>

        {/* Completed Today — collapsible, defaults closed */}
        {completedTasks.length > 0 && (
          <section>
            <button
              type="button"
              onClick={() => setShowCompleted((v) => !v)}
              aria-expanded={showCompleted}
              className="flex w-full items-center justify-between rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] px-5 py-3.5 text-left shadow-[0_1px_3px_rgba(74,64,54,0.05)] transition-colors hover:bg-[var(--c-beige-2)]"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-md bg-[#6f9e6a] text-white">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
                <h2 className="font-heading text-base font-semibold text-[var(--c-ink-2)] md:text-lg">
                  Completed Today
                </h2>
                <span className="rounded-full bg-[var(--c-beige)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--c-dim)]">
                  {completedTasks.length}
                </span>
              </div>
              <ChevronDown
                className={cn(
                  "size-5 text-[var(--c-dim)] transition-transform",
                  showCompleted && "rotate-180"
                )}
              />
            </button>

            {showCompleted && (
              <div className="mt-2.5 flex flex-col gap-2.5">
                {completedTasks.map((task) => (
                  <FocusRow
                    key={task.id}
                    task={task}
                    isActive={task.id === activeTaskId}
                    onToggle={() => toggle(task.id)}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
