// Dialogs that open on their own (at start-up, after a sync) take turns. Each asks for
// the screen and only the highest-priority asker shows; the rest wait with their own
// state intact. Before this, the offline-changes review and the overdue review could
// open together, and "Discard" in the first threw away dates just set in the second.

/** Highest priority first. */
export const PROMPT_ORDER = [
  "syncReview",
  "missedPlan",
  "overdueReview",
  "deadlineReminder",
  "installPrompt",
] as const;
export type PromptId = (typeof PROMPT_ORDER)[number];

export type PromptQueue =
  | { status: "idle" }
  | { status: "showing"; id: PromptId; waiting: PromptId[] };

export type PromptEvent =
  | { type: "request"; id: PromptId }
  | { type: "release"; id: PromptId };

export const initial: PromptQueue = { status: "idle" };

/** An event that does not fit the current state returns the state unchanged. */
export function transition(state: PromptQueue, event: PromptEvent): PromptQueue {
  const asking = state.status === "showing" ? [state.id, ...state.waiting] : [];
  if (asking.includes(event.id) === (event.type === "request")) return state;
  const next =
    event.type === "request"
      ? [...asking, event.id]
      : asking.filter((id) => id !== event.id);
  const [id, ...waiting] = PROMPT_ORDER.filter((p) => next.includes(p));
  return id ? { status: "showing", id, waiting } : initial;
}

export function isShowing(state: PromptQueue, id: PromptId): boolean {
  return state.status === "showing" && state.id === id;
}
