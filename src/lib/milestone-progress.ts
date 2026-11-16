import type { Subtask } from "@/store/use-prod-store";

/** An L1/L2/L3 plan declares its weights with a trailing " — N%" on each title. */
export function milestoneWeights(steps: Subtask[]): number[] | null {
  if (steps.length !== 3 || new Set(steps.map(step => step.level)).size !== 3) {
    return null;
  }

  const weights: number[] = [];
  for (const step of steps) {
    const match = / — ([1-9]\d?)%\s*$/.exec(step.title);
    if (!match) return null;
    weights.push(Number(match[1]));
  }
  return weights.reduce((sum, weight) => sum + weight, 0) === 100 ? weights : null;
}
