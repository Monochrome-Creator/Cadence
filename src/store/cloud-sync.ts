/* -------------------------------------------------------------------------- */
/*                     Cloud sync layer (Supabase <-> store)                  */
/* -------------------------------------------------------------------------- */
/**
 * Thin persistence layer that translates between the Zustand `Task`/`Subtask`
 * shapes and the Supabase tables defined in `supabase/schema.sql`. Every helper
 * is a no-op (resolves to a safe default) when Supabase is not configured or no
 * user is signed in, so the app keeps working as a purely local store.
 *
 * Identity comes from the Supabase Auth session — `user_id` is always the
 * logged-in user's `auth.uid()`, which is what the RLS policies enforce.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient, isSupabaseConfigured } from "@/utils/supabase/client";
import type {
  Recurrence,
  Subtask,
  SubtaskLevel,
  SubtaskStatus,
  Task,
  TaskPriority,
  TaskStatus,
} from "./use-prod-store";

type TaskRow = {
  id: string;
  user_id: string;
  title: string;
  status: string;
  priority: string;
  deadline: string;
  category: string;
  subcategory: string;
  recurrence: string;
  pomodoros_logged: number;
  task_order: number;
};

type SubtaskRow = {
  id: string;
  task_id: string;
  title: string;
  status: string;
  level: string;
  subtask_order: number;
};

export { isSupabaseConfigured };

/* ------------------------------- auth helper ----------------------------- */

/** The signed-in user's id, or `null` when not authenticated. */
async function getUserId(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/* ----------------------------- row <-> model ----------------------------- */

function taskToRow(task: Task, userId: string): TaskRow {
  return {
    id: task.id,
    user_id: userId,
    title: task.title,
    status: task.status,
    priority: task.priority,
    deadline: task.deadline,
    category: task.category,
    subcategory: task.subcategory,
    recurrence: task.recurrence,
    pomodoros_logged: task.pomodorosLogged,
    task_order: task.order,
  };
}

function subtaskToRow(subtask: Subtask, taskId: string, index: number): SubtaskRow {
  return {
    id: subtask.id,
    task_id: taskId,
    title: subtask.title,
    status: subtask.status,
    level: subtask.level,
    // Persist the array position so subtask ordering survives a round-trip.
    subtask_order: index,
  };
}

function rowToTask(row: TaskRow, subtasks: Subtask[]): Task {
  return {
    id: row.id,
    title: row.title,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    deadline: row.deadline,
    category: row.category,
    // Tolerate rows synced before the subcategory column existed.
    subcategory: row.subcategory ?? "",
    recurrence: row.recurrence as Recurrence,
    pomodorosLogged: row.pomodoros_logged,
    order: row.task_order,
    subtasks,
  };
}

function rowToSubtask(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    title: row.title,
    status: row.status as SubtaskStatus,
    level: row.level as SubtaskLevel,
  };
}

/* --------------------------------- pull ---------------------------------- */

/**
 * Pulls all tasks (with nested subtasks) for the signed-in user. Returns `null`
 * when sync is disabled, no user is signed in, or the read fails — callers
 * should keep their local state in that case.
 */
export async function pullTasks(): Promise<Task[] | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  if (!(await getUserId(supabase))) return null;

  // RLS scopes both reads to the current user automatically.
  const [taskRes, subtaskRes] = await Promise.all([
    supabase.from("tasks").select("*").order("task_order", { ascending: true }),
    supabase
      .from("subtasks")
      .select("*")
      .order("subtask_order", { ascending: true }),
  ]);

  if (taskRes.error || subtaskRes.error) {
    console.error(
      "[cadence] cloud pull failed",
      taskRes.error ?? subtaskRes.error
    );
    return null;
  }

  const subtasksByTask = new Map<string, Subtask[]>();
  for (const row of (subtaskRes.data ?? []) as SubtaskRow[]) {
    const list = subtasksByTask.get(row.task_id) ?? [];
    list.push(rowToSubtask(row));
    subtasksByTask.set(row.task_id, list);
  }

  return ((taskRes.data ?? []) as TaskRow[]).map((row) =>
    rowToTask(row, subtasksByTask.get(row.id) ?? [])
  );
}

