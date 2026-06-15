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
  Flashcard,
  Goal,
  LifePillar,
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
  /** Manual completion percent (0–100); null on rows with no override. */
  progress: number | null;
  /** True for "This Evening" after-hours tasks. */
  is_evening: boolean;
  /** True for GTD "Today" Daily Action tasks (promoted to the Dashboard). */
  is_today: boolean;
  /** Four Pillars attribution (Wealth/Health/Career/Personal_IP); null = general. */
  life_pillar: string | null;
  /** Calendar-period key of the last completion for recurring tasks; null otherwise. */
  last_completed_period: string | null;
};

type SubtaskRow = {
  id: string;
  task_id: string;
  title: string;
  status: string;
  level: string;
  subtask_order: number;
  /** Leaf completion percent (0–100); null on parent/legacy rows. */
  percent: number | null;
  /** Optional per-micro-task due date (yyyy-MM-dd); null when unset. */
  deadline: string | null;
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
 * Timeout for all Supabase network calls.
 *
 * Free-tier Postgres instances are paused after inactivity and can take
 * 15–25 s to wake on first hit. 28 s gives the DB enough time to start,
 * process the request, and return — even under heavy server load.
 * Warm queries complete in <500 ms, so the extra headroom costs nothing
 * in the normal case and only matters on cold starts.
 */
const CLOUD_TIMEOUT_MS = 28_000;

/**
 * Mobile networks can leave fetches pending for a long time without rejecting.
 * Settle cloud work promptly so the local-first UI can keep working and report
 * offline mode instead of appearing stuck on "Syncing".
 */
export function withTimeout<T>(operation: PromiseLike<T>, label: string, ms = CLOUD_TIMEOUT_MS): Promise<T> {
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

/* --------------------------- auth-error retry ---------------------------- */

/**
 * True when a failed Supabase call looks like an expired/invalid access token
 * rather than a genuine data error. After a mobile tab sits backgrounded past
 * the ~1h token lifetime, the first write back comes through as a 401 / PostgREST
 * "JWT expired" (PGRST301), and RLS then rejects with 42501 because auth.uid()
 * is null. All three mean "refresh the token and try again", not "data is bad".
 */
function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; status?: number; message?: string };
  if (e.status === 401) return true;
  if (e.code === "PGRST301" || e.code === "42501") return true;
  const msg = (e.message ?? "").toLowerCase();
  return msg.includes("jwt") || msg.includes("expired");
}

/* ------------------------ failure classification ------------------------- */

/** Why a cloud write failed — drives whether the UI shows "offline". */
export type SyncFailureReason = "network" | "auth" | "data" | "unavailable";

/** Structured result of a cloud write so callers can react per failure kind. */
export type SyncOutcome =
  | { ok: true }
  | { ok: false; reason: SyncFailureReason; message?: string };

/**
 * A genuine network drop is the ONLY thing that should put the app in "offline"
 * mode. It surfaces as the browser fetch's `TypeError: Failed to fetch` (or our
 * own "timed out" sentinel from withTimeout). Auth (401/RLS) and schema/data
 * errors come back as real HTTP responses — the device is online, the request
 * was rejected — so they must NOT be treated as offline.
 */
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // "Failed to fetch"
  if (error instanceof Error) {
    const m = error.message.toLowerCase();
    return (
      m.includes("failed to fetch") ||
      m.includes("timed out") ||
      m.includes("networkerror") ||
      m.includes("network request failed")
    );
  }
  return false;
}

/** Buckets any thrown/returned error into a sync-failure reason. */
function classifyError(error: unknown): SyncFailureReason {
  if (isNetworkError(error)) return "network";
  if (isAuthError(error)) return "auth";
  return "data";
}

/** Best human-readable string from a PostgrestError or thrown Error. */
function errorMessage(error: unknown): string {
  const e = error as { message?: string; details?: string; code?: string };
  return e?.message || e?.details || e?.code || "Unknown sync error";
}

