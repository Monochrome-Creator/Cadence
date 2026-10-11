import { NextResponse } from "next/server";

import {
  SUBTASK_LEVELS,
  fetchTask,
  handle,
  notFound,
  pickSubtaskFields,
  readExpected,
  readJsonObject,
  replaceSubtasks,
  requireExpectedUpdatedAt,
  toApiTask,
  validation,
} from "@/lib/tasks-api";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/tasks/[id]/subtasks/[subtaskId]">;

const SUBTASK_FIELDS = ["title", "status", "level", "percent", "deadline"] as const;

/** PATCH /api/tasks/:id/subtasks/:subtaskId — edit one subtask. Returns the whole task. */
export async function PATCH(request: Request, ctx: Ctx) {
  return handle(request, "PATCH /api/tasks/:id/subtasks/:subtaskId", async (api) => {
    const body = await readJsonObject(request);
    const expected = requireExpectedUpdatedAt(body);
    const changes = pickSubtaskFields(body, SUBTASK_FIELDS);
    if (Object.keys(changes).length === 0) {
      throw validation("No updatable fields given", { allowed: SUBTASK_FIELDS });
    }

    const { id, subtaskId } = await ctx.params;
    const task = await fetchTask(api, id);
    if (!task) throw notFound();
    const subtasks = toApiTask(task).subtasks;
    if (!subtasks.some((s) => s.id === subtaskId)) throw notFound("Subtask");

    const next = subtasks.map((s) => (s.id === subtaskId ? { ...s, ...changes } : s));
    const updated = await replaceSubtasks(api, id, expected, next, {
      action: "edit_subtask",
      subtask_id: subtaskId,
      ...changes,
    });
    return NextResponse.json({ task: toApiTask(updated) });
  });
}

/**
 * DELETE /api/tasks/:id/subtasks/:subtaskId — removes the subtask and the
 * deeper-level rows nested directly under it, exactly like the app's
 * deleteSubtask. expected_updated_at via JSON body or query string.
 */
export async function DELETE(request: Request, ctx: Ctx) {
  return handle(request, "DELETE /api/tasks/:id/subtasks/:subtaskId", async (api) => {
    const expected = await readExpected(request);
    const { id, subtaskId } = await ctx.params;
    const task = await fetchTask(api, id);
    if (!task) throw notFound();
    const subtasks = toApiTask(task).subtasks;
    const index = subtasks.findIndex((s) => s.id === subtaskId);
    if (index === -1) throw notFound("Subtask");

    const depth = (level: string) => SUBTASK_LEVELS.indexOf(level as never);
    let end = index + 1;
    while (end < subtasks.length && depth(subtasks[end].level) > depth(subtasks[index].level)) end += 1;
    const removed = subtasks.slice(index, end).map((s) => s.id);

    const updated = await replaceSubtasks(
      api,
      id,
      expected,
      [...subtasks.slice(0, index), ...subtasks.slice(end)],
      { action: "delete_subtask", subtask_id: subtaskId }
    );
    return NextResponse.json({ task: toApiTask(updated), removed_subtask_ids: removed });
  });
}
