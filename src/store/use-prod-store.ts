import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { addDays, addMonths, addWeeks, format, isValid, parseISO } from "date-fns";

import {
  deleteTaskRemote,
  ensureUserRow,
  isSupabaseConfigured,
  pullCategories,
  pullTasks,
  pushCategories,
  pushTasks,
} from "./cloud-sync";

export const TASK_STATUSES = [
  "Working on it",
  "Stuck",
  "Done",
  "Not Started",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type TaskPriority = "Low" | "Medium" | "High" | "Critical";

/** How often a task repeats. 'none' is a one-off task. */
export type Recurrence = "none" | "daily" | "weekly" | "monthly";

/** Nesting depth of a subtask: L1 (direct child), L2 (grandchild), or L3 (great-grandchild). */
export type SubtaskLevel = "L1" | "L2" | "L3";

export type SubtaskStatus = "todo" | "done";

export interface Subtask {
  id: string;
  title: string;
  status: SubtaskStatus;
  level: SubtaskLevel;
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
  subtasks: Subtask[];
}

export interface Flashcard {
  question: string;
  answer: string;
}

/**
 * Cloud connection state surfaced by the UI status dot:
 *  - "synced"     — last cloud round-trip succeeded.
 *  - "connecting" — a pull/push is in flight.
 *  - "offline"    — cloud disabled, signed out, or the last request failed.
 */
export type ConnectionStatus = "synced" | "connecting" | "offline";

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

  // Cloud sync
  /** Whether Supabase credentials are present and cloud sync is active. */
  cloudEnabled: boolean;
  /** True once the initial cloud pull (or local fallback) has completed. */
  isHydrated: boolean;
  /** True while a pull/push round-trip is in flight. */
  isSyncing: boolean;
  /** Tri-state cloud connection status driving the header status dot. */
  connectionStatus: ConnectionStatus;

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
    void pushTasks(tasks).then((ok) =>
      useProdStore.setState({ connectionStatus: ok ? "synced" : "offline" })
    );
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

  cloudEnabled: isSupabaseConfigured,
  isHydrated: false,
  isSyncing: false,
  // Start "connecting" when cloud is on (hydrate runs at mount); otherwise the
  // app is purely local, which we surface as "offline" (on-device data).
  connectionStatus: isSupabaseConfigured ? "connecting" : "offline",

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
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? { ...task, ...updates } : task
      ),
    }));
    queueTaskPush(get, [id]);
  },
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
      void deleteTaskRemote(id).then((ok) =>
        set({ connectionStatus: ok ? "synced" : "offline" })
      );
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

    // A one-off task simply completes — nothing to repeat.
    if (target.recurrence === "none") {
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId ? { ...t, status: "Done" as TaskStatus } : t
        ),
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
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              subtasks: task.subtasks.map((subtask) =>
                subtask.id === subtaskId
                  ? { ...subtask, ...updates }
                  : subtask
              ),
            }
          : task
      ),
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
      await ensureUserRow();
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
      } else {
        // First run: seed the cloud with whatever is currently local.
        await pushTasks(get().tasks);
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
      } else {
        // Cloud is empty — seed it from local so nothing is lost.
        await pushTasks(get().tasks);
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
      }),
    }
  )
);
