import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  addDays,
  addMonths,
  addWeeks,
  format,
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
  pullTasks,
  pushCategories,
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

/** How often a task repeats. 'none' is a one-off task. */
export type Recurrence =
  | "none"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly";

/** Nesting depth of a subtask: L1 (direct child), L2 (grandchild), or L3 (great-grandchild). */
export type SubtaskLevel = "L1" | "L2" | "L3";

export type SubtaskStatus = "todo" | "done";

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

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Due date stored as a yyyy-MM-dd string ("" when unset). */
  deadline: string;
  /** Free-form grouping label. Defaults to "General". */
  category: string;
  /** Optional second-level grouping within a category ("" when unset). */
  subcategory: string;
  /** Repeat interval driving completeAndRepeatTask. */
  recurrence: Recurrence;
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
  return Math.max(
    subtask.status === "done" ? 100 : 0,
    clampPercent(subtask.percent ?? 0)
  );
}

/**
 * Derive each micro-task's completion percent from the flat, outline-ordered
 * subtask list. A row's direct children are the contiguous following rows
 * exactly one level deeper (until a row at the same or shallower level closes
 * the block). Leaf rows use their own stored `percent`; parents average their
 * direct children (recursively). This is the L1/L2/L3 roll-up where an L2
 * aggregates its L3s and an L1 aggregates its L2s.
 */
export function computeSubtaskRollups(
  subtasks: Subtask[]
): Record<string, SubtaskRollup> {
  const n = subtasks.length;
  const level = subtasks.map((s) => SUBTASK_LEVEL_NUM[s.level]);

  const directChildren = (i: number): number[] => {
    const out: number[] = [];
    for (let j = i + 1; j < n; j++) {
      if (level[j] <= level[i]) break; // block closed by a same/shallower row
      if (level[j] === level[i] + 1) out.push(j);
    }
    return out;
  };

  const memo = new Array<number | null>(n).fill(null);
  const value = (i: number): number => {
    const cached = memo[i];
    if (cached !== null) return cached;
    const kids = directChildren(i);
    const result =
      kids.length === 0
        ? leafPercent(subtasks[i])
        : Math.round(kids.reduce((sum, j) => sum + value(j), 0) / kids.length);
    memo[i] = result;
    return result;
  };

  const out: Record<string, SubtaskRollup> = {};
  for (let i = 0; i < n; i++) {
    out[subtasks[i].id] = {
      percent: value(i),
      editable: directChildren(i).length === 0,
    };
  }
  return out;
}

/**
 * Overall task completion: the average of its shallowest-level micro-tasks
 * (the L1s when present), each already rolled up from its descendants. Returns
 * 0 when the task has no micro-tasks.
 */
