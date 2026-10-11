import { NextResponse } from "next/server";

import {
  assertNotRecurringCompletion,
  casUpdate,
  fetchTask,
  handle,
  notFound,
  pickFields,
  readJsonObject,
  requireExpectedUpdatedAt,
  toApiTask,
  validation,
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

    const attempted = { ...body };
    delete attempted.expected_updated_at;
    const updated = await casUpdate(api, current, expected, changes, attempted);
    // Spec §5: reopening a Done task is allowed but logged.
    if (current.status === "Done" && updated.status !== "Done") api.logExtra.reopen = true;
    return NextResponse.json({ task: toApiTask(updated) });
  });
}

/**
 * No delete endpoint exists (spec §2/§4). Answer 404 per spec §8 test 5,
 * rather than Next's default 405, without touching the database.
 */
export async function DELETE(request: Request) {
  return handle(request, "DELETE /api/tasks/:id", async () => {
    throw notFound();
  });
}
