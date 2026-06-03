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

/* --------------------------- cached user identity ------------------------ */

/**
 * Set by CloudSyncProvider from the onAuthStateChange session event.
 * Using the event data directly (rather than calling getSession/getUser inside
 * each data operation) guarantees we always have a valid, non-expired identity
 * without an extra network round-trip or cookie-read timing issue.
 */
let _cachedUserId: string | null = null;
let _cachedUserEmail: string | undefined = undefined;

/** Called by CloudSyncProvider whenever the auth state changes. */
export function setCurrentUser(
  userId: string | null,
  email?: string | null
): void {
  _cachedUserId = userId;
  _cachedUserEmail = email ?? undefined;
}

/* ----------------------------- error helpers ----------------------------- */

/**
 * PostgREST code PGRST205 means the table doesn't exist in the schema cache —
 * i.e. `supabase/schema.sql` has not been applied to this project yet. This is
 * a setup issue, not a runtime bug, so we downgrade it from error to warn and
 * print a clear action for the developer to take.
 */
function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as Record<string, unknown>).code === "PGRST205"
  );
}

const SCHEMA_HINT =
  "Apply supabase/schema.sql via the Supabase dashboard → SQL Editor to create the required tables.";

/**
 * Timeout for all Supabase network calls. 10 s is intentionally generous:
 * free-tier Postgres instances can take 8–10 s to wake from idle (cold start).
 * Subsequent warm queries complete in <500 ms, so the extra headroom costs
 * nothing when the DB is already up.
 */
const CLOUD_TIMEOUT_MS = 10_000;

/**
 * Mobile networks can leave fetches pending for a long time without rejecting.
 * Settle cloud work promptly so the local-first UI can keep working and report
 * offline mode instead of appearing stuck on "Syncing".
 */