/**
 * Logs the *real* Supabase error. PostgrestError's fields are non-enumerable, so
 * a plain `console.error(label, error)` prints `{}` — we pull message/details/
 * hint/code explicitly so the cause (RLS vs auth vs schema) is visible.
 */
function logSupabaseError(label: string, error: unknown): void {
  const e = (error ?? {}) as {
    message?: string;
    details?: string;
    hint?: string;
    code?: string;
    status?: number;
  };
  console.error(`[cadence] ${label} failed`, {
    message: e.message ?? null,
    details: e.details ?? null,
    hint: e.hint ?? null,
    code: e.code ?? null,
    status: e.status ?? null,
  });
}

/**
 * Runs a Supabase write and, if it fails because the token expired, forces one
 * session refresh and retries exactly once. `run` must build a fresh query each
 * call (query builders are single-use). Without this, every mutation after the
 * token lapses fails silently — the UI keeps accepting edits that never persist.
 */
async function withAuthRetry<T extends { error: unknown }>(
  supabase: SupabaseClient,
  run: () => PromiseLike<T>,
  label: string
): Promise<T> {
  const first = await withTimeout(run(), label);
  if (!isAuthError(first.error)) return first;

  // Expired token — force a refresh, then retry the write once.
  const { data, error } = await withTimeout(
    supabase.auth.refreshSession(),
    "refresh session"
  );
  if (error || !data.session) return first; // refresh failed — report original
  setCurrentUser(data.session.user.id, data.session.user.email);
  return withTimeout(run(), `${label} (retry)`);
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
    progress: task.progress ?? null,
    is_evening: task.isEvening ?? false,
    is_today: task.isToday ?? false,
    life_pillar: task.lifePillar ?? null,
    last_completed_period: task.lastCompletedPeriod ?? null,
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
    percent: subtask.percent ?? null,
    deadline: subtask.deadline ?? null,
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
    // Tolerate rows synced before the progress column existed (null/undefined).
    ...(row.progress != null ? { progress: row.progress } : {}),
    // Tolerate rows synced before the is_evening column existed.
    ...(row.is_evening ? { isEvening: true } : {}),
    // Tolerate rows synced before the is_today column existed (null/undefined).
    ...(row.is_today ? { isToday: true } : {}),
    // Tolerate rows synced before the life_pillar column existed (null/undefined).
    ...(row.life_pillar ? { lifePillar: row.life_pillar as LifePillar } : {}),
    // Tolerate rows synced before the last_completed_period column existed.
    ...(row.last_completed_period
      ? { lastCompletedPeriod: row.last_completed_period }
      : {}),
    subtasks,
  };
}

