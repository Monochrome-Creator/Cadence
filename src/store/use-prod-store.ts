import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  addDays,
  addMonths,
  addWeeks,
  format,
  getISOWeek,
  getISOWeekYear,
  getMonth,
  getQuarter,
  getYear,
  isValid,
  parseISO,
  startOfWeek,
  subDays,
} from "date-fns";

import {
  deleteTaskRemote,
  ensureUserRow,
  isSupabaseConfigured,
  pullCategories,
  pullDailyPlan,
  pullTasks,
  pushCategories,
  pushDailyPlan,
  pushTasks,
  type SyncOutcome,
} from "./cloud-sync";

export const TASK_STATUSES = [
  "Working on it",
  "Stuck",
  "Done",
  "Not Started",
  "Inbox",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type TaskPriority = "Low" | "Medium" | "High" | "Critical";

/**
 * The "Four Pillars" of the life-OS: the high-level life areas a task can be
 * attributed to. A task with no pillar is a general/untagged item. `Personal_IP`
 * is stored with an underscore (DB-safe enum value); the UI renders it as
 * "Personal IP" — see src/lib/life-pillars.ts.
 */
export const LIFE_PILLARS = [
  "Wealth",
  "Health",
  "Career",
  "Personal_IP",
] as const;

export type LifePillar = (typeof LIFE_PILLARS)[number];

/** How often a task repeats. 'none' is a one-off task. */
export type Recurrence =
  | "none"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly";

/** Nesting depth of a subtask: L1 (direct child), L2 (grandchild), or L3 (great-grandchild). */
export type SubtaskLevel = "L1" | "L2" | "L3";

/**
 * A micro-task is either open ("todo"), completed ("done"), or "cancelled" —
 * crossed out because it can't / won't be finished. Cancelled rows are treated
 * as resolved (100%) by the roll-ups so they never drag a card's progress down.
 */
export type SubtaskStatus = "todo" | "done" | "cancelled";

export interface Subtask {
  id: string;
  title: string;
  status: SubtaskStatus;
  level: SubtaskLevel;
  /**
   * Completion percent (0–100) for a leaf micro-task. Parent rows ignore this
   * stored value and show an average of their children instead (see
   * computeSubtaskRollups). Undefined on rows created before this field.
   */
  percent?: number;
  /** Optional per-micro-task due date as a yyyy-MM-dd string. */
  deadline?: string;
}

/**
 * Sentinel stored in `Task.deadline` when the user explicitly chose "this task
 * needs no deadline" (vs. "" = simply not set yet). It flows through Supabase
 * unchanged (the column is text) and every renderer extracts yyyy-MM-dd before
 * displaying, so it never shows up as literal text — but it keeps the task out
 * of the missing-deadline reminder.
 */
export const NO_DEADLINE = "none";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  /**
   * Due date stored as a yyyy-MM-dd string. "" when unset; the {@link NO_DEADLINE}
   * sentinel when the user explicitly opted out of a deadline.
   */
  deadline: string;
  /** Free-form grouping label. Defaults to "General". */
  category: string;
  /** Optional second-level grouping within a category ("" when unset). */
  subcategory: string;
  /**
   * Which "Four Pillars" life area this task serves (Wealth/Health/Career/
   * Personal_IP). Undefined for general, unattributed tasks. Powers the
   * dashboard's Balance widget and the colored pillar badges on cards.
   */
  lifePillar?: LifePillar;
  /** Repeat interval driving completeAndRepeatTask. */
  recurrence: Recurrence;
  /**
   * Calendar-period identifier of the period in which this recurring task was
   * last completed — e.g. "2026-06-14" (daily), "2026-W24" (weekly), "2026-06"
   * (monthly), "2026-Q2" (quarterly). When a recurring task is Done and this no
   * longer matches the current period, {@link refreshRecurringTasks} reopens it.
   * Undefined for one-off tasks and recurring tasks that have never completed.
   */
  lastCompletedPeriod?: string;
  pomodorosLogged: number;
  /** Manual sort position for drag-and-drop ordering (ascending). */
  order: number;
  /**
   * Manually-set completion percent (0–100). Only consulted when the task has
   * NO micro-tasks — once children exist, progress is the read-only roll-up of
   * their averaged completion (see effectiveTaskProgress). Undefined on tasks
   * created before this field, treated as 0.
   */
  progress?: number;
  /**
   * When true, the task is an "after-hours" item — surfaced under a separate
   * "This Evening" header on the dashboard to keep workday and evening work
   * psychologically apart. Undefined/false means a normal daytime task.
   */
  isEvening?: boolean;
  /**
   * GTD "Today" promotion flag. A workspace task (status !== "Inbox") with
   * isToday true is a non-negotiable Daily Action item surfaced on the Dashboard;
   * false/undefined keeps it in the Workspace master backlog. The number of
   * *active* (non-Done) today-tasks is capped at {@link MAX_TODAY_TASKS}.
   */
  isToday?: boolean;
  /**
   * The North Star goal this task is contributing toward. Links the day-to-day
   * work on the board to a bigger-picture objective so context is never lost.
   * Undefined for tasks not tied to any goal.
   */
  goalId?: string;
  subtasks: Subtask[];
}

/** Numeric depth per level, for roll-up math. */
const SUBTASK_LEVEL_NUM: Record<SubtaskLevel, number> = { L1: 1, L2: 2, L3: 3 };

/** Clamp a raw percent into the 0–100 integer range. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export interface SubtaskRollup {
  /** Completion 0–100: own value for leaves, averaged for parents. */
  percent: number;
  /** True for leaf rows (no deeper children) — the only directly editable ones. */
  editable: boolean;
}

/**
 * Effective completion of a leaf micro-task. A checked-off row counts as 100%
 * even if its percent was never set, so the checkbox and the percent field stay
 * in agreement and both feed the roll-ups identically.
 */
function leafPercent(subtask: Subtask): number {
  // A cancelled row is resolved: it counts as fully closed so the card can still
  // reach 100% without the abandoned step holding it back.
  if (subtask.status === "cancelled") return 100;
  return Math.max(
    subtask.status === "done" ? 100 : 0,
    clampPercent(subtask.percent ?? 0)
  );
}

/**
 * Per-row completion for the micro-task list. Each micro-task is its own unit of
 * work: a row's percent reflects only its own state (a checked or cancelled row
 * is 100%, otherwise its manually-set percent) — it is NOT a roll-up of its
 * children. Parent rows (those with deeper rows beneath them) aren't directly
 * editable; you complete them with their own checkbox. Keeping L1/L2/L3 as
 * independent steps means finishing a deep L3 doesn't mark its ancestors — or
 * the whole task — complete.
 */
export function computeSubtaskRollups(
  subtasks: Subtask[]
): Record<string, SubtaskRollup> {
  const n = subtasks.length;
  const level = subtasks.map((s) => SUBTASK_LEVEL_NUM[s.level]);

  const hasChildren = (i: number): boolean => {
    for (let j = i + 1; j < n; j++) {
      if (level[j] <= level[i]) break; // block closed by a same/shallower row
      if (level[j] === level[i] + 1) return true;
    }
    return false;
  };

  const out: Record<string, SubtaskRollup> = {};
  for (let i = 0; i < n; i++) {
    out[subtasks[i].id] = {
      percent: leafPercent(subtasks[i]),
      editable: !hasChildren(i),
    };
  }
  return out;
}

/**
 * Overall task completion: the average of every micro-task's own percent, so
 * each L1/L2/L3 counts equally. Completing a single deep micro-task therefore
 * nudges the bar by one unit instead of jumping the whole task to 100%. Returns
 * 0 when the task has no micro-tasks.
 */