function withTimeout<T>(operation: PromiseLike<T>, label: string, ms = CLOUD_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out`)),
      ms
    );
    Promise.resolve(operation).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/* ------------------------------- auth helper ----------------------------- */

/**
 * Returns the signed-in user's id. Prefers the in-process cache set by
 * setCurrentUser() (zero network cost) and falls back to getSession() only
 * when no cached id is available (e.g. a forceSync called before the first
 * auth event). Never hits the Auth API — RLS enforces auth server-side.
 */
async function getUserId(supabase: SupabaseClient): Promise<string | null> {
  if (_cachedUserId) return _cachedUserId;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
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

  try {
    if (!(await getUserId(supabase))) return null;

    // RLS scopes both reads to the current user automatically.
    const [taskRes, subtaskRes] = await Promise.all([
      withTimeout(
        supabase.from("tasks").select("*").order("task_order", { ascending: true }),
        "pull tasks"
      ),
      withTimeout(
        supabase
          .from("subtasks")
          .select("*")
          .order("subtask_order", { ascending: true }),
        "pull subtasks"
      ),
    ]);

    if (taskRes.error || subtaskRes.error) {
      const err = taskRes.error ?? subtaskRes.error;
      if (isMissingTable(err)) {
        console.warn("[cadence] tasks/subtasks tables not found —", SCHEMA_HINT);
      } else {
        console.error("[cadence] cloud pull failed", err);
      }
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
  } catch (error) {
    console.error("[cadence] cloud pull threw", error);
    return null;
  }
}

/* --------------------------------- push ---------------------------------- */

/**
 * Upserts the signed-in user's `public.users` row (the FK anchor for tasks).
 * Prefer calling with explicit `userId`/`email` from the auth event — that
 * avoids any network call. When called without args (e.g. from forceSync) it
 * falls back to the in-process cache and then to getSession().
 *
 * Returns `true` when the row was confirmed. Returns `false` on any failure —
 * callers should NOT proceed to pushTasks when this returns false, because the
 * FK constraint would reject the write with a 23503 error.
 */
export async function ensureUserRow(
  userId?: string,
  email?: string
): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  try {
    // Prefer the explicitly-passed values (cheapest), then the in-process
    // cache set by setCurrentUser(), then fall back to a session lookup.
    let uid = userId ?? _cachedUserId ?? null;
    let userEmail = email ?? _cachedUserEmail;

    if (!uid) {
      const { data, error: authErr } = await withTimeout(
        supabase.auth.getUser(),
        "get user"
      );
      if (authErr || !data.user) return false;
      uid = data.user.id;
      userEmail = data.user.email ?? undefined;
    }

    const { error } = await withTimeout(
      supabase
        .from("users")
        .upsert({ id: uid, email: userEmail }, { onConflict: "id" }),
      "ensure user"
    );
    if (error) {
      if (isMissingTable(error)) {
        console.warn("[cadence] users table not found —", SCHEMA_HINT);
      } else {
        // PostgrestError properties are non-enumerable — serialise explicitly so
        // the real message, code, and details appear in the console.
        console.error(
          "[cadence] ensure user failed",
          JSON.stringify(error, Object.getOwnPropertyNames(error))
        );
      }
      return false;
    }
    return true;
  } catch (error) {
    const isTimeout =
      error instanceof Error && error.message.includes("timed out");
    if (isTimeout) {
      console.warn(
        "[cadence] Cloud sync delayed due to cold start — will retry shortly"
      );
    } else {
      const msg =
        error instanceof Error
          ? error.message
          : JSON.stringify(error, Object.getOwnPropertyNames(error as object));
      console.error("[cadence] ensure user threw", msg);
    }
    return false;
  }
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
    const { error: taskErr } = await withTimeout(
      supabase.from("tasks").upsert(taskRows, { onConflict: "id" }),
      "push tasks"
    );
    if (taskErr) {
      if (isMissingTable(taskErr)) {
        console.warn("[cadence] tasks table not found —", SCHEMA_HINT);
      } else {
        console.error("[cadence] push tasks failed", taskErr);
      }
      return false;
    }

    let ok = true;

    const subtaskRows = tasks.flatMap((task) =>
      task.subtasks.map((subtask, index) =>
        subtaskToRow(subtask, task.id, index)
      )
    );
    if (subtaskRows.length > 0) {
      const { error: subErr } = await withTimeout(
        supabase.from("subtasks").upsert(subtaskRows, { onConflict: "id" }),
        "push subtasks"
      );
      if (subErr) {
        if (!isMissingTable(subErr)) {
          console.error("[cadence] push subtasks failed", subErr);
        }
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
        ? await withTimeout(
            query.not("id", "in", `(${liveIds.join(",")})`),
            "prune subtasks"
          )
        : await withTimeout(query, "prune subtasks");
      if (delErr) {
        if (!isMissingTable(delErr)) {
          console.error("[cadence] prune subtasks failed", delErr);
        }
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
  try {
    const userId = await getUserId(supabase);
    if (!userId) return null;
    const { data, error } = await withTimeout(
      supabase.from("users").select("categories").eq("id", userId).maybeSingle(),
      "pull categories"
    );
    if (error) {
      if (!isMissingTable(error)) {
        console.error("[cadence] pull categories failed", error);
      }
      return null;
    }
    return ((data?.categories as string[] | null) ?? []);
  } catch (error) {
    console.error("[cadence] pull categories threw", error);
    return null;
  }
}

/** Persists the user's managed (ordered) category list. Fire-and-forget. */
export async function pushCategories(categories: string[]): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const userId = await getUserId(supabase);
    if (!userId) return;
    const { error } = await withTimeout(
      supabase.from("users").update({ categories }).eq("id", userId),
      "push categories"
    );
    if (error && !isMissingTable(error)) {
      console.error("[cadence] push categories failed", error);
    }
  } catch (error) {
    console.error("[cadence] push categories threw", error);
  }
}

/**
 * Deletes a task (subtasks cascade via the FK) from the cloud. Returns `true`
 * on success, `false` when sync is off or the delete failed/timed out.
 */
export async function deleteTaskRemote(taskId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  try {
    const { error } = await withTimeout(
      supabase.from("tasks").delete().eq("id", taskId),
      "delete task"
    );
    if (error) {
      if (!isMissingTable(error)) {
        console.error("[cadence] delete task failed", error);
      }
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
