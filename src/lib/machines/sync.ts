// Cloud sync as one status instead of six flags set independently. Every pull, push
// and sign-in event goes through `transition`, so a late result cannot show "Synced"
// over a review that is still open, a signed-out user is not called "Offline", and
// offline changes waiting for a decision are not shown as an error.

import type { SyncOutcome } from "@/store/cloud-sync";
import type { PendingSync } from "@/store/use-prod-store";

export type SyncFailure = Exclude<SyncOutcome, { ok: true }>;

export type SyncState =
  /** No cloud at all: a local-only install, or demo mode. */
  | { status: "disabled" }
  | { status: "signedOut" }
  /**
   * `boot`: cloud is configured and sign-in is not confirmed yet. `sync`: a full
   * pull is running and owns the status until it settles. `background`: a single
   * save is in flight.
   */
  | { status: "connecting"; by: "boot" | "sync" | "background" }
  | { status: "synced" }
  | { status: "offline" }
  | { status: "error"; message: string }
  /**
   * Offline changes are waiting for the user's decision. Nothing but that decision
   * (or signing out) leaves this state. `failure` is why the last Save did not finish.
   */
  | { status: "needsReview"; pending: PendingSync; saving: boolean; failure: SyncFailure | null };

export type SyncStatus = SyncState["status"];

export type SyncEvent =
  | { type: "disabled" }
  | { type: "signedOut" }
  | { type: "started"; by: "sync" | "background" }
  | { type: "settled"; by: "sync" | "background"; outcome: SyncOutcome }
  | { type: "reviewNeeded"; pending: PendingSync }
  | { type: "saveStarted" }
  | { type: "saveFailed"; outcome: SyncFailure; pending: PendingSync }
  | { type: "reviewResolved" };

export function initial(cloudConfigured: boolean): SyncState {
  return cloudConfigured ? { status: "connecting", by: "boot" } : { status: "disabled" };
}

/** A full pull is running. A second one must not start alongside it. */
export function isSyncRunning(state: SyncState): boolean {
  return state.status === "connecting" && state.by === "sync";
}

/** The review the user has to decide on, if any. */
export function pendingReviewOf(state: SyncState): PendingSync | null {
  return state.status === "needsReview" ? state.pending : null;
}

// A real network drop (or no client) is the only thing called "offline". A request the
// server answered and rejected is an error, with its message kept for the user.
function settle(state: SyncState, outcome: SyncOutcome): SyncState {
  if (outcome.ok) return state.status === "synced" ? state : { status: "synced" };
  if (outcome.reason === "network" || outcome.reason === "unavailable") {
    return state.status === "offline" ? state : { status: "offline" };
  }
  return { status: "error", message: outcome.message ?? "Sync failed" };
}

/** An event that does not fit the current state returns the state unchanged. */
export function transition(state: SyncState, event: SyncEvent): SyncState {
  if (event.type === "disabled") {
    return state.status === "disabled" ? state : { status: "disabled" };
  }
  if (state.status === "disabled") return state;

  switch (event.type) {
    case "signedOut":
      return state.status === "signedOut" ? state : { status: "signedOut" };

    case "started":
      if (state.status === "needsReview") return state;
      if (event.by === "sync") {
        return isSyncRunning(state) ? state : { status: "connecting", by: "sync" };
      }
      // A background save says "Syncing…" only from a resting state. Signed out, it
      // cannot reach the cloud at all; during a full pull, the pull owns the status.
      if (state.status === "signedOut") return state;
      if (state.status === "connecting" && state.by !== "boot") return state;
      return { status: "connecting", by: "background" };

    case "settled":
      if (state.status === "needsReview" || state.status === "signedOut") return state;
      if (event.by === "sync") {
        return isSyncRunning(state) ? settle(state, event.outcome) : state;
      }
      return isSyncRunning(state) ? state : settle(state, event.outcome);

    case "reviewNeeded":
      return isSyncRunning(state)
        ? { status: "needsReview", pending: event.pending, saving: false, failure: null }
        : state;

    case "saveStarted":
      return state.status === "needsReview" && !state.saving
        ? { ...state, saving: true, failure: null }
        : state;

    case "saveFailed":
      return state.status === "needsReview" && state.saving
        ? { status: "needsReview", pending: event.pending, saving: false, failure: event.outcome }
        : state;

    case "reviewResolved":
      return state.status === "needsReview" ? { status: "synced" } : state;
  }
}
