import assert from "node:assert/strict";
import { test } from "node:test";

import { initial, isDue, secondsLeft, transition, type TimerState } from "./timer.ts";

const T0 = 1_000_000;
const FOCUS_MS = 25 * 60 * 1000;
const running = transition(initial, { type: "start", now: T0 });

test("a fresh timer is idle on a full focus session", () => {
  assert.deepEqual(initial, { status: "idle", mode: "focus", remainingMs: FOCUS_MS });
  assert.equal(secondsLeft(initial, T0), 1500);
});

test("start fixes the end time; time left follows the clock, not a count of ticks", () => {
  assert.deepEqual(running, { status: "running", mode: "focus", endsAt: T0 + FOCUS_MS });
  assert.equal(secondsLeft(running, T0 + 10_000), 1490);
  // Two readers asking at the same moment get the same answer.
  assert.equal(secondsLeft(running, T0 + 10_000), 1490);
  // A background tab that wakes late still shows the right time.
  assert.equal(secondsLeft(running, T0 + 600_000), 900);
});

test("starting a running timer changes nothing", () => {
  assert.equal(transition(running, { type: "start", now: T0 + 5_000 }), running);
});

test("pause keeps the time left and start resumes from it", () => {
  const paused = transition(running, { type: "pause", now: T0 + 60_000 });
  assert.deepEqual(paused, { status: "paused", mode: "focus", remainingMs: FOCUS_MS - 60_000 });
  // Time does not pass while paused.
  assert.equal(secondsLeft(paused, T0 + 999_000), 1440);
  const resumed = transition(paused, { type: "start", now: T0 + 999_000 });
  assert.deepEqual(resumed, { status: "running", mode: "focus", endsAt: T0 + 999_000 + FOCUS_MS - 60_000 });
});

test("pausing an idle or paused timer changes nothing", () => {
  assert.equal(transition(initial, { type: "pause", now: T0 }), initial);
});

test("complete fires only when running and due, and only once", () => {
  const early = transition(running, { type: "complete", now: T0 + FOCUS_MS - 1, nextMode: "shortBreak" });
  assert.equal(early, running);
  assert.equal(isDue(running, T0 + FOCUS_MS - 1), false);
  assert.equal(isDue(running, T0 + FOCUS_MS), true);

  const done = transition(running, { type: "complete", now: T0 + FOCUS_MS, nextMode: "shortBreak" });
  assert.deepEqual(done, { status: "idle", mode: "shortBreak", remainingMs: 5 * 60 * 1000 });
  // A second clock reporting the same moment finds nothing left to complete.
  assert.equal(transition(done, { type: "complete", now: T0 + FOCUS_MS, nextMode: "focus" }), done);
  assert.equal(isDue(done, T0 + FOCUS_MS), false);
});

test("a pause that lands after the end leaves the session for complete", () => {
  assert.equal(transition(running, { type: "pause", now: T0 + FOCUS_MS + 5 }), running);
});

test("reset returns to a full session of the same mode", () => {
  const paused = transition(running, { type: "pause", now: T0 + 60_000 });
  assert.deepEqual(transition(paused, { type: "reset" }), initial);
  assert.deepEqual(transition(running, { type: "reset" }), initial);
});

test("switch stops the timer on a full session of the new mode", () => {
  assert.deepEqual(transition(running, { type: "switch", mode: "longBreak" }), {
    status: "idle",
    mode: "longBreak",
    remainingMs: 15 * 60 * 1000,
  });
  const bad = { type: "switch", mode: "nap" } as unknown as Parameters<typeof transition>[1];
  assert.equal(transition(running, bad), running);
});

test("a timer with no time left cannot be started", () => {
  const empty: TimerState = { status: "paused", mode: "focus", remainingMs: 0 };
  assert.equal(transition(empty, { type: "start", now: T0 }), empty);
});