function rowToSubtask(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    title: row.title,
    status: row.status as SubtaskStatus,
    level: row.level as SubtaskLevel,
    // Tolerate rows synced before these columns existed (null/undefined).
    ...(row.percent != null ? { percent: row.percent } : {}),
    ...(row.deadline ? { deadline: row.deadline } : {}),
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

    const { error } = await withAuthRetry(
      supabase,
      () =>
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
export async function pushTasks(tasks: Task[]): Promise<SyncOutcome> {
  const supabase = getSupabaseClient();
  if (!supabase || tasks.length === 0) return { ok: false, reason: "unavailable" };

  try {
    const userId = await getUserId(supabase);
    if (!userId) return { ok: false, reason: "unavailable" };

    const taskRows = tasks.map((task) => taskToRow(task, userId));
    // The first write of the batch carries auth-retry: if the token expired
    // while backgrounded, it refreshes here so the subtask writes below
    // (which reuse the now-fresh token) succeed without their own retry.
    const { error: taskErr } = await withAuthRetry(
      supabase,
      () => supabase.from("tasks").upsert(taskRows, { onConflict: "id" }),
      "push tasks"
    );
    if (taskErr) {
      if (isMissingTable(taskErr)) {
        console.warn("[cadence] tasks table not found —", SCHEMA_HINT);
        return { ok: false, reason: "data", message: `Tables not found. ${SCHEMA_HINT}` };
      }
      logSupabaseError("push tasks", taskErr);
      return {
        ok: false,
        reason: classifyError(taskErr),
        message: errorMessage(taskErr),
      };
    }

    // Track the first non-network failure across subtask writes/prunes so the
    // caller still learns the real reason even though the task row itself saved.
    let failure: SyncOutcome | null = null;

    const subtaskRows = tasks.flatMap((task) =>
      task.subtasks.map((subtask, index) =>
        subtaskToRow(subtask, task.id, index)
      )
    );
    if (subtaskRows.length > 0) {
      const { error: subErr } = await withAuthRetry(
        supabase,
        () => supabase.from("subtasks").upsert(subtaskRows, { onConflict: "id" }),
        "push subtasks"
      );
      if (subErr) {
        if (!isMissingTable(subErr)) logSupabaseError("push subtasks", subErr);
        failure ??= {
          ok: false,
          reason: classifyError(subErr),
          message: errorMessage(subErr),
        };
      }
    }

    // Drop subtasks that were removed locally for the affected tasks.
    const keepIds = new Set(subtaskRows.map((row) => row.id));
    for (const task of tasks) {
      const liveIds = task.subtasks
        .map((s) => s.id)
        .filter((id) => keepIds.has(id));
      // Build a fresh query each attempt (query builders are single-use) so the
      // auth-retry can re-run it after refreshing an expired token.
      const { error: delErr } = await withAuthRetry(
        supabase,
        () => {
          const query = supabase
            .from("subtasks")
            .delete()
            .eq("task_id", task.id);
          return liveIds.length
            ? query.not("id", "in", `(${liveIds.join(",")})`)
            : query;
        },
        "prune subtasks"
      );
      if (delErr) {
        if (!isMissingTable(delErr)) logSupabaseError("prune subtasks", delErr);
        failure ??= {
          ok: false,
          reason: classifyError(delErr),
          message: errorMessage(delErr),
        };
      }
    }

    return failure ?? { ok: true };
  } catch (error) {
    // Thrown (vs returned) error — almost always a network drop/timeout, but
    // classify so a non-network throw isn't mislabelled offline.
    logSupabaseError("push tasks threw", error);
    return {
      ok: false,
      reason: classifyError(error),
      message: errorMessage(error),
    };
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
    const { error } = await withAuthRetry(
      supabase,
      () => supabase.from("users").update({ categories }).eq("id", userId),
      "push categories"
    );
    if (error && !isMissingTable(error)) {
      console.error("[cadence] push categories failed", error);
    }
  } catch (error) {
    console.error("[cadence] push categories threw", error);
  }
}

/* ------------------------------ daily plan ------------------------------- */

/** Shape persisted in `users.daily_plan` (jsonb) — the auto-plan + missed review. */
export type DailyPlanSync = {
  plan: {
    date: string;
    mainTaskIds: string[];
    manualTaskIds?: string[];
  } | null;
  review: { date: string; taskIds: string[] } | null;
};

/**
 * Pulls the user's stored daily plan + pending review. Returns `null` when sync
 * is off, no user is signed in, the column is empty, or the read fails — callers
 * keep their local copy then.
 */
export async function pullDailyPlan(): Promise<DailyPlanSync | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    const userId = await getUserId(supabase);
    if (!userId) return null;
    const { data, error } = await withTimeout(
      supabase.from("users").select("daily_plan").eq("id", userId).maybeSingle(),
      "pull daily plan"
    );
    if (error) {
      if (!isMissingTable(error)) {
        console.error("[cadence] pull daily plan failed", error);
      }
      return null;
    }
    return (data?.daily_plan as DailyPlanSync | null) ?? null;
  } catch (error) {
    console.error("[cadence] pull daily plan threw", error);
    return null;
  }
}

