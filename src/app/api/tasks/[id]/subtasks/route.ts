import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  fetchTask,
  handle,
  notFound,
  pickSubtaskFields,
  readJsonObject,
  replaceSubtasks,
  requireExpectedUpdatedAt,
  toApiTask,
  validation,
} from "@/lib/tasks-api";

export const dynamic = "force-dynamic";

/**
 * POST /api/tasks/:id/subtasks — append a subtask (level L1 by default; an
 * L2/L3 appended at the end nests under the row above it, as in the app).
 * Guarded by the parent task's expected_updated_at. Returns the whole task.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/tasks/[id]/subtasks">) {
  return handle(request, "POST /api/tasks/:id/subtasks", async (api) => {
    const body = await readJsonObject(request);
    const expected = requireExpectedUpdatedAt(body);
    const fields = pickSubtaskFields(body, ["title", "level", "status", "percent", "deadline"]);
    if (!("title" in fields)) throw validation("title is required", { fields: { title: "required" } });

    const task = await fetchTask(api, (await ctx.params).id);
    if (!task) throw notFound();
    const current = toApiTask(task).subtasks;
    const added = {
      id: `subtask-${randomUUID()}`,
      title: fields.title as string,
      status: (fields.status as string) ?? "todo",
      level: (fields.level as string) ?? "L1",
      percent: (fields.percent as number | null) ?? null,
      deadline: (fields.deadline as string | null) ?? null,
    };
    const updated = await replaceSubtasks(api, task.id, expected, [...current, added], {
      action: "add_subtask",
      ...fields,
    });
    return NextResponse.json({ task: toApiTask(updated), subtask_id: added.id }, { status: 201 });
  });
}