export function computeTaskProgress(subtasks: Subtask[]): number {
  if (subtasks.length === 0) return 0;
  const total = subtasks.reduce((sum, s) => sum + leafPercent(s), 0);
  return Math.round(total / subtasks.length);
}

/**
 * Effective completion percent shown on a Main Task's progress bar. A task
 * marked Done always reads 100% (so the dropdown/checkbox can force-complete it
 * regardless of its children). Otherwise it's the roll-up of its micro-tasks
 * when any exist, or the user's manual `progress` override when the task has no
 * children — this is what keeps an empty task's percentage field editable.
 */
export function effectiveTaskProgress(task: Task): number {
  if (task.status === "Done") return 100;
  if (task.subtasks.length > 0) return computeTaskProgress(task.subtasks);
  return clampPercent(task.progress ?? 0);
}

/**
 * A "North Star" goal — a high-level life objective that tasks can be linked
 * to, giving individual work items a bigger-picture context. Goals can
 * optionally belong to a life pillar (pulling in that pillar's color treatment)
 * or be fully independent. The `status` field drives the /goals page split
 * between active and achieved goals.
 */
export interface Goal {
  id: string;
  title: string;
  /** One-line motivational description or "why this matters". */
  description: string;
  /** Target achievement date as yyyy-MM-dd ("" when open-ended). */
  targetDate: string;
  /** Optional pillar association for visual grouping and color. */
  lifePillar?: LifePillar;
  status: "active" | "done";
  order: number;
}

export interface Flashcard {
  question: string;
  answer: string;
}

/** One day's logged productivity, keyed by local `yyyy-MM-dd` in `history`. */
export interface DayActivity {
  /** Completed focus (Pomodoro) sessions that day. */
  sessions: number;
  /** Tasks marked Done that day. */
  tasksDone: number;
  /**
   * Weighted effort points earned that day — the sum of completed tasks'
   * priority-based point values (see TASK_POINTS). Drives the Daily Goal and
   * streak. Optional so days logged before this field default to 0.
   */
  points?: number;
  /**
   * Per-pillar completion counts for that day — how many tasks tagged to each
   * life pillar were finished. Drives the dashboard Balance widget's trailing
   * 7-day view. Optional/sparse: only pillars with completions appear, and days
   * logged before this field default to none.
   */
  pillars?: Partial<Record<LifePillar, number>>;
}

/** Derived consistency metrics shown on the home dashboard. */
export interface HistoryStats {
  /** Consecutive active days ending today (or yesterday if today is unlogged). */
  streak: number;
  /** Longest run of consecutive active days ever recorded. */
  bestStreak: number;
  /** Current week Mon→Sun, each a dot state for the streak strip. */
  days: ("done" | "today" | "off")[];
  /** Trailing 7-day focus-session counts (oldest → today) for the sparkline. */
  week: number[];
}

/**
 * Weighted effort points a task is worth when completed, by priority. Higher-
 * priority work counts for more so the daily goal can't be gamed by clearing a
 * pile of trivial tasks, while small chores still earn something.
 */
export const TASK_POINTS: Record<TaskPriority, number> = {
  Critical: 5,
  High: 3,
  Medium: 2,
  Low: 1,
};

/** Effort points a task contributes toward the daily goal / streak. */
export function taskPoints(priority: TaskPriority): number {
  return TASK_POINTS[priority];
}

/**
 * Daily effort-point target. Drives both the dashboard's Daily Goal ring and
 * the streak: a day counts toward the streak once this many weighted points
 * have been earned from completed tasks.
 */
export const DAILY_GOAL_POINTS = 10;

/* -------------------------------------------------------------------------- */
/*                          Daily Plan (auto-planner)                         */
/* -------------------------------------------------------------------------- */

/** Today as a local yyyy-MM-dd string (date-only, for plan/period comparisons). */
export function todayKey(date: Date = new Date()): string {
  return format(date, "yyyy-MM-dd");
}

/** The auto-generated plan for one calendar day. */
export interface DailyPlan {
  /** yyyy-MM-dd this plan was generated for. */
  date: string;
  /**
   * Snapshot of the workspace focus tasks (isToday) captured when this day's
   * plan was built. Not rendered directly — the focus list reads the live
   * isToday flag — but kept so the next-day rollover can detect which focus
   * tasks went unfinished and surface them in the review.
   */
  mainTaskIds: string[];
  /**
   * Tasks the user hand-picked for today via the "Focus" button — a separate,
   * self-curated focus list they clear as the day's manual work. Optional so
   * plans synced before this field round-trip cleanly.
   */
  manualTaskIds?: string[];
}

/** A pending "you missed these" review surfaced on the next app open. */
export interface PendingReview {
  /** The plan-date whose main tasks went unfinished. */
  date: string;
  /** Tasks from that day's plan that were still incomplete when the day rolled. */
  taskIds: string[];
}

/**
 * A day's plan split for rendering: the `main` focus list (driven entirely by
 * the workspace "Send to Today" / isToday mark) and the user's hand-picked
 * `manual` focus tasks pulled forward from a missed day.
 */
export interface DailyPlanView {
  main: Task[];
  manual: Task[];
}

/**
 * Resolve the Daily Plan for rendering. There is no auto-ranking: `main` is
 * exactly the tasks the user marked as focus in the Workspace (isToday), in
 * board order. `manual` follows the user's review "Today" picks, excluding any
 * already in `main` so a task never shows twice. Done tasks stay in their list
 * so the user still sees the win.
 */
export function resolveDailyPlan(
  plan: DailyPlan | null,
  tasks: Task[]
): DailyPlanView {
  const main = tasks
    .filter((t) => t.isToday)
    .sort((a, b) => a.order - b.order);
  if (!plan) return { main, manual: [] };
  const mainIds = new Set(main.map((t) => t.id));
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  const manual = (plan.manualTaskIds ?? [])
    .filter((id) => !mainIds.has(id))
    .map((id) => byId.get(id))
    .filter((t): t is Task => t != null);
  return { main, manual };
}

/** A day's earned effort points (tolerating legacy days with no `points`). */
function dayPoints(day: DayActivity | undefined): number {
  return day?.points ?? 0;
}

/** A day counts toward a streak once it hits the daily effort-point goal. */
function isDayActive(history: Record<string, DayActivity>, key: string): boolean {
  return dayPoints(history[key]) >= DAILY_GOAL_POINTS;
}

/** Return a new history with today's `field` incremented by one. */
function bumpHistory(
  history: Record<string, DayActivity>,
  field: "sessions" | "tasksDone" | "points"
): Record<string, DayActivity> {
  const key = format(new Date(), "yyyy-MM-dd");
  const prev = history[key] ?? { sessions: 0, tasksDone: 0, points: 0 };
  return { ...history, [key]: { ...prev, [field]: (prev[field] ?? 0) + 1 } };
}

/**
 * Record a completed task in today's log: bumps the task count by one and adds
 * its weighted effort points. Both feed the Daily Goal and streak. When the
 * task is attributed to a life pillar, that pillar's daily count is also
 * incremented so the Balance widget can show a trailing-7-day breakdown.
 */
function logTaskCompletion(
  history: Record<string, DayActivity>,
  points: number,
  pillar?: LifePillar
): Record<string, DayActivity> {
  const key = format(new Date(), "yyyy-MM-dd");
  const prev = history[key] ?? { sessions: 0, tasksDone: 0, points: 0 };
  return {
    ...history,
    [key]: {
      ...prev,
      tasksDone: prev.tasksDone + 1,
      points: (prev.points ?? 0) + points,
      pillars: pillar
        ? { ...prev.pillars, [pillar]: (prev.pillars?.[pillar] ?? 0) + 1 }
        : prev.pillars,
    },
  };
}

