"use client";

import { useEffect, useRef } from "react";
import { isValid, parseISO } from "date-fns";

import { useProdStore } from "@/store/use-prod-store";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Headless client component that drives native browser deadline reminders.
 *
 * - Requests notification permission once on mount.
 * - Immediately (and then every hour) scans the store's tasks; any task that
 *   isn't "Done" and whose deadline falls within the next 24 hours (or is
 *   already overdue) fires a native `Notification`.
 *
 * Each (task id + deadline) pair is remembered for the session so a task isn't
 * re-announced on every hourly tick. Renders nothing.
 */
export function NotificationManager() {
  // Deduplicates alerts so the same deadline isn't repeated every hour.
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const checkDeadlines = () => {
      if (Notification.permission !== "granted") return;
      const now = Date.now();

      for (const task of useProdStore.getState().tasks) {
        if (task.status === "Done" || !task.deadline) continue;

        const due = parseISO(task.deadline);
        if (!isValid(due)) continue;

        // Skip anything more than a day out; alert on due-soon + overdue.
        const msUntil = due.getTime() - now;
        if (msUntil > DAY_MS) continue;

        const key = `${task.id}:${task.deadline}`;
        if (notified.current.has(key)) continue;
        notified.current.add(key);

        new Notification("Deadline approaching", {
          body: `"${task.title || "Untitled task"}" is due ${
            msUntil < 0 ? "now" : "within 24 hours"
          }.`,
          tag: key,
        });
      }
    };

    // Ask once; re-check as soon as the user grants permission.
    if (Notification.permission === "default") {
      void Notification.requestPermission().then(checkDeadlines);
    }

    checkDeadlines();
    const intervalId = window.setInterval(checkDeadlines, HOUR_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  return null;
}
