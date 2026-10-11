/**
 * Goal mapping for /api/goals. Goals live as a jsonb array on
 * public.users.goals in the app's own camelCase shape (see Goal in
 * src/store/use-prod-store.ts); the API speaks snake_case and keeps any
 * other stored keys untouched when editing.
 */
import { LIFE_PILLARS, isIsoDate, pickFields, validation } from "@/lib/tasks-api";

export type StoredGoal = {
  id: string;
  title: string;
  description: string;
  targetDate: string;
  lifePillar?: string;
  status: "active" | "done";
  order: number;
  [key: string]: unknown;
};

export function toApiGoal(g: StoredGoal) {
  return {
    id: g.id,
    title: g.title,
    description: g.description ?? "",
    target_date: g.targetDate || null,
    life_pillar: g.lifePillar ?? null,
    status: g.status,
    order: g.order,
  };
}

export const presentGoals = (value: StoredGoal[] | null, updatedAt: string) => ({
  goals: [...(value ?? [])].sort((a, b) => a.order - b.order).map(toApiGoal),
  updated_at: updatedAt,
});

const GOAL_VALIDATORS: Record<string, (v: unknown) => unknown> = {
  title: (v) => {
    if (typeof v !== "string" || !v.trim() || v.length > 300) throw "a non-empty string (max 300 chars)";
    return v.trim();
  },
  description: (v) => {
    if (typeof v !== "string" || v.length > 2000) throw "a string (max 2000 chars)";
    return v;
  },
  target_date: (v) => {
    if (v === null) return "";
    if (!isIsoDate(v)) throw "YYYY-MM-DD or null";
    return v;
  },
  life_pillar: (v) => {
    if (v === null) return null;
    if (!LIFE_PILLARS.includes(v as never)) throw `one of: ${LIFE_PILLARS.join(", ")}, or null`;
    return v;
  },
  status: (v) => {
    if (v !== "active" && v !== "done") throw "active or done";
    return v;
  },
};

/** Validated API fields → patch on a stored goal (camelCase). */
export function goalPatch(body: Record<string, unknown>, allowed: readonly string[]) {
  const f = pickFields(body, allowed, ["expected_updated_at"], GOAL_VALIDATORS);
  if (Object.keys(f).length === 0) throw validation("No updatable fields given", { allowed });
  const apply = (goal: StoredGoal): StoredGoal => {
    const next: StoredGoal = { ...goal };
    if ("title" in f) next.title = f.title as string;
    if ("description" in f) next.description = f.description as string;
    if ("target_date" in f) next.targetDate = f.target_date as string;
    if ("status" in f) next.status = f.status as "active" | "done";
    if ("life_pillar" in f) {
      if (f.life_pillar === null) delete next.lifePillar;
      else next.lifePillar = f.life_pillar as string;
    }
    return next;
  };
  return { fields: f, apply };
}
