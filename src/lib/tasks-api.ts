/**
 * Shared plumbing for the external Cadence REST API (/api/tasks/*, /api/goals,
 * /api/daily-plan, /api/categories), spec:
 * CADENCE_API_SPEC.md. Server-only. Additive — the app's own sync layer
 * (src/store/cloud-sync.ts) never touches this module.
 *
 * - Auth: `X-API-Key` checked against CADENCE_API_KEYS (comma-separated so a
 *   new key can overlap the old one during rotation). Keys are compared as
 *   SHA-256 digests in constant time and never logged; logs carry a key id
 *   (first 8 hex chars of the digest) instead.
 * - Data access: service-role client scoped to CADENCE_API_USER_ID on every
 *   query (single-user MVP), since there is no user session to drive RLS.
 * - Rate limit: 60 req/min per key via the api_rate_limit_hit() RPC
 *   (supabase/tasks-api.sql), shared across serverless instances.
 * - Logging: one JSON line per request — timestamp, method, endpoint, key id,
 *   status, duration. Never titles or bodies.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const RATE_LIMIT_PER_MIN = 60;

export const TASK_STATUSES = [
  "Not Started",
  "Working on it",
  "On-Going",
  "Stuck",
  "Done",
  "Inbox",
] as const;
export const TASK_PRIORITIES = ["Critical", "High", "Medium", "Low"] as const;
export const LIFE_PILLARS = ["Wealth", "Health", "Career", "Personal_IP"] as const;
export const SUBTASK_STATUSES = ["todo", "done", "cancelled"] as const;
export const SUBTASK_LEVELS = ["L1", "L2", "L3"] as const;
/** Mirrors MAX_TODAY_TASKS in src/store/use-prod-store.ts. */
export const MAX_TODAY_TASKS = 5;

/** Columns selected for every task response. */
export const TASK_SELECT =
  "id, title, status, priority, deadline, category, recurrence, progress, goal_id, life_pillar, is_today, last_completed_period, pomodoros_logged, updated_at, completed_at, subtasks(id, title, status, level, percent, deadline, subtask_order)";

export type SubtaskRow = {
  id: string;
  title: string;
  status: string;
  level: string;
  percent: number | null;
  deadline: string | null;
  subtask_order: number;
};

export type TaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  deadline: string;
  category: string;
  recurrence: string;
  progress: number | null;
  goal_id: string | null;
  life_pillar: string | null;
  is_today: boolean;
  last_completed_period: string | null;
  pomodoros_logged: number;
  updated_at: string;
  completed_at: string | null;
  subtasks: SubtaskRow[] | null;
};

/** DB row → API task. The app stores "no deadline" as ""; the API says null. */
export function toApiTask(row: TaskRow) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    deadline: row.deadline || null,
    category: row.category,
    recurrence: row.recurrence,
    progress: row.progress,
    goal_id: row.goal_id,
    life_pillar: row.life_pillar,
    is_today: row.is_today,
    last_completed_period: row.last_completed_period,
    pomodoros_logged: row.pomodoros_logged,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    subtasks: [...(row.subtasks ?? [])]
      .sort((a, b) => a.subtask_order - b.subtask_order)
      .map(({ id, title, status, level, percent, deadline }) => ({
        id, title, status, level, percent, deadline,
      })),
  };
}

/* --------------------------------- errors -------------------------------- */

export type ErrorCode =
  | "unauthorized"
  | "not_found"
  | "validation_error"
  | "conflict"
  | "rate_limited"
  | "internal";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {}
  ) {
    super(message);
  }
}

export const notFound = (what = "Task") =>
  new ApiError(404, "not_found", `${what} not found`);

export const validation = (message: string, details: Record<string, unknown> = {}) =>
  new ApiError(400, "validation_error", message, details);

function errorResponse(err: ApiError): NextResponse {
  return NextResponse.json(
    { error: { code: err.code, message: err.message, details: err.details } },
    { status: err.status, headers: err.headers }
  );
}

