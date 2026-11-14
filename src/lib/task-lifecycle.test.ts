import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_TODAY_TASKS,
  completeTask,
  countActiveToday,
  isDueToReopen,
  periodKey,
} from "./task-lifecycle.ts";

const task = (recurrence: "none" | "daily" | "weekly" | "monthly" | "quarterly") => ({
  id: "t1",
  status: "Working on it",
  recurrence,
  lastCompletedPeriod: undefined as string | undefined,
});

// Sunday 14 June 2026, local time.
const NOW = new Date(2026, 5, 14, 10, 0, 0);

test("period keys match the documented shapes", () => {
  assert.equal(periodKey("daily", NOW), "2026-06-14");
  assert.equal(periodKey("weekly", NOW), "2026-W24");
  assert.equal(periodKey("monthly", NOW), "2026-06");
  assert.equal(periodKey("quarterly", NOW), "2026-Q2");
});

test("a one-off task just goes Done, with no stamp, and never reopens", () => {
  const done = completeTask(task("none"), NOW);
  assert.equal(done.status, "Done");
  assert.equal(done.lastCompletedPeriod, undefined);
  assert.equal(isDueToReopen(done, new Date(2027, 0, 1)), false);
});

test("a recurring task finished through completeTask stays Done for its period", () => {
  for (const recurrence of ["daily", "weekly", "monthly", "quarterly"] as const) {
    const done = completeTask(task(recurrence), NOW);
    assert.equal(done.status, "Done");
    assert.equal(done.lastCompletedPeriod, periodKey(recurrence, NOW));
    assert.equal(isDueToReopen(done, NOW), false, recurrence);
    // Later the same day is still the same period for every interval.
    assert.equal(isDueToReopen(done, new Date(2026, 5, 14, 23, 59)), false, recurrence);
  }
});

test("it reopens once its period has passed", () => {
  const next = {
    daily: new Date(2026, 5, 15),
    weekly: new Date(2026, 5, 15), // Monday starts ISO week 25
    monthly: new Date(2026, 6, 1),
    quarterly: new Date(2026, 6, 1),
  } as const;
  for (const recurrence of ["daily", "weekly", "monthly", "quarterly"] as const) {
    const done = completeTask(task(recurrence), NOW);
    assert.equal(isDueToReopen(done, next[recurrence]), true, recurrence);
  }
});

test("the trap this module removes: Done without the stamp reopens at once", () => {
  const unstamped = { ...task("weekly"), status: "Done" };
  assert.equal(isDueToReopen(unstamped, NOW), true);
});

test("a task that is not Done is never reopened", () => {
  assert.equal(isDueToReopen(task("daily"), new Date(2030, 0, 1)), false);
});

test("the Daily Action count ignores Done and Inbox, and unflagged tasks", () => {
  const tasks = [
    { isToday: true, status: "Working on it" },
    { isToday: true, status: "Not Started" },
    { isToday: true, status: "Done" },
    { isToday: true, status: "Inbox" },
    { isToday: false, status: "Stuck" },
    { status: "Stuck" },
  ];
  assert.equal(countActiveToday(tasks), 2);
  assert.equal(MAX_TODAY_TASKS, 5);
});
