import assert from "node:assert/strict";
import { test } from "node:test";

import {
  initial,
  isSyncRunning,
  pendingReviewOf,
  transition,
  type SyncEvent,
  type SyncState,
} from "./sync.ts";

type Pending = Extract<SyncState, { status: "needsReview" }>["pending"];
const pending = { cloudTasks: [], localTasks: [], unsyncedIds: ["a"], deletedIds: ["b"] } as Pending;

const OK = { ok: true } as const;
const NETWORK = { ok: false, reason: "network" } as const;
const REJECTED = { ok: false, reason: "auth", message: "JWT expired" } as const;

const run = (events: SyncEvent[], from: SyncState = initial(true)) => events.reduce(transition, from);
const syncing = run([{ type: "started", by: "sync" }]);
const reviewing = run([{ type: "started", by: "sync" }, { type: "reviewNeeded", pending }]);

test("without cloud credentials sync is disabled and nothing changes that", () => {
  const off = initial(false);
  assert.deepEqual(off, { status: "disabled" });
  for (const event of [
    { type: "started", by: "sync" },
    { type: "settled", by: "background", outcome: NETWORK },
    { type: "signedOut" },
    { type: "reviewNeeded", pending },
  ] as SyncEvent[]) {
    assert.equal(transition(off, event), off);
  }
});

test("demo mode switches a configured app to disabled", () => {
  assert.deepEqual(transition(initial(true), { type: "disabled" }), { status: "disabled" });
});

test("with credentials it starts connecting, and that is not yet a running sync", () => {
  assert.deepEqual(initial(true), { status: "connecting", by: "boot" });
  assert.equal(isSyncRunning(initial(true)), false);
  assert.equal(isSyncRunning(syncing), true);
});

test("a full pull settles to synced, offline or error with the server's message", () => {
  assert.deepEqual(transition(syncing, { type: "settled", by: "sync", outcome: OK }), { status: "synced" });
  assert.deepEqual(transition(syncing, { type: "settled", by: "sync", outcome: NETWORK }), { status: "offline" });
  assert.deepEqual(transition(syncing, { type: "settled", by: "sync", outcome: REJECTED }), {
    status: "error",
    message: "JWT expired",
  });
  assert.deepEqual(
    transition(syncing, { type: "settled", by: "sync", outcome: { ok: false, reason: "unavailable" } }),
    { status: "offline" },
  );
});

test("a signed-out user is signed out, not offline, and a save attempt does not change that", () => {
  const out = transition(initial(true), { type: "signedOut" });
  assert.deepEqual(out, { status: "signedOut" });
  assert.equal(transition(out, { type: "started", by: "background" }), out);
  assert.equal(transition(out, { type: "settled", by: "background", outcome: { ok: false, reason: "unavailable" } }), out);
  // Signing in starts a full pull.
  assert.deepEqual(transition(out, { type: "started", by: "sync" }), { status: "connecting", by: "sync" });
});

test("a background save shows syncing, then its result", () => {
  const synced: SyncState = { status: "synced" };
  const saving = transition(synced, { type: "started", by: "background" });
  assert.deepEqual(saving, { status: "connecting", by: "background" });
  assert.deepEqual(transition(saving, { type: "settled", by: "background", outcome: OK }), synced);
  assert.deepEqual(transition(saving, { type: "settled", by: "background", outcome: NETWORK }), { status: "offline" });
  // Settling to the status already shown keeps the same object (no needless re-render).
  assert.equal(transition(synced, { type: "settled", by: "background", outcome: OK }), synced);
});

test("a late save result cannot overwrite a full pull that is still running", () => {
  assert.equal(transition(syncing, { type: "settled", by: "background", outcome: OK }), syncing);
  assert.equal(transition(syncing, { type: "settled", by: "background", outcome: NETWORK }), syncing);
  assert.equal(transition(syncing, { type: "started", by: "background" }), syncing);
});

test("a pull's result is ignored once something else has taken over", () => {
  const out = transition(syncing, { type: "signedOut" });
  assert.equal(transition(out, { type: "settled", by: "sync", outcome: OK }), out);
});

test("offline changes to review are their own state, not an error", () => {
  assert.equal(reviewing.status, "needsReview");
  assert.equal(pendingReviewOf(reviewing), pending);
  assert.equal(pendingReviewOf(syncing), null);
  // Only a running pull can raise a review.
  const synced: SyncState = { status: "synced" };
  assert.equal(transition(synced, { type: "reviewNeeded", pending }), synced);
});

test("nothing but the user's decision leaves the review", () => {
  for (const event of [
    { type: "settled", by: "background", outcome: OK },
    { type: "settled", by: "background", outcome: NETWORK },
    { type: "settled", by: "sync", outcome: OK },
    { type: "started", by: "sync" },
    { type: "started", by: "background" },
  ] as SyncEvent[]) {
    assert.equal(transition(reviewing, event), reviewing, event.type);
  }
  assert.deepEqual(transition(reviewing, { type: "reviewResolved" }), { status: "synced" });
});

test("Save keeps the review open while it runs and says why if it fails", () => {
  const saving = transition(reviewing, { type: "saveStarted" });
  assert.equal(saving.status === "needsReview" && saving.saving, true);
  // A second Save while one is running is ignored.
  assert.equal(transition(saving, { type: "saveStarted" }), saving);

  const left = { ...pending, deletedIds: ["b"] } as Pending;
  const failed = transition(saving, { type: "saveFailed", outcome: NETWORK, pending: left });
  assert.deepEqual(failed, { status: "needsReview", pending: left, saving: false, failure: NETWORK });
  // Trying again clears the old reason.
  const again = transition(failed, { type: "saveStarted" });
  assert.equal(again.status === "needsReview" && again.failure, null);
  assert.deepEqual(transition(again, { type: "reviewResolved" }), { status: "synced" });
});

test("a failure report with no Save running is ignored", () => {
  assert.equal(transition(reviewing, { type: "saveFailed", outcome: NETWORK, pending }), reviewing);
  const synced: SyncState = { status: "synced" };
  assert.equal(transition(synced, { type: "saveStarted" }), synced);
  assert.equal(transition(synced, { type: "reviewResolved" }), synced);
});

test("signing out drops the open review; the outbox still holds the changes", () => {
  assert.deepEqual(transition(reviewing, { type: "signedOut" }), { status: "signedOut" });
});
