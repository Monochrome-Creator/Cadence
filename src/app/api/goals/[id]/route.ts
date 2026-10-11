import { NextResponse } from "next/server";

import { goalPatch, presentGoals, toApiGoal, type StoredGoal } from "@/lib/goals-api";
import {
  casUpdateUserBlob,
  handle,
  notFound,
  readJsonObject,
  readUserBlob,
  requireExpectedUpdatedAt,
} from "@/lib/tasks-api";

export const dynamic = "force-dynamic";

/** PATCH /api/goals/:id — edit one goal, guarded by the goals list's updated_at. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/goals/[id]">) {
  return handle(request, "PATCH /api/goals/:id", async (api) => {
    const body = await readJsonObject(request);
    const expected = requireExpectedUpdatedAt(body);
    const { fields, apply } = goalPatch(body, ["title", "description", "target_date", "life_pillar", "status"]);

    const { id } = await ctx.params;
    const goals = (await readUserBlob<StoredGoal[]>(api, "goals")).value ?? [];
    const target = goals.find((g) => g.id === id);
    if (!target) throw notFound("Goal");
    const edited = apply(target);
    const updatedAt = await casUpdateUserBlob(
      api,
      "goals",
      expected,
      goals.map((g) => (g.id === id ? edited : g)),
      { action: "edit_goal", goal_id: id, ...fields },
      presentGoals
    );
    return NextResponse.json({ goal: toApiGoal(edited), updated_at: updatedAt });
  });
}
