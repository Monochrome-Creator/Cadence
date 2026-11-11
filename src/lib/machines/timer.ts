// The focus timer as one state. Time left is never counted down: while running it is
// derived from `endsAt`, so it is right however many screens show it and however late
// a background tab wakes up.

export const TIMER_MODES = ["focus", "shortBreak", "longBreak"] as const;
export type TimerMode = (typeof TIMER_MODES)[number];

/** Durations in seconds. Psychology-backed Pomodoro defaults. */
export const TIMER_DURATIONS: Record<TimerMode, number> = {
  focus: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
};

export type TimerState =
  | { status: "idle"; mode: TimerMode; remainingMs: number }
  | { status: "running"; mode: TimerMode; endsAt: number }
  | { status: "paused"; mode: TimerMode; remainingMs: number };

export type TimerEvent =
  | { type: "start"; now: number }
  | { type: "pause"; now: number }
  | { type: "reset" }
  | { type: "switch"; mode: TimerMode }
  | { type: "complete"; now: number; nextMode: TimerMode };

function idle(mode: TimerMode): TimerState {
  return { status: "idle", mode, remainingMs: TIMER_DURATIONS[mode] * 1000 };
}

export const initial: TimerState = idle("focus");

export function remainingMs(state: TimerState, now: number): number {
  return state.status === "running" ? Math.max(0, state.endsAt - now) : state.remainingMs;
}

/** Whole seconds to show. Rounds up, so a fresh 25:00 reads 25:00 and the last second reads 00:01. */
export function secondsLeft(state: TimerState, now: number): number {
  return Math.ceil(remainingMs(state, now) / 1000);
}

export function isDue(state: TimerState, now: number): boolean {
  return state.status === "running" && now >= state.endsAt;
}

/** An event that does not fit the current state returns the state unchanged. */
export function transition(state: TimerState, event: TimerEvent): TimerState {
  switch (event.type) {
    case "start":
      if (state.status === "running" || state.remainingMs <= 0) return state;
      return { status: "running", mode: state.mode, endsAt: event.now + state.remainingMs };
    case "pause":
      // A session already past its end is left for `complete`: pausing it would
      // strand the timer at 00:00, where it can no longer be started.
      if (state.status !== "running" || event.now >= state.endsAt) return state;
      return { status: "paused", mode: state.mode, remainingMs: state.endsAt - event.now };
    case "reset":
      return idle(state.mode);
    case "switch":
      return TIMER_MODES.includes(event.mode) ? idle(event.mode) : state;
    case "complete":
      return isDue(state, event.now) ? idle(event.nextMode) : state;
  }
}
