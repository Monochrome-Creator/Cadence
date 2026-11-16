import assert from "node:assert/strict";
import test from "node:test";
import type { Subtask } from "@/store/use-prod-store";
import { milestoneWeights } from "./milestone-progress.ts";

const steps: Subtask[] = (["L1", "L2", "L3"] as const).map((level, i) => ({
  id: level,
  level,
  status: "todo",
  title: `Verify 100% of items — ${[30, 30, 40][i]}%`,
}));

test("weights follow milestones when the rows move", () => {
  assert.deepEqual(milestoneWeights(steps), [30, 30, 40]);
  assert.deepEqual(milestoneWeights(steps.toReversed()), [40, 30, 30]);
});

test("ordinary checklists and incomplete allocations retain their usual progress", () => {
  assert.equal(milestoneWeights(steps.slice(0, 2)), null);
  for (const change of [
    { title: "Complete 40%" }, { title: "Step — 10%" }, { level: "L1" as const },
  ]) {
    assert.equal(milestoneWeights([steps[0], steps[1], { ...steps[2], ...change }]), null);
  }
});