/**
 * Pure derivation of the dashboard's consistency metrics from the daily log.
 * Computed in the component (via useMemo) so it always reflects the live date.
 */
export function computeHistoryStats(
  history: Record<string, DayActivity>
): HistoryStats {
  const key = (d: Date) => format(d, "yyyy-MM-dd");
  const today = new Date();
  const todayKey = key(today);

  // Current streak: walk back from today (or yesterday, so a not-yet-logged
  // today doesn't reset the count) while each day stays active.
  let streak = 0;
  let cursor = isDayActive(history, todayKey) ? today : subDays(today, 1);
  while (isDayActive(history, key(cursor))) {
    streak++;
    cursor = subDays(cursor, 1);
  }

  // Best streak: longest run of consecutive calendar days in the log.
  const activeKeys = Object.keys(history)
    .filter((k) => isDayActive(history, k))
    .sort();
  let bestStreak = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of activeKeys) {
    run = prev && key(addDays(parseISO(prev), 1)) === k ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    prev = k;
  }
  bestStreak = Math.max(bestStreak, streak);

  // Current-week strip, Monday→Sunday.
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => {
    const k = key(addDays(weekStart, i));
    if (k === todayKey) return "today" as const;
    return isDayActive(history, k) ? ("done" as const) : ("off" as const);
  });

  // Trailing 7-day session sparkline (oldest → today, so the last bar is today).
  const week = Array.from(
    { length: 7 },
    (_, i) => history[key(subDays(today, 6 - i))]?.sessions ?? 0
  );

  return { streak, bestStreak, days, week };
}

/**
 * Cloud connection state surfaced by the UI status dot:
 *  - "synced"     — last cloud round-trip succeeded.
 *  - "connecting" — a pull/push is in flight.
 *  - "offline"    — cloud disabled, signed out, or an actual network drop.
 *  - "error"      — the server rejected the write (auth/RLS/schema). The device
 *                   is online; the request failed. Distinct from "offline" so a
 *                   401/403 never masquerades as a network outage.
 */
export type ConnectionStatus = "synced" | "connecting" | "offline" | "error";

/* -------------------------------------------------------------------------- */
/*                          GTD "Today" capacity rule                         */
/* -------------------------------------------------------------------------- */

/**
 * The GTD capacity constraint: at most this many *active* (non-Done) tasks may
 * be promoted to the Dashboard's Daily Action list at once. Keeps the day's
 * commitments to a focused, finishable handful.
 */
export const MAX_TODAY_TASKS = 5;

/**
 * Count of active Daily Action tasks — workspace tasks (not Inbox) flagged
 * isToday that aren't yet Done. Completed today-tasks don't count against the
 * cap, so finishing one frees a slot.
 */
export function countActiveTodayTasks(tasks: Task[]): number {
  return tasks.reduce(
    (count, task) =>
      task.isToday && task.status !== "Done" && task.status !== "Inbox"
        ? count + 1
        : count,
    0
  );
}

/* -------------------------------------------------------------------------- */
/*                               Pomodoro engine                              */
/* -------------------------------------------------------------------------- */

export const TIMER_MODES = ["focus", "shortBreak", "longBreak"] as const;
export type TimerMode = (typeof TIMER_MODES)[number];

/** Durations in seconds. Psychology-backed Pomodoro defaults. */
export const TIMER_DURATIONS: Record<TimerMode, number> = {
  focus: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
};

/** A long break is triggered after every N completed focus sessions. */
export const SESSIONS_BEFORE_LONG_BREAK = 4;

export const TIMER_MODE_LABELS: Record<TimerMode, string> = {
  focus: "Focus",
  shortBreak: "Short Break",
  longBreak: "Long Break",
};

/* -------------------------------------------------------------------------- */
/*                                   Store                                    */
/* -------------------------------------------------------------------------- */

interface ProdState {
  // Board / flashcards
  tasks: Task[];
  /** Managed, ordered list of board categories (columns). Persists empty ones. */
  categories: string[];
  /** North Star goals — the big objectives tasks are working toward. */
  goals: Goal[];
  flashcards: Flashcard[];
  activeTaskId: string | null;
  /** Daily productivity log keyed by local `yyyy-MM-dd` — powers the streak. */
  history: Record<string, DayActivity>;
  /**
   * The auto-generated plan for the current day (1–2 main tasks). Regenerated
   * when the calendar day rolls over via {@link ensureDailyPlan}. Null until the
   * first plan is built.
   */
  dailyPlan: DailyPlan | null;
  /**
   * A "you missed these" review for the previous day's unfinished plan, surfaced
   * once on the next app open. Cleared as soon as the user responds so it never
   * nags repeatedly. Null when there's nothing to review.
   */
  pendingReview: PendingReview | null;

  // Cloud sync
  /** Whether Supabase credentials are present and cloud sync is active. */
  cloudEnabled: boolean;
  /** True once the initial cloud pull (or local fallback) has completed. */
  isHydrated: boolean;
  /** True while a pull/push round-trip is in flight. */
  isSyncing: boolean;
  /** Cloud connection status driving the header status dot. */
  connectionStatus: ConnectionStatus;
  /** Last server-side sync error message (null when none) — shown when status is "error". */
  lastSyncError: string | null;

  // Timer
  mode: TimerMode;
  timeLeft: number;
  sessionsCompleted: number;
  isRunning: boolean;
  /** Monotonic counter bumped on every completed session — drives the chime. */
  completions: number;

