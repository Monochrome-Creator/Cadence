"use client";

import { useEffect, useRef, useState } from "react";

import { TIMER_MODE_LABELS, useProdStore } from "@/store/use-prod-store";

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

/**
 * The focus timer's only clock, mounted once in the root layout. Timer widgets just
 * display: when each widget ran its own interval, two on screen counted at double
 * speed and none on screen (sidebar collapsed) froze a "running" timer.
 */
export function TimerClock() {
  const status = useProdStore((state) => state.timer.status);
  const mode = useProdStore((state) => state.timer.mode);
  const completions = useProdStore((state) => state.completions);

  const [announcement, setAnnouncement] = useState("");
  const playChime = useChime();

  useEffect(() => {
    if (status !== "running") return;
    const beat = () => useProdStore.getState().tick(Date.now());
    const interval = setInterval(beat, 250);
    // Background tabs throttle intervals; catch up the moment the tab is shown again.
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [status]);

  // One chime and one announcement per completed session, however many widgets show it.
  const prevCompletions = useRef(completions);
  useEffect(() => {
    if (completions === prevCompletions.current) return;
    prevCompletions.current = completions;
    playChime();
    // `mode` is already the upcoming mode (the store switched on completion).
    setAnnouncement(`Time's up! ${TIMER_MODE_LABELS[mode]} is up next.`);
  }, [completions, mode, playChime]);

  return (
    <p className="sr-only" aria-live="polite" data-timer-clock data-state={status}>
      {announcement}
    </p>
  );
}
