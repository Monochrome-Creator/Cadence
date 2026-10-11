import { NextResponse } from "next/server";

import {
  ApiError,
  assertNotRecurringCompletion,
  assertTodayCapacity,
  casUpdate,
  conflict,
  fetchTask,
  handle,
  notFound,
  pickFields,
  readExpected,
  readJsonObject,
  requireExpectedUpdatedAt,
  toApiTask,
  validation,
  type TaskRow,
} from "@/lib/tasks-api";

export const dynamic = "force-dynamic";

/** GET /api/tasks/:id */
export async function GET(request: Request, ctx: RouteContext<"/api/tasks/[id]">) {
  return handle(request, "GET /api/tasks/:id", async (api) => {
    const task = await fetchTask(api, (await ctx.params).id);
    if (!task) throw notFound();
    return NextResponse.json({ task: toApiTask(task) });
  });
}

const PATCH_FIELDS = [
  "title",
  "status",
  "priority",
  "deadline",
  "category",
  "progress",
  "goal_id",
  "life_pillar",
  "is_today",
] as const;

/**
 * PATCH /api/tasks/:id — partial update guarded by expected_updated_at
 * (spec §6). A stale value returns 409 with both versions; nothing is written.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/tasks/[id]">) {
  return handle(request, "PATCH /api/tasks/:id", async (api) => {
    const body = await readJsonObject(request);
    const expected = requireExpectedUpdatedAt(body);
    const changes = pickFields(body, PATCH_FIELDS, ["expected_updated_at"]);
    if (Object.keys(changes).length === 0) {
      throw validation("No updatable fields given", { allowed: PATCH_FIELDS });
    }

    const current = await fetchTask(api, (await ctx.params).id);
    if (!current) throw notFound();
    if (changes.status === "Done" && current.status !== "Done") {
      assertNotRecurringCompletion(current);
    }
    if (changes.is_today === true && !current.is_today) {
      await assertTodayCapacity(api, current.id);
    }

    const attempted = { ...body };
    delete attempted.expected_updated_at;
    const updated = await casUpdate(api, current, expected, changes, attempted);
    // Spec §5: reopening a Done task is allowed but logged.
    if (current.status === "Done" && updated.status !== "Done") api.logExtra.reopen = true;
    return NextResponse.json({ task: toApiTask(updated) });
  });
}

/**
 * DELETE /api/tasks/:id — guarded by expected_updated_at (JSON body or
 * ?expected_updated_at=). The full task, subtasks included, is archived in
 * deleted_tasks first (restorable via api_restore_task) and its id becomes a
 * tombstone so a stale device can't re-create it. Archive + delete are one
 * transaction (api_delete_task).
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/tasks/[id]">) {
  return handle(request, "DELETE /api/tasks/:id", async (api) => {
    const expected = await readExpected(request);
    const { data, error } = await api.db.rpc("api_delete_task", {
      p_user: api.userId,
      p_id: (await ctx.params).id,
      p_expected: expected,
      p_actor: "api",
    });
    if (error) throw new ApiError(500, "internal", "Database write failed");
    const { result, task } = data as { result: string; task?: TaskRow };
    if (result === "not_found") throw notFound();
    if (result === "conflict") throw conflict(toApiTask(task!), { action: "delete" });
    api.logExtra.deleted = true;
    return NextResponse.json({ deleted: true, archived: toApiTask(task!) });
  });
}