/* ---------------------------------- auth --------------------------------- */

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** Returns the caller's key id, or throws 401. */
function authenticate(request: Request): string {
  const configured = (process.env.CADENCE_API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const presented = request.headers.get("x-api-key");
  if (configured.length === 0 || !presented) {
    throw new ApiError(401, "unauthorized", "Missing or invalid API key");
  }
  const digest = sha256(presented);
  const match = configured.some((key) => timingSafeEqual(sha256(key), digest));
  if (!match) throw new ApiError(401, "unauthorized", "Missing or invalid API key");
  return digest.toString("hex").slice(0, 8);
}

/* ----------------------------- data + context ---------------------------- */

export type ApiContext = {
  db: SupabaseClient;
  userId: string;
  /** Extra non-content fields for the request log line (e.g. reopen). */
  logExtra: Record<string, unknown>;
};

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ApiError(500, "internal", "Supabase not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function enforceRateLimit(db: SupabaseClient, keyId: string) {
  const { data, error } = await db.rpc("api_rate_limit_hit", { p_key_id: keyId });
  if (error) throw new ApiError(500, "internal", "Rate limiter unavailable");
  const { hits, reset_in } = data as { hits: number; reset_in: number };
  if (hits > RATE_LIMIT_PER_MIN) {
    const retryAfter = String(Math.max(1, reset_in));
    throw new ApiError(
      429,
      "rate_limited",
      `Rate limit of ${RATE_LIMIT_PER_MIN} requests/minute exceeded`,
      { retry_after_seconds: Number(retryAfter) },
      { "Retry-After": retryAfter }
    );
  }
}

/**
 * Wraps a route handler with auth → rate limit → handler, the error envelope
 * and the request log line. `endpoint` is the route template, so task ids
 * never reach the logs either.
 */
export async function handle(
  request: Request,
  endpoint: string,
  run: (ctx: ApiContext) => Promise<NextResponse>
): Promise<NextResponse> {
  const started = Date.now();
  let keyId = "-";
  const logExtra: Record<string, unknown> = {};
  let response: NextResponse;
  try {
    keyId = authenticate(request);
    const userId = process.env.CADENCE_API_USER_ID;
    if (!userId) throw new ApiError(500, "internal", "API user not configured");
    const db = serviceClient();
    await enforceRateLimit(db, keyId);
    response = await run({ db, userId, logExtra });
  } catch (err) {
    if (err instanceof ApiError) {
      response = errorResponse(err);
    } else {
      console.error("[tasks-api] unhandled", err instanceof Error ? err.message : "unknown");
      response = errorResponse(new ApiError(500, "internal", "Internal error"));
    }
  }
  console.log(
    JSON.stringify({
      tag: "tasks-api",
      ts: new Date(started).toISOString(),
      method: request.method,
      endpoint,
      key_id: keyId,
      status: response.status,
      ms: Date.now() - started,
      ...logExtra,
    })
  );
  return response;
}

/* ------------------------------- validation ------------------------------ */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => undefined);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validation("Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

/** Writable task fields → validated DB column values. */
const FIELD_VALIDATORS: Record<string, (v: unknown) => unknown> = {
  title: (v) => {
    if (typeof v !== "string" || !v.trim() || v.length > 500) throw "a non-empty string (max 500 chars)";
    return v.trim();
  },
  status: (v) => {
    if (!TASK_STATUSES.includes(v as never)) throw `one of: ${TASK_STATUSES.join(", ")}`;
    return v;
  },
  priority: (v) => {
    if (!TASK_PRIORITIES.includes(v as never)) throw `one of: ${TASK_PRIORITIES.join(", ")}`;
    return v;
  },
  deadline: (v) => {
    if (v === null) return "";
    if (!isIsoDate(v)) throw "YYYY-MM-DD or null";
    return v;
  },
  category: (v) => {
    if (typeof v !== "string" || !v.trim() || v.length > 100) throw "a non-empty string (max 100 chars)";
    return v.trim();
  },
  progress: (v) => {
    if (v === null) return null;
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 100) throw "an integer 0–100 or null";
    return v;
  },
  goal_id: (v) => {
    if (v === null) return null;
    if (typeof v !== "string" || !v.trim() || v.length > 200) throw "a non-empty string or null";
    return v;
  },
  life_pillar: (v) => {
    if (v === null) return null;
    if (!LIFE_PILLARS.includes(v as never)) throw `one of: ${LIFE_PILLARS.join(", ")}, or null`;
    return v;
  },
  is_today: (v) => {
    if (typeof v !== "boolean") throw "true or false";
    return v;
  },
};