  // Board / flashcard actions
  addTask: (
    task: Omit<
      Task,
      "id" | "order" | "subtasks" | "category" | "subcategory" | "recurrence"
    > &
      Partial<Pick<Task, "category" | "subcategory" | "recurrence">>
  ) => void;
  updateTask: (id: string, updates: Partial<Omit<Task, "id">>) => void;
  /**
   * Bumps a task straight to "High" priority — used by the dashboard's
   * Approaching Deadlines alerts to escalate an under-prioritised task in one
   * click.
   */
  escalatePriority: (id: string) => void;
  /**
   * Promotes a workspace task onto the Dashboard's Daily Action list (isToday).
   * Enforces the GTD capacity rule: returns false WITHOUT mutating when the
   * active today-count is already at {@link MAX_TODAY_TASKS}, so the caller can
   * surface the "capacity reached" toast. Returns true once promoted.
   */
  sendTaskToToday: (id: string) => boolean;
  /** Demotes a Daily Action task back to the Workspace backlog (clears isToday). */
  removeTaskFromToday: (id: string) => void;
  /**
   * Escape hatch: sends a workspace task back to the Inbox holding pen and
   * clears any Today promotion so it leaves both the board and the dashboard.
   */
  returnTaskToInbox: (id: string) => void;
  /**
   * Stops a task from spawning future clones by clearing its recurrence back to
   * "none" — backs the Scheduled Tasks manager's "Cancel Recurrence" button.
   */
  cancelRecurrence: (id: string) => void;
  /** Manually overwrite the logged Pomodoro session count for a task. */
  updateTaskSessions: (taskId: string, newSessionCount: number) => void;
  deleteTask: (id: string) => void;
  reorderTasks: (activeId: string, overId: string) => void;
  /**
   * Moves a task into `targetCategory` and repositions it relative to `overId`
   * (or appends it to the end when `overId` is null). Powers cross-category
   * drag-and-drop between grouped board columns.
   */
  moveTask: (
    activeId: string,
    overId: string | null,
    targetCategory: string
  ) => void;
  /** Appends a new category column. Trims, ignores blanks and duplicates. */
  addCategory: (name: string) => void;
  /**
   * Replaces the category list with a new ordered array — used by the board's
   * drag-to-reorder sections feature. Deduplicates and filters blanks.
   */
  reorderCategories: (orderedNames: string[]) => void;
  /**
   * Renames a category and re-tags every task that used the old name. No-op for
   * the protected "General" bucket or when the target name already exists.
   */
  renameCategory: (oldName: string, newName: string) => void;
  /**
   * Removes a category column and reassigns any tasks it held to "General" so
   * no task is lost. "General" itself cannot be deleted.
   */
  deleteCategory: (name: string) => void;
  /**
   * Completes a task. One-off tasks simply go Done; a recurring task is marked
   * Done and stamped with the current calendar period — it stays a SINGLE card
   * (no clones) and {@link refreshRecurringTasks} reopens it next period.
   */
  completeAndRepeatTask: (taskId: string) => void;
  /**
   * Reopens recurring tasks whose completion period has elapsed: a Done weekly
   * task becomes available again next calendar week, monthly next month, etc.
   * Resets its micro-tasks/progress and rolls a stale deadline into the current
   * period. Idempotent — a no-op when nothing has rolled over. Call on app open
   * and on day change.
   */
  refreshRecurringTasks: () => void;
  /**
   * Ensures {@link dailyPlan} targets today, regenerating it when the calendar
   * day has rolled over. On rollover it also captures the previous day's
   * unfinished main tasks into {@link pendingReview} (once). Idempotent.
   */
  ensureDailyPlan: () => void;
  /** Dismiss the missed-task review without further action ("Skip for now"). */
  dismissReview: () => void;
  /** Hand-pick a task into today's manual focus list (the "Focus" button). */
  planMoveToToday: (taskId: string) => void;
  /** Remove a task from today's focus (auto or manual), back to the backlog. */
  planRemoveFromToday: (taskId: string) => void;
  /** Mark every manual-focus task done — the "Clear for the day" affordance. */
  clearManualFocus: () => void;
  /** Complete a reviewed missed task in place, then drop it from the review. */
  planCompleteTask: (taskId: string) => void;
  addSubtask: (taskId: string, title: string, level: SubtaskLevel) => void;
  /**
   * Inserts a blank micro-task immediately after `afterSubtaskId` at the given
   * level (used for inline nested creation). Returns the new subtask's id so
   * the caller can focus it. No-op (returns null) if the parent isn't found.
   */
  insertSubtaskAfter: (
    taskId: string,
    afterSubtaskId: string,
    level: SubtaskLevel
  ) => string | null;
  updateSubtask: (
    taskId: string,
    subtaskId: string,
    updates: Partial<Omit<Subtask, "id">>
  ) => void;
  /**
   * Removes a micro-task and its descendant block — the contiguous deeper rows
   * that follow it in the outline (e.g. deleting an L1 also drops its L2/L3
   * children) so the hierarchy never ends up with orphaned rows.
   */
  deleteSubtask: (taskId: string, subtaskId: string) => void;
  /**
   * Reorders a micro-task within its task by moving `activeId` to where
   * `overId` currently sits (drag-and-drop). The new array position persists as
   * `subtask_order` on the next sync.
   */
  reorderSubtasks: (
    taskId: string,
    activeId: string,
    overId: string
  ) => void;
  /**
   * Toggles a micro-task's done state via its checkbox and cascades the new
   * state to its entire descendant block. Checking a parent (L1/L2) therefore
   * force-completes everything beneath it, driving its averaged roll-up to
   * 100%; unchecking reopens the whole branch.
   */
  toggleSubtaskComplete: (taskId: string, subtaskId: string) => void;
  /**
   * Crosses a micro-task out as "cancelled" (can't / won't finish) and cascades
   * the state to its descendant block, mirroring {@link toggleSubtaskComplete}.
   * Toggling an already-cancelled row reopens it back to "todo".
   */
  toggleSubtaskCancelled: (taskId: string, subtaskId: string) => void;
  /** Create a new North Star goal. */
  addGoal: (goal: Omit<Goal, "id" | "order">) => void;
  /** Update any fields on an existing goal. */
  updateGoal: (id: string, updates: Partial<Omit<Goal, "id">>) => void;
  /**
   * Delete a goal and clear its reference from any tasks that were linked to
   * it, so no task is left with a dangling goalId.
   */
  deleteGoal: (id: string) => void;

  setFlashcards: (flashcards: Flashcard[]) => void;
  setActiveTask: (id: string | null) => void;

  /**
   * Pulls cloud state into the store (or seeds the cloud from local state on a
   * first run). Safe to call multiple times; intended for app mount.
   */
  hydrate: () => Promise<void>;
  /**
   * Manual "refresh from cloud" — re-pulls the latest cloud state on demand
   * (unlike `hydrate`, which only runs once at mount). Re-entrant-safe and
   * always fails soft: a network error keeps the local data and flips the
   * status to "offline" rather than throwing.
   */
  forceSync: () => Promise<void>;

  // Timer actions
  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  switchMode: (mode: TimerMode) => void;
  tick: () => void;
  completeSession: () => void;
}

const initialTasks: Task[] = [
  {
    id: "task-1",
    title: "Draft Q3 product roadmap",
    status: "Working on it",
    priority: "High",
    deadline: "2026-06-07",
    category: "Work",
    subcategory: "Planning",
    recurrence: "none",
    pomodorosLogged: 3,
    order: 0,
    subtasks: [
      {
        id: "subtask-1a",
        title: "Collect stakeholder input",
        status: "done",
        level: "L1",
      },
      {
        id: "subtask-1b",
        title: "Draft milestone timeline",
        status: "todo",
        level: "L1",
      },
    ],
  },
  {
    id: "task-2",
    title: "Fix PDF import parser edge cases",
    status: "Stuck",
    priority: "Critical",
    deadline: "2026-05-31",
    category: "Work",
    subcategory: "Bug fixes",
    recurrence: "none",
    pomodorosLogged: 5,
    order: 1,
    subtasks: [],
  },
  {
    id: "task-3",
    title: "Write onboarding documentation",
    status: "Not Started",
    priority: "Medium",
    deadline: "2026-06-14",
    category: "Learning",
    subcategory: "",
    recurrence: "weekly",
    pomodorosLogged: 0,
    order: 2,
    subtasks: [],
  },
  {
    id: "task-4",
    title: "Ship dark mode toggle",
    status: "Done",
    priority: "Low",
    deadline: "2026-05-24",
    category: "General",
    subcategory: "",
    recurrence: "none",
    pomodorosLogged: 4,
    order: 3,
    subtasks: [],
  },
];

/** Seed columns: the canonical buckets the demo tasks live in. */
const initialCategories = ["Work", "Learning", "General"];

/**
 * Distinct categories present on the given tasks, in first-seen order, always
 * including the "General" fallback. Used to seed the managed list on first run.
 */
function deriveCategories(tasks: Task[]): string[] {
  const seen: string[] = [];
  for (const task of tasks) {
    const key = task.category.trim() || "General";
    if (!seen.includes(key)) seen.push(key);
  }
  if (!seen.includes("General")) seen.push("General");
  return seen;
}

/** Decide which mode follows a completed session. */
function getNextMode(
  completedMode: TimerMode,
  sessionsCompletedAfter: number
): TimerMode {
  if (completedMode !== "focus") {
    // Any break is followed by a focus session.
    return "focus";
  }
  return sessionsCompletedAfter % SESSIONS_BEFORE_LONG_BREAK === 0
    ? "longBreak"
    : "shortBreak";
}