/* --------------------------------- push ---------------------------------- */

/**
 * Ensures the signed-in user's `users` row exists before writing tasks. The
 * auth trigger normally creates it, but this is a safe belt-and-braces upsert.
 */
export async function ensureUserRow(): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return;
  const { error } = await supabase
    .from("users")
    .upsert({ id: user.id, email: user.email }, { onConflict: "id" });
  if (error) console.error("[cadence] ensure user failed", error);
}

/**
 * Upserts the given tasks and their subtasks to the cloud. Subtasks that no
 * longer exist locally are removed so deletions propagate. Never throws into
 * the UI: returns `true` when the round-trip fully succeeded, `false` when sync
 * is unavailable or any write failed/timed out (so callers can show "offline").
 */
export async function pushTasks(tasks: Task[]): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase || tasks.length === 0) return false;

  try {
    const userId = await getUserId(supabase);
    if (!userId) return false;

    const taskRows = tasks.map((task) => taskToRow(task, userId));
    const { error: taskErr } = await supabase
      .from("tasks")
      .upsert(taskRows, { onConflict: "id" });
    if (taskErr) {
      console.error("[cadence] push tasks failed", taskErr);
      return false;
    }

    let ok = true;

    const subtaskRows = tasks.flatMap((task) =>
      task.subtasks.map((subtask, index) =>
        subtaskToRow(subtask, task.id, index)
      )
    );
    if (subtaskRows.length > 0) {
      const { error: subErr } = await supabase
        .from("subtasks")
        .upsert(subtaskRows, { onConflict: "id" });
      if (subErr) {
        console.error("[cadence] push subtasks failed", subErr);
        ok = false;
      }
    }

    // Drop subtasks that were removed locally for the affected tasks.
    const keepIds = new Set(subtaskRows.map((row) => row.id));
    for (const task of tasks) {
      const query = supabase.from("subtasks").delete().eq("task_id", task.id);
      const liveIds = task.subtasks
        .map((s) => s.id)
        .filter((id) => keepIds.has(id));
      const { error: delErr } = liveIds.length
        ? await query.not("id", "in", `(${liveIds.join(",")})`)
        : await query;
      if (delErr) {
        console.error("[cadence] prune subtasks failed", delErr);
        ok = false;
      }
    }

    return ok;
  } catch (error) {
    // Network failure / timeout — fail soft so the UI can show "offline".
    console.error("[cadence] push tasks threw", error);
    return false;
  }
}

/* ------------------------------ categories ------------------------------- */

/**
 * Pulls the user's managed category list. Returns `null` when sync is off, no
 * user is signed in, or the read fails — callers keep their local list then.
 */
export async function pullCategories(): Promise<string[] | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const userId = await getUserId(supabase);
  if (!userId) return null;
  const { data, error } = await supabase
    .from("users")
    .select("categories")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("[cadence] pull categories failed", error);
    return null;
  }
  return ((data?.categories as string[] | null) ?? []);
}

/** Persists the user's managed (ordered) category list. Fire-and-forget. */
export async function pushCategories(categories: string[]): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const userId = await getUserId(supabase);
  if (!userId) return;
  const { error } = await supabase
    .from("users")
    .update({ categories })
    .eq("id", userId);
  if (error) console.error("[cadence] push categories failed", error);
}

/**
 * Deletes a task (subtasks cascade via the FK) from the cloud. Returns `true`
 * on success, `false` when sync is off or the delete failed/timed out.
 */
export async function deleteTaskRemote(taskId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  try {
    const { error } = await supabase.from("tasks").delete().eq("id", taskId);
    if (error) {
      console.error("[cadence] delete task failed", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[cadence] delete task threw", error);
    return false;
  }
}

/** Replaces the entire remote task set for this user (used when seeding). */
export async function replaceAllTasks(tasks: Task[]): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  await ensureUserRow();
  await pushTasks(tasks);
}