/** Validators for subtask fields (subtask endpoints). */
const SUBTASK_VALIDATORS: Record<string, (v: unknown) => unknown> = {
  title: FIELD_VALIDATORS.title,
  status: (v) => {
    if (!SUBTASK_STATUSES.includes(v as never)) throw `one of: ${SUBTASK_STATUSES.join(", ")}`;
    return v;
  },
  level: (v) => {
    if (!SUBTASK_LEVELS.includes(v as never)) throw `one of: ${SUBTASK_LEVELS.join(", ")}`;
    return v;
  },
  percent: FIELD_VALIDATORS.progress,
  deadline: (v) => {
    if (v === null) return null;
    if (!isIsoDate(v)) throw "YYYY-MM-DD or null";
    return v;
  },
};

/**
 * Validates `body` against an allow-list of fields. Unknown fields are
 * rejected (not ignored) so a client using a wrong name — e.g. the old spec's
 * `percent`/`pillar` — finds out instead of silently writing nothing.
 */
export function pickFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
  ignore: readonly string[] = [],
  validators: Record<string, (v: unknown) => unknown> = FIELD_VALIDATORS
): Record<string, unknown> {
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k) && !ignore.includes(k));
  if (unknown.length > 0) {
    throw validation(`Unknown field(s): ${unknown.join(", ")}`, { unknown_fields: unknown, allowed });
  }
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const key of allowed) {
    if (!(key in body)) continue;
    try {
      out[key] = validators[key](body[key]);
    } catch (expected) {
      errors[key] = `must be ${expected}`;
    }
  }
  if (Object.keys(errors).length > 0) throw validation("Invalid field value(s)", { fields: errors });
  return out;
}

/* --------------------------- concurrency helpers -------------------------- */

export async function fetchTask(ctx: ApiContext, id: string): Promise<TaskRow | null> {
  const { data, error } = await ctx.db
    .from("tasks")
    .select(TASK_SELECT)
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw new ApiError(500, "internal", "Database read failed");
  return data as TaskRow | null;
}

export const pickSubtaskFields = (
  body: Record<string, unknown>,
  allowed: readonly string[]
) => pickFields(body, allowed, ["expected_updated_at"], SUBTASK_VALIDATORS);

export function requireExpectedUpdatedAt(body: Record<string, unknown>): string {
  const expected = body.expected_updated_at;
  if (!isTimestamp(expected)) {
    throw validation("expected_updated_at is required (the updated_at you last read)", {
      fields: { expected_updated_at: "must be an ISO-8601 timestamp" },
    });
  }
  return expected;
}

export const conflict = (server: unknown, attempted: Record<string, unknown>) =>
  new ApiError(409, "conflict", "Changed since expected_updated_at; nothing was written", {
    server,
    attempted,
  });

/**
 * Compare-and-set update: writes `changes` only if the row's updated_at still
 * equals `expected` — the check and the write are one UPDATE … WHERE, so a
 * concurrent edit can never be overwritten. On mismatch nothing is written and
 * a 409 carries both versions.
 */
export async function casUpdate(
  ctx: ApiContext,
  current: TaskRow,
  expected: string,
  changes: Record<string, unknown>,
  attempted: Record<string, unknown>
): Promise<TaskRow> {
  // Fast path: a millisecond-level mismatch is a definite conflict. (Equal ms
  // isn't proof of a match — Postgres keeps µs — so the WHERE below decides.)
  if (Date.parse(current.updated_at) !== Date.parse(expected)) {
    throw conflict(toApiTask(current), attempted);
  }
  const { data, error } = await ctx.db
    .from("tasks")
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("id", current.id)
    .eq("user_id", ctx.userId)
    .eq("updated_at", expected)
    .select(TASK_SELECT);
  if (error) throw new ApiError(500, "internal", "Database write failed");
  if (data && data.length === 1) return data[0] as TaskRow;
  const latest = await fetchTask(ctx, current.id);
  if (!latest) throw notFound();
  throw conflict(toApiTask(latest), attempted);
}

/**
 * Mirrors the app's sendTaskToToday cap: at most MAX_TODAY_TASKS active
 * (not Done, not Inbox) tasks may be flagged is_today at once.
 */
