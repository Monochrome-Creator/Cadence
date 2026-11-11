import assert from "node:assert/strict";
import { test } from "node:test";

import { initial, isShowing, transition, type PromptEvent, type PromptQueue } from "./prompts.ts";

const run = (events: PromptEvent[], from: PromptQueue = initial) =>
  events.reduce(transition, from);

test("nothing shows until a prompt asks", () => {
  assert.deepEqual(initial, { status: "idle" });
  assert.equal(isShowing(initial, "syncReview"), false);
});

test("a single asker shows, and the queue is idle again when it lets go", () => {
  const showing = run([{ type: "request", id: "overdueReview" }]);
  assert.deepEqual(showing, { status: "showing", id: "overdueReview", waiting: [] });
  assert.deepEqual(transition(showing, { type: "release", id: "overdueReview" }), initial);
});

test("only one shows at a time, by fixed priority, whatever order they ask in", () => {
  const state = run([
    { type: "request", id: "installPrompt" },
    { type: "request", id: "overdueReview" },
    { type: "request", id: "syncReview" },
    { type: "request", id: "missedPlan" },
  ]);
  assert.deepEqual(state, {
    status: "showing",
    id: "syncReview",
    waiting: ["missedPlan", "overdueReview", "installPrompt"],
  });
  assert.equal(isShowing(state, "syncReview"), true);
  assert.equal(isShowing(state, "overdueReview"), false);
});

test("the offline-changes review takes the screen from a review already open", () => {
  const state = run([
    { type: "request", id: "overdueReview" },
    { type: "request", id: "syncReview" },
  ]);
  assert.equal(isShowing(state, "syncReview"), true);
  // Once it is resolved, the overdue review gets its turn back.
  const after = transition(state, { type: "release", id: "syncReview" });
  assert.deepEqual(after, { status: "showing", id: "overdueReview", waiting: [] });
});

test("a waiting prompt can give up without disturbing the one showing", () => {
  const state = run([
    { type: "request", id: "syncReview" },
    { type: "request", id: "deadlineReminder" },
    { type: "release", id: "deadlineReminder" },
  ]);
  assert.deepEqual(state, { status: "showing", id: "syncReview", waiting: [] });
});

test("asking twice or letting go of nothing returns the same state", () => {
  const state = run([{ type: "request", id: "missedPlan" }]);
  assert.equal(transition(state, { type: "request", id: "missedPlan" }), state);
  assert.equal(transition(state, { type: "release", id: "installPrompt" }), state);
  assert.equal(transition(initial, { type: "release", id: "syncReview" }), initial);
});