export function computeTaskProgress(subtasks: Subtask[]): number {
  if (subtasks.length === 0) return 0;
  const rollups = computeSubtaskRollups(subtasks);
  const minLevel = Math.min(...subtasks.map((s) => SUBTASK_LEVEL_NUM[s.level]));
  const roots = subtasks.filter(
    (s) => SUBTASK_LEVEL_NUM[s.level] === minLevel
  );
  return Math.round(
    roots.reduce((sum, s) => sum + rollups[s.id].percent, 0) / roots.length
  );
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
 * Mirrors a task's status to its micro-task roll-up: when children exist and
 * average a full 100%, the task flips to Done so its status matches its bar.
 * Only auto-completes non-recurring tasks (recurring ones must go through
 * completeAndRepeatTask so the next occurrence is spawned) and never
 * auto-reopens — walking a task back stays a deliberate user action.
 */
function syncStatusToProgress(task: Task): Task {
  if (
    task.recurrence === "none" &&
    task.status !== "Done" &&
    task.subtasks.length > 0 &&
    computeTaskProgress(task.subtasks) >= 100
  ) {
    return { ...task, status: "Done" };
  }
  return task;
}

/**
 * Card fraction badge data: how many L3 action tasks are fully complete out of
 * the total number of L3 tasks. A leaf is "complete" at 100% (which includes a
 * checked-off row). Returns { done: 0, total: 0 } when the task has no L3s — the
 * caller decides what to show in that case.
 */
export function computeL3Fraction(subtasks: Subtask[]): {
  done: number;
  total: number;
} {
  const l3 = subtasks.filter((s) => s.level === "L3");
  const done = l3.filter((s) => leafPercent(s) >= 100).length;
  return { done, total: l3.length };
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
  field: keyof DayActivity
): Record<string, DayActivity> {
  const key = format(new Date(), "yyyy-MM-dd");
  const prev = history[key] ?? { sessions: 0, tasksDone: 0, points: 0 };
  return { ...history, [key]: { ...prev, [field]: (prev[field] ?? 0) + 1 } };
}

/**
 * Record a completed task in today's log: bumps the task count by one and adds
 * its weighted effort points. Both feed the Daily Goal and streak.
 */
function logTaskCompletion(
  history: Record<string, DayActivity>,
  points: number
): Record<string, DayActivity> {
  const key = format(new Date(), "yyyy-MM-dd");
  const prev = history[key] ?? { sessions: 0, tasksDone: 0, points: 0 };
  return {
    ...history,
    [key]: {
      ...prev,
      tasksDone: prev.tasksDone + 1,
      points: (prev.points ?? 0) + points,
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
  flashcards: Flashcard[];
  activeTaskId: string | null;
  /** Daily productivity log keyed by local `yyyy-MM-dd` — powers the streak. */
  history: Record<string, DayActivity>;

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
   * Marks a task Done and, when it recurs, appends a fresh copy whose deadline
   * is advanced by one recurrence interval (via date-fns).
   */
  completeAndRepeatTask: (taskId: string) => void;
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

/**
 * Advance a yyyy-MM-dd deadline by one recurrence interval. Falls back to today
 * as the base when the stored deadline is missing/unparseable. Only meaningful
 * for recurring tasks — never called with "none".
 */
function nextDeadline(deadline: string, recurrence: Recurrence): string {
  const base = isValid(parseISO(deadline)) ? parseISO(deadline) : new Date();
  const advanced =
    recurrence === "daily"
      ? addDays(base, 1)
      : recurrence === "weekly"
        ? addWeeks(base, 1)
        : recurrence === "quarterly"
          ? addMonths(base, 3)
          : addMonths(base, 1);
  return format(advanced, "yyyy-MM-dd");
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

export const useProdStore = create<ProdState>()(
  persist(
    (set, get) => ({
  tasks: initialTasks,
  categories: initialCategories,
  flashcards: [],
  activeTaskId: null,
  history: {},

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
          ? logTaskCompletion(state.history, points)
          : state.history,
      };
    });
    queueTaskPush(get, [id]);
  },
  escalatePriority: (id) => get().updateTask(id, { priority: "High" }),
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

    // A one-off task simply completes — nothing to repeat.
    if (target.recurrence === "none") {
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId ? { ...t, status: "Done" as TaskStatus } : t
        ),
        history: becameDone
          ? logTaskCompletion(state.history, points)
          : state.history,
      }));
      queueTaskPush(get, [taskId]);
      return;
    }

    // Recurring: mark this occurrence Done and append a fresh copy with the
    // deadline advanced by one interval.
    const newId = `task-${crypto.randomUUID()}`;
    set((state) => {
      const maxOrder = state.tasks.reduce((max, t) => Math.max(max, t.order), -1);
      const repeated: Task = {
        ...target,
        id: newId,
        status: "Not Started",
        pomodorosLogged: 0,
        order: maxOrder + 1,
        deadline: nextDeadline(target.deadline, target.recurrence),
        // Fresh copies of the micro-tasks, reset to to-do.
        subtasks: target.subtasks.map((s) => ({
          ...s,
          id: `subtask-${crypto.randomUUID()}`,
          status: "todo" as SubtaskStatus,
        })),
      };
      return {
        tasks: [
          ...state.tasks.map((t) =>
            t.id === taskId ? { ...t, status: "Done" as TaskStatus } : t
          ),
          repeated,
        ],
        history: becameDone
          ? logTaskCompletion(state.history, points)
          : state.history,
      };
    });
    queueTaskPush(get, [taskId, newId]);
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
    let becameDone = false;
    let completedPoints = 0;
    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (task.id !== taskId) return task;
        const updated: Task = {
          ...task,
          subtasks: task.subtasks.map((subtask) =>
            subtask.id === subtaskId ? { ...subtask, ...updates } : subtask
          ),
        };
        // A change that pushes the roll-up to 100% auto-completes the task.
        const synced = syncStatusToProgress(updated);
        if (synced.status === "Done" && task.status !== "Done") {
          becameDone = true;
          completedPoints = taskPoints(task.priority);
        }
        return synced;
      }),
      history: becameDone
        ? logTaskCompletion(state.history, completedPoints)
        : state.history,
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
    let becameDone = false;
    let completedPoints = 0;
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
        const updated: Task = {
          ...task,
          subtasks: task.subtasks.map((s, i) =>
            i >= index && i < end ? { ...s, status: nextStatus } : s
          ),
        };
        // Completing the last micro-tasks rolls the parent up to Done.
        const synced = syncStatusToProgress(updated);
        if (synced.status === "Done" && task.status !== "Done") {
          becameDone = true;
          completedPoints = taskPoints(task.priority);
        }
        return synced;
      }),
      history: becameDone
        ? logTaskCompletion(state.history, completedPoints)
        : state.history,
    }));
    queueTaskPush(get, [taskId]);
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
        flashcards: state.flashcards,
        activeTaskId: state.activeTaskId,
        history: state.history,
      }),
    }
  )
);
