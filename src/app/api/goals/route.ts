import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { goalPatch, presentGoals, toApiGoal, type StoredGoal } from "@/lib/goals-api";
import {
  casUpdateUserBlob,
  handle,
  readJsonObject,
  readUserBlob,
  requireExpectedUpdatedAt,
  validation,
} from "@/lib/tasks-api";

export const dynamic = "force-dynamic";

/** GET /api/goals → { goals, updated_at } (updated_at versions the whole list). */
export async function GET(request: Request) {
  return handle(request, "GET /api/goals", async (api) => {
    const { value, updated_at } = await readUserBlob<StoredGoal[]>(api, "goals");
    return NextResponse.json(presentGoals(value, updated_at));
  });
}

/** POST /api/goals — create an active goal at the end of the list. */
export async function POST(request: Request) {
  return handle(request, "POST /api/goals", async (api) => {
    const body = await readJsonObject(request);
    const expected = requireExpectedUpdatedAt(body);
    const { fields, apply } = goalPatch(body, ["title", "description", "target_date", "life_pillar"]);
    if (!("title" in fields)) throw validation("title is required", { fields: { title: "required" } });

    const { value } = await readUserBlob<StoredGoal[]>(api, "goals");
    const goals = value ?? [];
    const created = apply({
      id: `goal-${randomUUID()}`,
      title: "",
      description: "",
      targetDate: "",
      status: "active",
      order: goals.reduce((max, g) => Math.max(max, g.order), -1) + 1,
    });
    const updatedAt = await casUpdateUserBlob(api, "goals", expected, [...goals, created], {
      action: "create_goal",
      ...fields,
    }, presentGoals);
    return NextResponse.json({ goal: toApiGoal(created), updated_at: updatedAt }, { status: 201 });
  });
}
