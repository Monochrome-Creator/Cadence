import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  ApiError,
  TASK_PRIORITIES,
  TASK_SELECT,
  TASK_STATUSES,
  handle,
  isIsoDate,
  isTimestamp,
  pickFields,
  readJsonObject,
  toApiTask,
  validation,
  type TaskRow,
} from "@/lib/tasks-api";

export const dynamic = "force-dynamic";

const LIST_PARAMS = [
  "status",
  "priority",
  "category",
  "goal_id",
  "due_before",
  "due_after",
  "limit",
  "updated_since",
];

/** GET /api/tasks — list with optional filters (spec §3). */
export async function GET(request: Request) {
  return handle(request, "GET /api/tasks", async ({ db, userId }) => {
    const params = new URL(request.url).searchParams;
    const unknown = [...params.keys()].filter((k) => !LIST_PARAMS.includes(k));
    if (unknown.length > 0) {
      throw validation(`Unknown query parameter(s): ${unknown.join(", ")}`, { allowed: LIST_PARAMS });
    }

    const status = params.get("status");
    const priority = params.get("priority");
    const dueBefore = params.get("due_before");
    const dueAfter = params.get("due_after");
    const updatedSince = params.get("updated_since");
    const limitRaw = params.get("limit");
    const limit = limitRaw === null ? 100 : Number(limitRaw);

    const errors: Record<string, string> = {};
    if (status !== null && !TASK_STATUSES.includes(status as never)) errors.status = `one of: ${TASK_STATUSES.join(", ")}`;
    if (priority !== null && !TASK_PRIORITIES.includes(priority as never)) errors.priority = `one of: ${TASK_PRIORITIES.join(", ")}`;
    if (dueBefore !== null && !isIsoDate(dueBefore)) errors.due_before = "YYYY-MM-DD";
    if (dueAfter !== null && !isIsoDate(dueAfter)) errors.due_after = "YYYY-MM-DD";
    if (updatedSince !== null && !isTimestamp(updatedSince)) errors.updated_since = "ISO-8601 timestamp";
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) errors.limit = "integer 1–500";
    if (Object.keys(errors).length > 0) throw validation("Invalid query parameter(s)", { fields: errors });

    let query = db.from("tasks").select(TASK_SELECT).eq("user_id", userId);
    if (status !== null) query = query.eq("status", status);
    if (priority !== null) query = query.eq("priority", priority);
    if (params.get("category") !== null) query = query.eq("category", params.get("category")!);
    if (params.get("goal_id") !== null) query = query.eq("goal_id", params.get("goal_id")!);
    // Deadlines are yyyy-MM-dd text, so string order is date order. "No
    // deadline" is stored as "" and never matches a due_* filter.
    if (dueBefore !== null) query = query.neq("deadline", "").lt("deadline", dueBefore);
    if (dueAfter !== null) query = query.neq("deadline", "").gt("deadline", dueAfter);
    if (updatedSince !== null) query = query.gt("updated_at", updatedSince);

    const { data, error } = await query
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(limit);
    if (error) throw new ApiError(500, "internal", "Database read failed");
    const tasks = (data as TaskRow[]).map(toApiTask);
    return NextResponse.json({ tasks, count: tasks.length });
  });
}

const CREATE_FIELDS = ["title", "category", "priority", "deadline", "goal_id", "life_pillar"] as const;

/** POST /api/tasks — create a task (spec §3). New tasks start Not Started. */
export async function POST(request: Request) {
  return handle(request, "POST /api/tasks", async ({ db, userId }) => {
    const fields = pickFields(await readJsonObject(request), CREATE_FIELDS);
    if (!("title" in fields)) throw validation("title is required", { fields: { title: "required" } });

    const { data, error } = await db
      .from("tasks")
      .insert({ id: `task-${randomUUID()}`, user_id: userId, ...fields })
      .select(TASK_SELECT)
      .single();
    if (error) throw new ApiError(500, "internal", "Database write failed");
    return NextResponse.json({ task: toApiTask(data as TaskRow) }, { status: 201 });
  });
}