/** Persists the user's daily plan + pending review. Fire-and-forget. */
export async function pushDailyPlan(value: DailyPlanSync): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const userId = await getUserId(supabase);
    if (!userId) return;
    const { error } = await withAuthRetry(
      supabase,
      () => supabase.from("users").update({ daily_plan: value }).eq("id", userId),
      "push daily plan"
    );
    if (error && !isMissingTable(error)) {
      console.error("[cadence] push daily plan failed", error);
    }
  } catch (error) {
    console.error("[cadence] push daily plan threw", error);
  }
}

/* -------------------------------- goals ---------------------------------- */

/**
 * Pulls the user's North Star goals. Returns `null` when sync is off, no user
 * is signed in, the column is empty, or the read fails — callers keep their
 * local copy then.
 */
export async function pullGoals(): Promise<Goal[] | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    const userId = await getUserId(supabase);
    if (!userId) return null;
    const { data, error } = await withTimeout(
      supabase.from("users").select("goals").eq("id", userId).maybeSingle(),
      "pull goals"
    );
    if (error) {
      if (!isMissingTable(error)) {
        console.error("[cadence] pull goals failed", error);
      }
      return null;
    }
    return (data?.goals as Goal[] | null) ?? null;
  } catch (error) {
    console.error("[cadence] pull goals threw", error);
    return null;
  }
}

/** Persists the user's North Star goals. Fire-and-forget. */
export async function pushGoals(goals: Goal[]): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const userId = await getUserId(supabase);
    if (!userId) return;
    const { error } = await withAuthRetry(
      supabase,
      () => supabase.from("users").update({ goals }).eq("id", userId),
      "push goals"
    );
    if (error && !isMissingTable(error)) {
      console.error("[cadence] push goals failed", error);
    }
  } catch (error) {
    console.error("[cadence] push goals threw", error);
  }
}

/* ------------------------------ flashcards ------------------------------- */

/**
 * Pulls the user's flashcards. Returns `null` when sync is off, no user is
 * signed in, the column is empty, or the read fails — callers keep local then.
 */
export async function pullFlashcards(): Promise<Flashcard[] | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    const userId = await getUserId(supabase);
    if (!userId) return null;
    const { data, error } = await withTimeout(
      supabase.from("users").select("flashcards").eq("id", userId).maybeSingle(),
      "pull flashcards"
    );
    if (error) {
      if (!isMissingTable(error)) {
        console.error("[cadence] pull flashcards failed", error);
      }
      return null;
    }
    return (data?.flashcards as Flashcard[] | null) ?? null;
  } catch (error) {
    console.error("[cadence] pull flashcards threw", error);
    return null;
  }
}

/** Persists the user's flashcards. Fire-and-forget. */
export async function pushFlashcards(flashcards: Flashcard[]): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const userId = await getUserId(supabase);
    if (!userId) return;
    const { error } = await withAuthRetry(
      supabase,
      () => supabase.from("users").update({ flashcards }).eq("id", userId),
      "push flashcards"
    );
    if (error && !isMissingTable(error)) {
      console.error("[cadence] push flashcards failed", error);
    }
  } catch (error) {
    console.error("[cadence] push flashcards threw", error);
  }
}

/**
 * Deletes a task (subtasks cascade via the FK) from the cloud. Returns `true`
 * on success, `false` when sync is off or the delete failed/timed out.
 */
export async function deleteTaskRemote(taskId: string): Promise<SyncOutcome> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, reason: "unavailable" };
  try {
    const { error } = await withAuthRetry(
      supabase,
      () => supabase.from("tasks").delete().eq("id", taskId),
      "delete task"
    );
    if (error) {
      if (isMissingTable(error)) {
        return { ok: false, reason: "data", message: `Tables not found. ${SCHEMA_HINT}` };
      }
      logSupabaseError("delete task", error);
      return { ok: false, reason: classifyError(error), message: errorMessage(error) };
    }
    return { ok: true };
  } catch (error) {
    logSupabaseError("delete task threw", error);
    return { ok: false, reason: classifyError(error), message: errorMessage(error) };
  }
}

/** Replaces the entire remote task set for this user (used when seeding). */
export async function replaceAllTasks(tasks: Task[]): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  await ensureUserRow();
  await pushTasks(tasks);
}