/** Advance a Date by exactly one recurrence interval. Never called with "none". */
function addRecurrenceInterval(base: Date, recurrence: Recurrence): Date {
  return recurrence === "daily"
    ? addDays(base, 1)
    : recurrence === "weekly"
      ? addWeeks(base, 1)
      : recurrence === "quarterly"
        ? addMonths(base, 3)
        : addMonths(base, 1);
}

/**
 * Advance a yyyy-MM-dd deadline forward by recurrence intervals until it lands
 * on or after `from` (today by default) — so a recurring task that was overdue
 * by several periods gets a due date in the current period, not just +1 from a
 * long-past date. Falls back to `from` when the stored deadline is empty/invalid.
 */
function advanceDeadlineToCurrentPeriod(
  deadline: string,
  recurrence: Recurrence,
  from: Date
): string {
  if (!isValid(parseISO(deadline))) return format(from, "yyyy-MM-dd");
  const fromKey = format(from, "yyyy-MM-dd");
  let next = parseISO(deadline);
  // Guard the loop so a corrupt date can never spin forever.
  for (let i = 0; i < 1000 && format(next, "yyyy-MM-dd") < fromKey; i++) {
    next = addRecurrenceInterval(next, recurrence);
  }
  return format(next, "yyyy-MM-dd");
}

/**
 * Calendar-period key for a recurring task: the identifier that stays constant
 * within one occurrence window and flips when the next window begins. This is
 * what drives "resets next week/month/quarter" — completion stamps the current
 * key, and {@link refreshRecurringTasks} reopens the task once the key changes.
 *   daily     -> "2026-06-14"   (the calendar day)
 *   weekly    -> "2026-W24"     (ISO week — Mon-anchored, year-correct at edges)
 *   monthly   -> "2026-06"      (calendar month)
 *   quarterly -> "2026-Q2"      (calendar quarter)
 */
function periodKey(recurrence: Recurrence, date: Date): string {
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

/* -------------------------------------------------------------------------- */
/*                          Debounced cloud pushes                            */
/* -------------------------------------------------------------------------- */
/**
 * Collects task ids touched by recent mutations and flushes them to the cloud
 * after a short idle window, coalescing bursts of edits into one round-trip.
 * No-op when Supabase is not configured.
 */
let pushTimer: ReturnType<typeof setTimeout> | null = null;
const pendingTaskIds = new Set<string>();

/**
 * Maps a cloud-write {@link SyncOutcome} onto the connection status.
 *
 * The key fix: a server rejection (auth/RLS/schema) is NOT a network outage.
 * Only a real network drop (or signed-out/unconfigured) flips the dot to
 * "offline"; auth/data rejections become the distinct "error" status so a
 * 401/403 can never masquerade as "Offline" — and the real message is kept in
 * `lastSyncError` for display/diagnosis.
 */
function applyPushOutcome(outcome: SyncOutcome): void {
  if (outcome.ok) {
    useProdStore.setState({ connectionStatus: "synced", lastSyncError: null });
    return;
  }
  if (outcome.reason === "network" || outcome.reason === "unavailable") {
    useProdStore.setState({ connectionStatus: "offline" });
  } else {
    useProdStore.setState({
      connectionStatus: "error",
      lastSyncError: outcome.message ?? "Sync failed",
    });
  }
}

function queueTaskPush(getState: () => ProdState, taskIds: string[]): void {
  if (!isSupabaseConfigured) return;
  for (const id of taskIds) pendingTaskIds.add(id);
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const ids = new Set(pendingTaskIds);
    pendingTaskIds.clear();
    const tasks = getState().tasks.filter((task) => ids.has(task.id));
    if (tasks.length === 0) return;
    useProdStore.setState({ connectionStatus: "connecting" });
    void pushTasks(tasks).then(applyPushOutcome);
  }, 400);
}

/** Convenience: push every current task (used for reorders/seeding). */
function queueAllTasksPush(getState: () => ProdState): void {
  queueTaskPush(
    getState,
    getState().tasks.map((task) => task.id)
  );
}

/** Persist the managed category list to the cloud (no-op when unconfigured). */
function pushCategoriesIfCloud(getState: () => ProdState): void {
  if (!isSupabaseConfigured) return;
  void pushCategories(getState().categories);
}

/** Persist the daily plan + pending review to the cloud (no-op when unconfigured). */
function pushDailyPlanIfCloud(getState: () => ProdState): void {
  if (!isSupabaseConfigured) return;
  const { dailyPlan, pendingReview } = getState();
  void pushDailyPlan({ plan: dailyPlan, review: pendingReview });
}

