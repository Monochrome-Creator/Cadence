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
} from "@/lib/tasks-api";

export const dynamic = "force-dynamic";

/**
 * POST /api/tasks/:id/complete — status=Done, progress=100, completed_at
 * stamped. Idempotent: an already-Done task returns 200 unchanged (no write,
 * so no conflict check). Otherwise guarded by expected_updated_at like PATCH.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/tasks/[id]/complete">) {
  return handle(request, "POST /api/tasks/:id/complete", async (api) => {
    const body = await readJsonObject(request);
    const expected = requireExpectedUpdatedAt(body);
    pickFields(body, [], ["expected_updated_at"]);

    const current = await fetchTask(api, (await ctx.params).id);
    if (!current) throw notFound();
    if (current.status === "Done") {
      return NextResponse.json({ task: toApiTask(current), changed: false });
    }
    assertNotRecurringCompletion(current);

    const updated = await casUpdate(
      api,
      current,
      expected,
      { status: "Done", progress: 100, completed_at: new Date().toISOString() },
      { action: "complete" }
    );
    return NextResponse.json({ task: toApiTask(updated), changed: true });
  });
}
