"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";

import {
  TIMER_DURATIONS,
  TIMER_MODE_LABELS,
  TIMER_MODES,
  useProdStore,
  type TimerMode,
} from "@/store/use-prod-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Per-mode color tokens for the premium "Life Vault" aesthetic. */
const MODE_THEME: Record<
  TimerMode,
  { button: string; bar: string; tab: string }
> = {
  focus: {
    button: "bg-[#a35d4d] hover:bg-[#8f4f41]",
    bar: "bg-[#a35d4d]",
    tab: "bg-[var(--c-panel)] text-[#a35d4d] shadow-[0_1px_3px_rgba(74,64,54,0.08)]",
  },
  shortBreak: {
    button: "bg-[#6f9e6a] hover:bg-[#5f8a5a]",
    bar: "bg-[#6f9e6a]",
    tab: "bg-[var(--c-panel)] text-[#5f8a5a] shadow-[0_1px_3px_rgba(74,64,54,0.08)]",
  },
  longBreak: {
    button: "bg-[#6f9e6a] hover:bg-[#5f8a5a]",
    bar: "bg-[#6f9e6a]",
    tab: "bg-[var(--c-panel)] text-[#5f8a5a] shadow-[0_1px_3px_rgba(74,64,54,0.08)]",
  },
};

/** Play a short two-tone "ping" via the Web Audio API (no asset needed). */
function useChime() {
  const ctxRef = useRef<AudioContext | null>(null);

  return () => {
    try {
      if (typeof window === "undefined") return;
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;

      if (!ctxRef.current) ctxRef.current = new AudioCtx();
      const ctx = ctxRef.current;
      // Resume in case the context was suspended by autoplay policy.
      void ctx.resume();

      const now = ctx.currentTime;
      const notes = [880, 1244.51]; // A5 then D#6 — a gentle rising ping.
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const start = now + i * 0.18;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.4);
      });
    } catch {
      // Audio is non-essential — never let it break the timer.
    }
  };
}

export function TimerWidget() {
  const mode = useProdStore((state) => state.mode);
  const timeLeft = useProdStore((state) => state.timeLeft);
  const isRunning = useProdStore((state) => state.isRunning);
  const sessionsCompleted = useProdStore((state) => state.sessionsCompleted);
  const completions = useProdStore((state) => state.completions);
  const activeTaskId = useProdStore((state) => state.activeTaskId);
  const activeTask = useProdStore((state) =>
    state.tasks.find((task) => task.id === state.activeTaskId)
  );

  const startTimer = useProdStore((state) => state.startTimer);
  const pauseTimer = useProdStore((state) => state.pauseTimer);
  const resetTimer = useProdStore((state) => state.resetTimer);
  const switchMode = useProdStore((state) => state.switchMode);

  const [prompt, setPrompt] = useState<string | null>(null);
  const playChime = useChime();

  // Single authoritative countdown. Reads/writes fresh state via getState()
  // inside the interval, so there is no stale-closure risk.
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      useProdStore.getState().tick();
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  // React to a completed session: chime + prompt for the next phase.
  const prevCompletions = useRef(completions);
  useEffect(() => {
    if (completions === prevCompletions.current) return;
    prevCompletions.current = completions;
    playChime();
    // `mode` is already the upcoming mode (the store switched on completion).
    setPrompt(`Time's up! ${TIMER_MODE_LABELS[mode]} is up next.`);
  }, [completions, mode, playChime]);

  const theme = MODE_THEME[mode];
  const progress = 1 - timeLeft / TIMER_DURATIONS[mode];
  const isFocus = mode === "focus";

  const handleStart = () => {
    setPrompt(null);
    startTimer();
  };

  const handleSwitch = (next: TimerMode) => {
    setPrompt(null);
    switchMode(next);
  };

  return (
    <div className="rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[0_1px_3px_rgba(74,64,54,0.06)]">
      {/* Mode tabs */}
      <div className="mb-3 flex gap-1 rounded-xl bg-[var(--c-beige-2)] p-1">
        {TIMER_MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => handleSwitch(m)}
            className={cn(
              "flex-1 rounded-lg px-1.5 py-1.5 text-[11px] font-medium transition-all",
              mode === m
                ? MODE_THEME[m].tab
                : "text-[var(--c-dim)] hover:text-[var(--c-ink-3)]"
            )}
          >
            {m === "focus" ? "Focus" : m === "shortBreak" ? "Short" : "Long"}
          </button>
        ))}
      </div>

      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-[var(--c-dim)] uppercase">
          {TIMER_MODE_LABELS[mode]}
        </span>
        <span className="text-xs text-[var(--c-dim)]">{sessionsCompleted} done</span>
      </div>

      <div className="mb-1 text-center font-mono text-4xl font-bold text-[var(--c-ink-2)] tabular-nums">
        {formatTime(timeLeft)}
      </div>

      <p className="mb-3 truncate text-center text-xs text-[var(--c-dim)]">
        {isFocus
          ? activeTask
            ? activeTask.title
            : "No active task selected"
          : "Step away and recharge"}
      </p>

      {prompt && (
        <p className="mb-3 rounded-lg bg-[var(--c-beige-2)] px-3 py-2 text-center text-xs font-medium text-[#a35d4d]">
          {prompt}
        </p>
      )}

      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[var(--c-beige)]">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-1000 ease-linear",
            theme.bar
          )}
          style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
        />
      </div>

      <div className="flex items-center justify-center gap-2">
        <Button
          size="sm"
          disabled={isFocus && !activeTaskId}
          onClick={() => (isRunning ? pauseTimer() : handleStart())}
          className={cn(
            "flex-1 text-white disabled:opacity-40",
            theme.button
          )}
        >
          {isRunning ? (
            <>
              <Pause className="size-4" /> Pause
            </>
          ) : (
            <>
              <Play className="size-4" /> Start
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={resetTimer}
          className="text-[var(--c-ink-3)] hover:bg-[var(--c-beige)] hover:text-[var(--c-ink-2)]"
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>
    </div>
  );
}