export const useProdStore = create<ProdState>()(
  persist(
    (set, get) => ({
  tasks: initialTasks,
  categories: initialCategories,
  goals: [],
  flashcards: [],
  activeTaskId: null,
  history: {},
  dailyPlan: null,
  pendingReview: null,

  cloudEnabled: isSupabaseConfigured,
  isHydrated: false,
  isSyncing: false,
  // Start "connecting" when cloud is on (hydrate runs at mount); otherwise the
  // app is purely local, which we surface as "offline" (on-device data).
  connectionStatus: isSupabaseConfigured ? "connecting" : "offline",
  lastSyncError: null,

  mode: "focus",
  timeLeft: TIMER_DURATIONS.focus,
  sessionsCompleted: 0,
  isRunning: false,
  completions: 0,

  addTask: (task) => {
    const newId = `task-${crypto.randomUUID()}`;
    set((state) => {
      const maxOrder = state.tasks.reduce(
        (max, t) => Math.max(max, t.order),
        -1
      );
      return {
        tasks: [
          ...state.tasks,
          {
            ...task,
            id: newId,
            order: maxOrder + 1,
            category: task.category ?? "General",
            subcategory: task.subcategory ?? "",
            recurrence: task.recurrence ?? "none",
            subtasks: [],
          },
        ],
      };
    });
    queueTaskPush(get, [newId]);
  },
  updateTask: (id, updates) => {
    set((state) => {
      // Log a completion the first time a task transitions into Done.
      const existing = state.tasks.find((t) => t.id === id);
      const becameDone =
        updates.status === "Done" && existing?.status !== "Done";
      // Credit the task's weighted points using its (possibly just-updated)
      // priority.
      const points = existing
        ? taskPoints(updates.priority ?? existing.priority)
        : 0;
      return {
        tasks: state.tasks.map((task) =>
          task.id === id ? { ...task, ...updates } : task
        ),
        history: becameDone
          ? logTaskCompletion(
              state.history,
              points,
              updates.lifePillar ?? existing?.lifePillar
            )
          : state.history,
      };
    });
    queueTaskPush(get, [id]);
  },
  escalatePriority: (id) => get().updateTask(id, { priority: "High" }),
  sendTaskToToday: (id) => {
    const { tasks } = get();
    const target = tasks.find((t) => t.id === id);
    // No-op for unknown or already-promoted tasks (idempotent, frees no slot).
    if (!target || target.isToday) return true;
    // Enforce the capacity cap BEFORE mutating, so a blocked promotion leaves
    // state untouched and the caller can show the "capacity reached" toast.
    if (countActiveTodayTasks(tasks) >= MAX_TODAY_TASKS) return false;
    get().updateTask(id, { isToday: true });
    return true;
  },
  removeTaskFromToday: (id) => get().updateTask(id, { isToday: false }),
  returnTaskToInbox: (id) =>
    get().updateTask(id, { status: "Inbox", isToday: false }),
  cancelRecurrence: (id) => get().updateTask(id, { recurrence: "none" }),
  updateTaskSessions: (taskId, newSessionCount) => {
    // Clamp to a non-negative integer — sessions can't be fractional or negative.
    const sessions = Math.max(0, Math.floor(newSessionCount));
    if (!Number.isFinite(sessions)) return;
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId ? { ...task, pomodorosLogged: sessions } : task
      ),
    }));
    queueTaskPush(get, [taskId]);
  },
  deleteTask: (id) => {
    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== id),
      // Clear the focus selection if the active task is being removed.
      activeTaskId: state.activeTaskId === id ? null : state.activeTaskId,
    }));
    if (isSupabaseConfigured) {
      set({ connectionStatus: "connecting" });
      void deleteTaskRemote(id).then(applyPushOutcome);
    }
  },
  reorderTasks: (activeId, overId) => {
    set((state) => {
      if (activeId === overId) return {};
      // Work on a stable, order-sorted copy so positions are deterministic.
      const sorted = [...state.tasks].sort((a, b) => a.order - b.order);
      const from = sorted.findIndex((t) => t.id === activeId);
      const to = sorted.findIndex((t) => t.id === overId);
      if (from === -1 || to === -1) return {};

      const [moved] = sorted.splice(from, 1);
      sorted.splice(to, 0, moved);

      // Re-pack order values to 0..n-1 to keep them contiguous.
      const reindexed = sorted.map((task, index) => ({
        ...task,
        order: index,
      }));
      return { tasks: reindexed };
    });
    // Reordering re-packs every task's `order`, so push them all.
    queueAllTasksPush(get);
  },
  moveTask: (activeId, overId, targetCategory) => {
    set((state) => {
      // Deterministic, order-sorted working copy.
      const sorted = [...state.tasks].sort((a, b) => a.order - b.order);
      const fromIndex = sorted.findIndex((t) => t.id === activeId);
      if (fromIndex === -1) return {};

      const [moved] = sorted.splice(fromIndex, 1);
      const relocated = { ...moved, category: targetCategory };

      // Insert at the hovered card's slot, or append when dropping on the
      // empty area of a column.
      let toIndex = sorted.length;
      if (overId && overId !== activeId) {
        const overIndex = sorted.findIndex((t) => t.id === overId);
        if (overIndex !== -1) toIndex = overIndex;
      }
      sorted.splice(toIndex, 0, relocated);

      return { tasks: sorted.map((task, index) => ({ ...task, order: index })) };
    });
    // Re-packs every task's `order` (and changes one category), so push all.
    queueAllTasksPush(get);
  },
  addCategory: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    let changed = false;
    set((state) => {
      const exists = state.categories.some(
        (c) => c.toLowerCase() === trimmed.toLowerCase()
      );
      if (exists) return {};
      changed = true;
      return { categories: [...state.categories, trimmed] };
    });
    if (changed) pushCategoriesIfCloud(get);
  },
  reorderCategories: (orderedNames) => {
    const unique = [...new Set(orderedNames.filter(Boolean))];
    set({ categories: unique });
    pushCategoriesIfCloud(get);
  },
  renameCategory: (oldName, newName) => {
    const trimmed = newName.trim();
    if (!trimmed || oldName === "General") return;
    let changed = false;
    set((state) => {
      if (!state.categories.includes(oldName)) return {};
      // Block renames that would collide with another existing column.
      if (
        trimmed !== oldName &&
        state.categories.some(
          (c) => c.toLowerCase() === trimmed.toLowerCase()
        )
      ) {
        return {};
      }
      changed = true;
      return {
        categories: state.categories.map((c) => (c === oldName ? trimmed : c)),
        tasks: state.tasks.map((task) =>
          task.category === oldName ? { ...task, category: trimmed } : task
        ),
      };
    });
    if (changed) {
      pushCategoriesIfCloud(get);
      queueAllTasksPush(get);
    }
  },
  deleteCategory: (name) => {
    if (name === "General") return;
    let changed = false;
    set((state) => {
      if (!state.categories.includes(name)) return {};
      changed = true;
      return {
        categories: state.categories.filter((c) => c !== name),
        // Reassign orphaned tasks to General so nothing is lost.
        tasks: state.tasks.map((task) =>
          task.category === name ? { ...task, category: "General" } : task
        ),
      };
    });
    if (changed) {
      pushCategoriesIfCloud(get);
      queueAllTasksPush(get);
    }
  },
  completeAndRepeatTask: (taskId) => {
    const target = get().tasks.find((t) => t.id === taskId);
    if (!target) return;

    // Only log a completion the first time it crosses into Done.
    const becameDone = target.status !== "Done";
    const points = taskPoints(target.priority);

    // Recurring tasks stay a SINGLE card (no clones): mark Done and stamp the
    // current calendar period. refreshRecurringTasks reopens it once the period
    // rolls over. One-off tasks just go Done with no stamp.
    const stamp =
      target.recurrence !== "none"
        ? periodKey(target.recurrence, new Date())
        : undefined;

    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status: "Done" as TaskStatus,
              ...(stamp ? { lastCompletedPeriod: stamp } : {}),
            }
          : t
      ),
      history: becameDone
        ? logTaskCompletion(state.history, points, target.lifePillar)
        : state.history,
    }));
    queueTaskPush(get, [taskId]);
  },
  refreshRecurringTasks: () => {
    const now = new Date();
    const reopened: string[] = [];
    set((state) => {
      const tasks = state.tasks.map((task) => {
        if (task.recurrence === "none" || task.status !== "Done") return task;
        // Still inside the period it was completed in — keep it Done/hidden.
        if (task.lastCompletedPeriod === periodKey(task.recurrence, now)) {
          return task;
        }
        // The period has elapsed: reopen a fresh occurrence in place.
        reopened.push(task.id);
        return {
          ...task,
          status: "Not Started" as TaskStatus,
          lastCompletedPeriod: undefined,
          pomodorosLogged: 0,
          progress: task.subtasks.length > 0 ? task.progress : 0,
          deadline: task.deadline
            ? advanceDeadlineToCurrentPeriod(task.deadline, task.recurrence, now)
            : task.deadline,
          subtasks: task.subtasks.map((s) => ({
            ...s,
            status: "todo" as SubtaskStatus,
          })),
        };
      });
      return reopened.length > 0 ? { tasks } : {};
    });
    if (reopened.length > 0) queueTaskPush(get, reopened);
  },
  ensureDailyPlan: () => {
    const today = todayKey();
    const { dailyPlan, pendingReview, tasks } = get();

    // Already planned for today — nothing to roll over.
    if (dailyPlan && dailyPlan.date === today) return;

    // Rolling into a new day: capture the previous plan's unfinished focus
    // tasks (auto + manual) as a one-time review, unless one's already pending.
    let nextReview = pendingReview;
    if (dailyPlan && dailyPlan.date < today && pendingReview === null) {
      const byId = new Map(tasks.map((t) => [t.id, t] as const));
      const prevIds = [
        ...dailyPlan.mainTaskIds,
        ...(dailyPlan.manualTaskIds ?? []),
      ];
      const seen = new Set<string>();
      const missed = prevIds.filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        const t = byId.get(id);
        return t != null && t.status !== "Done";
      });
      if (missed.length > 0) {
        nextReview = { date: dailyPlan.date, taskIds: missed };
      }
    }

    // Snapshot the current workspace focus marks so tomorrow's rollover can
    // tell which of today's focus tasks went unfinished. A fresh day starts
    // with an empty manual focus list.
    const focusSnapshot = tasks.filter((t) => t.isToday).map((t) => t.id);
    set({
      dailyPlan: { date: today, mainTaskIds: focusSnapshot, manualTaskIds: [] },
      pendingReview: nextReview,
    });
    pushDailyPlanIfCloud(get);
  },
  dismissReview: () => {
    set({ pendingReview: null });
    pushDailyPlanIfCloud(get);
  },
  planMoveToToday: (taskId) => {
    set((state) => {
      const today = todayKey();
      const plan = state.dailyPlan ?? {
        date: today,
        mainTaskIds: [],
        manualTaskIds: [],
      };
      const manual = plan.manualTaskIds ?? [];
      const manualTaskIds = manual.includes(taskId)
        ? manual
        : [...manual, taskId];
      const review = state.pendingReview
        ? state.pendingReview.taskIds.filter((id) => id !== taskId)
        : [];
      return {
        dailyPlan: { date: today, mainTaskIds: plan.mainTaskIds, manualTaskIds },
        pendingReview:
          review.length > 0 ? { ...state.pendingReview!, taskIds: review } : null,
      };
    });
    pushDailyPlanIfCloud(get);
  },
  planRemoveFromToday: (taskId) => {
    // The focus list mirrors the workspace isToday mark, so removing a focus
    // task means clearing that mark; also drop it from the manual list.
    get().updateTask(taskId, { isToday: false });
    set((state) => {
      const today = todayKey();
      const plan = state.dailyPlan ?? {
        date: today,
        mainTaskIds: [],
        manualTaskIds: [],
      };
      return {
        dailyPlan: {
          date: today,
          mainTaskIds: plan.mainTaskIds.filter((id) => id !== taskId),
          manualTaskIds: (plan.manualTaskIds ?? []).filter((id) => id !== taskId),
        },
      };
    });
    pushDailyPlanIfCloud(get);
  },
  clearManualFocus: () => {
    // "Clear for the day" = mark every still-open manual-focus task complete.
    const plan = get().dailyPlan;
    const ids = (plan?.manualTaskIds ?? []).filter((id) => {
      const t = get().tasks.find((task) => task.id === id);
      return t != null && t.status !== "Done";
    });
    for (const id of ids) get().completeAndRepeatTask(id);
    pushDailyPlanIfCloud(get);
  },
  planCompleteTask: (taskId) => {
    // Reuse the unified completion path (handles recurring stamping too).
    get().completeAndRepeatTask(taskId);
    set((state) => {
      if (!state.pendingReview) return {};
      const taskIds = state.pendingReview.taskIds.filter((id) => id !== taskId);
      return {
        pendingReview: taskIds.length > 0 ? { ...state.pendingReview, taskIds } : null,
      };
    });
    pushDailyPlanIfCloud(get);
  },
  addSubtask: (taskId, title, level) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              subtasks: [
                ...task.subtasks,
                {
                  id: `subtask-${crypto.randomUUID()}`,
                  title: trimmed,
                  status: "todo" as SubtaskStatus,
                  level,
                },
              ],
            }
          : task
      ),
    }));
    queueTaskPush(get, [taskId]);
  },
  insertSubtaskAfter: (taskId, afterSubtaskId, level) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return null;
    const index = task.subtasks.findIndex((s) => s.id === afterSubtaskId);
    if (index === -1) return null;

    const newId = `subtask-${crypto.randomUUID()}`;
    const newSubtask: Subtask = {
      id: newId,
      title: "",
      status: "todo" as SubtaskStatus,
      level,
    };
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              subtasks: [
                ...t.subtasks.slice(0, index + 1),
                newSubtask,
                ...t.subtasks.slice(index + 1),
              ],
            }
          : t
      ),
    }));
    queueTaskPush(get, [taskId]);
    return newId;
  },
  updateSubtask: (taskId, subtaskId, updates) => {
    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (task.id !== taskId) return task;
        // Micro-task edits only update the progress roll-up — they never flip
        // the parent task to Done. The task is completed solely by an explicit
        // user action on the card itself.
        return {
          ...task,
          subtasks: task.subtasks.map((subtask) =>
            subtask.id === subtaskId ? { ...subtask, ...updates } : subtask
          ),
        };
      }),
    }));
    queueTaskPush(get, [taskId]);
  },
  deleteSubtask: (taskId, subtaskId) => {
    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (task.id !== taskId) return task;
        const index = task.subtasks.findIndex((s) => s.id === subtaskId);
        if (index === -1) return task;
        // Drop the target plus any contiguous deeper rows that follow it —
        // those are its children in the outline-derived hierarchy.
        const targetLevel = SUBTASK_LEVEL_NUM[task.subtasks[index].level];
        let end = index + 1;
        while (
          end < task.subtasks.length &&
          SUBTASK_LEVEL_NUM[task.subtasks[end].level] > targetLevel
        ) {
          end += 1;
        }
        return {
          ...task,
          subtasks: [
            ...task.subtasks.slice(0, index),
            ...task.subtasks.slice(end),
          ],
        };
      }),
    }));
    queueTaskPush(get, [taskId]);
  },
  reorderSubtasks: (taskId, activeId, overId) => {
    if (activeId === overId) return;
    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (task.id !== taskId) return task;
        const from = task.subtasks.findIndex((s) => s.id === activeId);
        const to = task.subtasks.findIndex((s) => s.id === overId);
        if (from === -1 || to === -1) return task;
        const next = [...task.subtasks];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return { ...task, subtasks: next };
      }),
    }));
    queueTaskPush(get, [taskId]);
  },
  toggleSubtaskComplete: (taskId, subtaskId) => {
    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (task.id !== taskId) return task;
        const index = task.subtasks.findIndex((s) => s.id === subtaskId);
        if (index === -1) return task;
        // Flip the row, then apply the same state to its descendant block (the
        // contiguous deeper rows) so a parent checkbox completes its children.
        const nextStatus: SubtaskStatus =
          task.subtasks[index].status === "done" ? "todo" : "done";
        const targetLevel = SUBTASK_LEVEL_NUM[task.subtasks[index].level];
        let end = index + 1;
        while (
          end < task.subtasks.length &&
          SUBTASK_LEVEL_NUM[task.subtasks[end].level] > targetLevel
        ) {
          end += 1;
        }
        // Roll-up only: completing micro-tasks never auto-completes the parent
        // task — the user marks the card Done themselves once L1/L2/L3 are done.
        return {
          ...task,
          subtasks: task.subtasks.map((s, i) =>
            i >= index && i < end ? { ...s, status: nextStatus } : s
          ),
        };
      }),
    }));
    queueTaskPush(get, [taskId]);
  },
  toggleSubtaskCancelled: (taskId, subtaskId) => {
    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (task.id !== taskId) return task;
        const index = task.subtasks.findIndex((s) => s.id === subtaskId);
        if (index === -1) return task;
        // Cross out the row, then apply the same state to its descendant block so
        // cancelling a parent crosses out everything beneath it.
        const nextStatus: SubtaskStatus =
          task.subtasks[index].status === "cancelled" ? "todo" : "cancelled";
        const targetLevel = SUBTASK_LEVEL_NUM[task.subtasks[index].level];
        let end = index + 1;
        while (
          end < task.subtasks.length &&
          SUBTASK_LEVEL_NUM[task.subtasks[end].level] > targetLevel
        ) {
          end += 1;
        }
        // Roll-up only: cancelling micro-tasks never auto-completes the parent
        // task — completion stays an explicit action on the card.
        return {
          ...task,
          subtasks: task.subtasks.map((s, i) =>
            i >= index && i < end ? { ...s, status: nextStatus } : s
          ),
        };
      }),
    }));
    queueTaskPush(get, [taskId]);
  },
  addGoal: (goal) => {
    set((state) => {
      const maxOrder = state.goals.reduce((max, g) => Math.max(max, g.order), -1);
      return {
        goals: [
          ...state.goals,
          { ...goal, id: `goal-${crypto.randomUUID()}`, order: maxOrder + 1 },
        ],
      };
    });
  },
  updateGoal: (id, updates) => {
    set((state) => ({
      goals: state.goals.map((g) => (g.id === id ? { ...g, ...updates } : g)),
    }));
  },
  deleteGoal: (id) => {
    set((state) => ({
      goals: state.goals.filter((g) => g.id !== id),
      // Un-link any tasks that were pointing at the deleted goal so no task
      // ends up referencing a ghost goalId.
      tasks: state.tasks.map((t) =>
        t.goalId === id ? { ...t, goalId: undefined } : t
      ),
    }));
  },

  setFlashcards: (flashcards) => set({ flashcards }),
  setActiveTask: (id) => set({ activeTaskId: id }),

  hydrate: async () => {
    if (!isSupabaseConfigured || get().isHydrated) {
      set({ isHydrated: true });
      return;
    }
    set({ isSyncing: true, connectionStatus: "connecting" });
    try {
      // ensureUserRow() is intentionally NOT called here.
      // It runs inside CloudSyncProvider's onAuthStateChange handler, which
      // fires only after Supabase has confirmed a valid session — eliminating
      // the startup race where the access token may not yet be ready.
      const cloudTasks = await pullTasks();
      if (cloudTasks === null) {
        // Read failed (offline, signed out, or timeout) — stay on local state
        // but mark hydrated so the UI loads, and flag the disconnect.
        set({ connectionStatus: "offline" });
        return;
      }
      if (cloudTasks.length > 0) {
        // Cloud is the source of truth on subsequent devices/sessions.
        set({ tasks: cloudTasks });
      } else if (get().tasks.length > 0) {
        // First run with local tasks: seed the cloud. If this fails (e.g.
        // users FK row not yet created), surface the real reason — a network
        // drop shows "offline", an auth/schema rejection shows "error" — so we
        // never display a false "Synced" nor a false "Offline".
        const outcome = await pushTasks(get().tasks);
        if (!outcome.ok) {
          applyPushOutcome(outcome);
          return;
        }
      }

      // Managed category list: adopt the cloud copy, or seed it on first run.
      const cloudCategories = await pullCategories();
      if (cloudCategories === null) {
        // Read failed — keep the local list.
      } else if (cloudCategories.length > 0) {
        set({ categories: cloudCategories });
      } else {
        const seeded = deriveCategories(get().tasks);
        set({ categories: seeded });
        await pushCategories(seeded);
      }

      // Daily plan + pending review: adopt the cloud copy when present so the
      // plan and missed-task review follow the user across devices.
      const cloudPlan = await pullDailyPlan();
      if (cloudPlan) {
        set({
          dailyPlan: cloudPlan.plan ?? get().dailyPlan,
          pendingReview: cloudPlan.review ?? get().pendingReview,
        });
      }
      set({ connectionStatus: "synced" });
    } catch (error) {
      console.error("[cadence] hydrate failed", error);
      set({ connectionStatus: "offline" });
    } finally {
      set({ isHydrated: true, isSyncing: false });
    }
  },

  forceSync: async () => {
    // Purely local install — there's no cloud to refresh against.
    if (!isSupabaseConfigured) {
      set({ connectionStatus: "offline" });
      return;
    }
    // Skip if a sync (initial hydrate or another refresh) is already running.
    if (get().isSyncing) return;
    set({ isSyncing: true, connectionStatus: "connecting" });
    try {
      // Flush any debounced task edits first so local changes reach the cloud
      // before we overwrite local state with the pulled cloud copy.
      if (pushTimer !== null) {
        clearTimeout(pushTimer);
        pushTimer = null;
        const ids = new Set(pendingTaskIds);
        pendingTaskIds.clear();
        const pending = get().tasks.filter((t) => ids.has(t.id));
        if (pending.length > 0) {
          const outcome = await pushTasks(pending);
          if (!outcome.ok) {
            applyPushOutcome(outcome);
            return;
          }
        }
      }

      await ensureUserRow();
      const cloudTasks = await pullTasks();
      if (cloudTasks === null) {
        // Read failed/timed out — keep local data, report the disconnect.
        set({ connectionStatus: "offline" });
        return;
      }
      if (cloudTasks.length > 0) {
        // Adopt the cloud copy (persist middleware writes it to localStorage).
        set({ tasks: cloudTasks });
      } else if (get().tasks.length > 0) {
        // Cloud is empty — seed it from local so nothing is lost.
        const outcome = await pushTasks(get().tasks);
        if (!outcome.ok) {
          applyPushOutcome(outcome);
          return;
        }
      }
      const cloudCategories = await pullCategories();
      if (cloudCategories && cloudCategories.length > 0) {
        set({ categories: cloudCategories });
      }
      const cloudPlan = await pullDailyPlan();
      if (cloudPlan) {
        set({
          dailyPlan: cloudPlan.plan ?? get().dailyPlan,
          pendingReview: cloudPlan.review ?? get().pendingReview,
        });
      }
      set({ connectionStatus: "synced" });
    } catch (error) {
      console.error("[cadence] forceSync failed", error);
      set({ connectionStatus: "offline" });
    } finally {
      set({ isSyncing: false });
    }
  },

  startTimer: () => {
    // Guard: never run a depleted timer.
    if (get().timeLeft <= 0) return;
    set({ isRunning: true });
  },

  pauseTimer: () => set({ isRunning: false }),

  resetTimer: () =>
    set((state) => ({
      isRunning: false,
      timeLeft: TIMER_DURATIONS[state.mode],
    })),

  switchMode: (mode) => {
    // Guard against an invalid mode being passed in.
    if (!TIMER_MODES.includes(mode)) return;
    set({
      mode,
      timeLeft: TIMER_DURATIONS[mode],
      isRunning: false,
    });
  },

  tick: () => {
    const { timeLeft, isRunning } = get();
    if (!isRunning) return;
    if (timeLeft <= 1) {
      get().completeSession();
      return;
    }
    set({ timeLeft: timeLeft - 1 });
  },

  completeSession: () => {
    const creditedTaskId = get().mode === "focus" ? get().activeTaskId : null;
    set((state) => {
      const completedMode = state.mode;
      const wasFocus = completedMode === "focus";

      const sessionsCompleted = wasFocus
        ? state.sessionsCompleted + 1
        : state.sessionsCompleted;

      // Credit the active task with a pomodoro on a completed focus session.
      const tasks =
        wasFocus && state.activeTaskId
          ? state.tasks.map((task) =>
              task.id === state.activeTaskId
                ? { ...task, pomodorosLogged: task.pomodorosLogged + 1 }
                : task
            )
          : state.tasks;

      const nextMode = getNextMode(completedMode, sessionsCompleted);

      return {
        tasks,
        sessionsCompleted,
        mode: nextMode,
        timeLeft: TIMER_DURATIONS[nextMode],
        isRunning: false,
        completions: state.completions + 1,
        // A completed focus session counts toward today's consistency log.
        history: wasFocus
          ? bumpHistory(state.history, "sessions")
          : state.history,
      };
    });
    // Persist the freshly credited pomodoro count for the focused task.
    if (creditedTaskId) queueTaskPush(get, [creditedTaskId]);
  },
    }),
    {
      name: "cadence-store",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // The first client render must match the server's (seed) render, so we
      // skip automatic rehydration and trigger it manually in CloudSyncProvider
      // after mount — the cloud layer (when configured) then takes over.
      skipHydration: true,
      // Persist only user-authored data; timer + sync flags stay transient.
      partialize: (state) => ({
        tasks: state.tasks,
        categories: state.categories,
        goals: state.goals,
        flashcards: state.flashcards,
        activeTaskId: state.activeTaskId,
        history: state.history,
        dailyPlan: state.dailyPlan,
        pendingReview: state.pendingReview,
      }),
    }
  )
);
