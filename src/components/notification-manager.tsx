"use client";

import { useEffect } from "react";
import { differenceInCalendarDays, format, isValid, parseISO } from "date-fns";

import { useProdStore } from "@/store/use-prod-store";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Persisted dedup keys (`taskId:deadline:stage[:day]`) so a reminder fires
 * once per task/deadline/stage across sessions — not once per page load.
 */
const SENT_KEY = "cadence-deadline-notified";
/** Cap the stored key list so it can't grow forever. */
const MAX_SENT_KEYS = 400;

function readSentKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(SENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeSentKeys(keys: Set<string>) {
  try {
    localStorage.setItem(
      SENT_KEY,
      JSON.stringify([...keys].slice(-MAX_SENT_KEYS))
    );
  } catch {
    // Storage full/blocked — dedup falls back to once-per-session.
  }
}

/**
 * Headless client component that drives native browser deadline reminders.
 *
 * Scans tasks on load, when the tab becomes visible again (PWA resume), and
 * hourly. For every task that isn't Done/Inbox and has a valid deadline it
 * fires at three stages, each at most once (persisted in localStorage):
 *
 *   - 3 days before the deadline
 *   - on the day it's due
 *   - overdue — once per day until completed or rescheduled
 *
 * Permission is NOT requested here — the deadline-reminder modal (and its
 * Enable button) asks in context instead, so users aren't ambushed on load.
 *
 * Limitation: these are page-context notifications. They show while the app
 * is open or resumed on desktop browsers; Android Chrome and iOS Safari only
 * deliver notifications through a service worker / server push, which this
 * app intentionally does not register (see public/sw.js) — there the try/catch
 * below makes this a quiet no-op.
 */
export function NotificationManager() {
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const checkDeadlines = () => {
      if (Notification.permission !== "granted") return;

      const now = new Date();
      const today = format(now, "yyyy-MM-dd");
      const sent = readSentKeys();
      let dirty = false;

      for (const task of useProdStore.getState().tasks) {
        if (task.status === "Done" || task.status === "Inbox") continue;
        if (!task.deadline) continue;

        const due = parseISO(task.deadline);
        if (!isValid(due)) continue;

        const daysUntil = differenceInCalendarDays(due, now);
        const title = task.title || "Untitled task";

        let key: string;
        let body: string;
        if (daysUntil === 3) {
          key = `${task.id}:${task.deadline}:3day`;
          body = `"${title}" is due in 3 days (${format(due, "d MMM")}).`;
        } else if (daysUntil === 0) {
          key = `${task.id}:${task.deadline}:today`;
          body = `"${title}" is due today.`;
        } else if (daysUntil < 0) {
          // Once per day, not once per hour — a nudge, not an alarm.
          key = `${task.id}:${task.deadline}:overdue:${today}`;
          body = `"${title}" was due ${format(due, "d MMM")} — still open.`;
        } else {
          continue;
        }

        if (sent.has(key)) continue;

        try {
          new Notification("Cadence", { body, tag: key });
        } catch {
          // Mobile browsers require a service worker for notifications; this
          // app runs without one, so quietly skip rather than crash the scan.
          return;
        }
        sent.add(key);
        dirty = true;
      }

      if (dirty) writeSentKeys(sent);
    };

    checkDeadlines();
    const intervalId = window.setInterval(checkDeadlines, HOUR_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") checkDeadlines();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