export async function assertTodayCapacity(ctx: ApiContext, taskId: string) {
  const { count, error } = await ctx.db
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId)
    .eq("is_today", true)
    .not("status", "in", "(Done,Inbox)")
    .neq("id", taskId);
  if (error) throw new ApiError(500, "internal", "Database read failed");
  if ((count ?? 0) >= MAX_TODAY_TASKS) {
    throw validation(`Today already has ${MAX_TODAY_TASKS} active tasks (the app's cap)`, {
      max_today_tasks: MAX_TODAY_TASKS,
    });
  }
}

/**
 * Atomically replaces a task's subtask list via api_replace_subtasks()
 * (row lock + expected_updated_at check + write in one transaction), then
 * returns the fresh task. 409 with both versions on a stale version.
 */
export async function replaceSubtasks(
  ctx: ApiContext,
  taskId: string,
  expected: string,
  subtasks: Omit<SubtaskRow, "subtask_order">[],
  attempted: Record<string, unknown>
): Promise<TaskRow> {
  const { data, error } = await ctx.db.rpc("api_replace_subtasks", {
    p_user: ctx.userId,
    p_task_id: taskId,
    p_expected: expected,
    p_subtasks: subtasks,
  });
  if (error) throw new ApiError(500, "internal", "Database write failed");
  const result = (data as { result: string }).result;
  const latest = await fetchTask(ctx, taskId);
  if (result === "not_found" || !latest) throw notFound();
  if (result === "conflict") throw conflict(toApiTask(latest), attempted);
  return latest;
}

/** Reads expected_updated_at from a JSON body or, for DELETE, the query string. */
export async function readExpected(request: Request): Promise<string> {
  const fromQuery = new URL(request.url).searchParams.get("expected_updated_at");
  if (fromQuery !== null) return requireExpectedUpdatedAt({ expected_updated_at: fromQuery });
  const body = await readJsonObject(request);
  pickFields(body, [], ["expected_updated_at"]);
  return requireExpectedUpdatedAt(body);
}

/**
 * Recurring tasks are reopened by the app's period engine unless it stamped
 * last_completed_period itself, so an API completion would be silently undone.
 * Recurrence is out of MVP scope (spec §5): refuse rather than half-work.
 */
export function assertNotRecurringCompletion(task: TaskRow) {
  if (task.recurrence !== "none") {
    throw validation(
      "Completing recurring tasks is not supported by the API yet (recurrence is out of MVP scope); complete it in the app",
      { recurrence: task.recurrence }
    );
  }
}

/* ------------------------- user-row jsonb blobs -------------------------- */

/** Blobs on public.users exposed by the API, each with its version column. */
export type UserBlob = "goals" | "daily_plan" | "categories";

export async function readUserBlob<T>(
  ctx: ApiContext,
  blob: UserBlob
): Promise<{ value: T | null; updated_at: string }> {
  const { data, error } = await ctx.db
    .from("users")
    .select(`${blob}, ${blob}_updated_at`)
    .eq("id", ctx.userId)
    .single();
  if (error || !data) throw new ApiError(500, "internal", "Database read failed");
  const row = data as unknown as Record<string, unknown>;
  return { value: (row[blob] as T | null) ?? null, updated_at: row[`${blob}_updated_at`] as string };
}

/**
 * Compare-and-set write of a whole blob: only lands if `<blob>_updated_at`
 * still equals `expected` (bumped by the users_touch_blobs trigger on any
 * change, app edits included). On mismatch: 409 with the stored version.
 */
export async function casUpdateUserBlob<T>(
  ctx: ApiContext,
  blob: UserBlob,
  expected: string,
  value: T,
  attempted: Record<string, unknown>,
  present: (value: T | null, updatedAt: string) => unknown
): Promise<string> {
  const current = await readUserBlob<T>(ctx, blob);
  if (Date.parse(current.updated_at) !== Date.parse(expected)) {
    throw conflict(present(current.value, current.updated_at), attempted);
  }
  const { data, error } = await ctx.db
    .from("users")
    .update({ [blob]: value })
    .eq("id", ctx.userId)
    .eq(`${blob}_updated_at`, expected)
    .select(`${blob}_updated_at`);
  if (error) throw new ApiError(500, "internal", "Database write failed");
  if (data && data.length === 1) {
    return (data[0] as unknown as Record<string, string>)[`${blob}_updated_at`];
  }
  const latest = await readUserBlob<T>(ctx, blob);
  throw conflict(present(latest.value, latest.updated_at), attempted);
}
