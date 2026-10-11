import { NextResponse } from "next/server";

import {
  ApiError,
  casUpdateUserBlob,
  handle,
  isIsoDate,
  pickFields,
  readJsonObject,
  readUserBlob,
  requireExpectedUpdatedAt,
  validation,
  type ApiContext,
} from "@/lib/tasks-api";

export const dynamic = "force-dynamic";

/** Stored shape of users.daily_plan (DailyPlanSync in src/store/cloud-sync.ts). */
type StoredDailyPlan = {
  plan: { date: string; mainTaskIds: string[]; manualTaskIds?: string[] } | null;
  review: { date: string; taskIds: string[] } | null;
};

type TaskLite = { id: string; status: string; is_today: boolean };

async function loadTasks(api: ApiContext): Promise<TaskLite[]> {
  const { data, error } = await api.db
    .from("tasks")
    .select("id, status, is_today")
    .eq("user_id", api.userId)
    .order("task_order", { ascending: true });
  if (error) throw new ApiError(500, "internal", "Database read failed");
  return data as TaskLite[];
}

const present = (tasks: TaskLite[]) => (value: StoredDailyPlan | null, updatedAt: string) => ({
  date: value?.plan?.date ?? null,
  // The Daily Plan's main list is the live is_today flag on tasks — set it
  // with PATCH /api/tasks/:id { is_today }.
  today_task_ids: tasks.filter((t) => t.is_today).map((t) => t.id),
  manual_task_ids: value?.plan?.manualTaskIds ?? [],
  review: value?.review ? { date: value.review.date, task_ids: value.review.taskIds } : null,
  updated_at: updatedAt,
});

/** GET /api/daily-plan */
export async function GET(request: Request) {
  return handle(request, "GET /api/daily-plan", async (api) => {
    const [tasks, blob] = await Promise.all([
      loadTasks(api),
      readUserBlob<StoredDailyPlan>(api, "daily_plan"),
    ]);
    return NextResponse.json(present(tasks)(blob.value, blob.updated_at));
  });
}

/**
 * PATCH /api/daily-plan { date, manual_task_ids, expected_updated_at } — sets
 * the hand-picked Focus list for `date` (the user's local today). Moving to a
 * new date replays the app's day rollover (ensureDailyPlan): snapshot today's
 * focus tasks and, if none is pending, queue yesterday's unfinished picks as
 * the review — so planning ahead of the app doesn't skip that review.
 */
export async function PATCH(request: Request) {
  return handle(request, "PATCH /api/daily-plan", async (api) => {
    const body = await readJsonObject(request);
    const expected = requireExpectedUpdatedAt(body);
    pickFields(body, [], ["expected_updated_at", "date", "manual_task_ids"]);
    const { date, manual_task_ids: ids } = body as { date: unknown; manual_task_ids: unknown };
    const errors: Record<string, string> = {};
    if (!isIsoDate(date)) errors.date = "required, YYYY-MM-DD (the user's local today)";
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) {
      errors.manual_task_ids = "required, array of distinct task ids";
    }
    if (Object.keys(errors).length > 0) throw validation("Invalid field value(s)", { fields: errors });
    const manual = ids as string[];

    const [tasks, blob] = await Promise.all([
      loadTasks(api),
      readUserBlob<StoredDailyPlan>(api, "daily_plan"),
    ]);
    const known = new Set(tasks.map((t) => t.id));
    const unknown = manual.filter((id) => !known.has(id));
    if (unknown.length > 0) throw validation("Unknown task id(s)", { unknown_task_ids: unknown });

    const stored: StoredDailyPlan = blob.value ?? { plan: null, review: null };
    const prev = stored.plan;
    if (prev && (date as string) < prev.date) {
      throw validation(`date is before the current plan's date (${prev.date})`);
    }

    let next: StoredDailyPlan;
    if (prev && prev.date === date) {
      next = { ...stored, plan: { ...prev, manualTaskIds: manual } };
    } else {
      let review = stored.review;
      if (prev && review === null) {
        const byId = new Map(tasks.map((t) => [t.id, t] as const));
        const missed = [...new Set([...prev.mainTaskIds, ...(prev.manualTaskIds ?? [])])].filter(
          (id) => byId.has(id) && byId.get(id)!.status !== "Done"
        );
        if (missed.length > 0) review = { date: prev.date, taskIds: missed };
      }
      next = {
        plan: {
          date: date as string,
          mainTaskIds: tasks.filter((t) => t.is_today).map((t) => t.id),
          manualTaskIds: manual,
        },
        review,
      };
    }

    const updatedAt = await casUpdateUserBlob(
      api,
      "daily_plan",
      expected,
      next,
      { action: "set_daily_plan", date, manual_task_ids: manual },
      present(tasks)
    );
    return NextResponse.json(present(tasks)(next, updatedAt));
  });
}
