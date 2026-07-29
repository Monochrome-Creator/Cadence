"use client";

import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { Bell, BellOff } from "lucide-react";

import { useProdStore } from "@/store/use-prod-store";
import { cn } from "@/lib/utils";
import {
  getPushPermission,
  hasActivePushSubscription,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push";

/**
 * Small toggle for the Sunday-morning push reminder. Self-contained: reads
 * its own subscription state on mount rather than lifting it into the store,
 * since it's a device-level fact (this browser's subscription), not app data.
 */
function ReminderToggle() {
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "default"
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // One-time post-mount reads of browser-only APIs (avoids an SSR/client mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(isPushSupported());
    setPermission(getPushPermission());
    hasActivePushSubscription().then(setSubscribed);
  }, []);

  if (!supported) return null;

  const handleToggle = async () => {
    setBusy(true);
    try {
      if (subscribed) {
        const ok = await unsubscribeFromPush();
        if (ok) setSubscribed(false);
      } else {
        const ok = await subscribeToPush();
        if (ok) setSubscribed(true);
        setPermission(getPushPermission());
      }
    } finally {
      setBusy(false);
    }
  };

  const denied = permission === "denied";

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={busy || denied}
      title={
        denied
          ? "Notifications blocked in browser settings"
          : subscribed
            ? "Turn off the Sunday reminder"
            : "Get a Sunday-morning reminder to check in"
      }
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40",
        subscribed
          ? "border-black/40 bg-black/5 text-black dark:border-white/40 dark:bg-white/10 dark:text-white"
          : "border-neutral-300 text-neutral-500 hover:bg-neutral-100 hover:text-black dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
      )}
    >
      {subscribed ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}
      {denied
        ? "Blocked"
        : subscribed
          ? "Sunday reminder on"
          : "Remind me Sundays"}
    </button>
  );
}

/** Classic "life calendar" layout: one row per year, 52 week-blocks per row. */
const WEEKS_PER_ROW = 52;

/** 0-based week index (weeks since birth) for a given birth date + "today". */
function weekIndexFor(birthDate: string, today: Date): number {
  const days = differenceInCalendarDays(today, parseISO(birthDate));
  return Math.floor(days / 7);
}

/**
 * Memento Mori — a life-in-weeks grid. One block per week from birth to an
 * assumed life expectancy; a gentle, always-visible reminder that time is
 * finite. Weeks are checked off manually (a Sunday-morning push notification
 * prompts the ritual) rather than auto-filling, so the grid distinguishes
 * "time that passed" from "weeks I showed up for".
 */
export function MementoMoriGrid() {
  const birthDate = useProdStore((state) => state.mementoBirthDate);
  const lifeExpectancy = useProdStore((state) => state.mementoLifeExpectancy);
  const checkedWeeks = useProdStore((state) => state.mementoCheckedWeeks);
  const setMementoBirthDate = useProdStore((state) => state.setMementoBirthDate);
  const setMementoLifeExpectancy = useProdStore(
    (state) => state.setMementoLifeExpectancy
  );
  const toggleMementoWeek = useProdStore((state) => state.toggleMementoWeek);

  const [editing, setEditing] = useState(birthDate === "");
  const [draftBirth, setDraftBirth] = useState(birthDate || "1993-09-09");
  const [draftYears, setDraftYears] = useState(String(lifeExpectancy));

  const checkedSet = useMemo(() => new Set(checkedWeeks), [checkedWeeks]);

  const today = useMemo(() => new Date(), []);
  const currentWeekIndex = birthDate ? weekIndexFor(birthDate, today) : 0;
  // 52 weeks/row is the classic approximation (not exactly 365.25/7) so the
  // grid stays a clean rectangle — the same convention every life-calendar
  // poster uses.
  const totalWeeks = lifeExpectancy * WEEKS_PER_ROW;
  const ageYears = birthDate
    ? differenceInCalendarDays(today, parseISO(birthDate)) / 365.25
    : 0;

  const handleSave = () => {
    const years = Number(draftYears);
    if (!draftBirth || !Number.isFinite(years) || years <= 0) return;
    setMementoBirthDate(draftBirth);
    setMementoLifeExpectancy(Math.round(years));
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="rounded-2xl border border-neutral-300 bg-white p-5 dark:border-neutral-700 dark:bg-black">
        <h2 className="font-heading text-lg font-semibold text-black dark:text-white">
          Memento Mori
        </h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          A block for every week of an assumed lifespan — a quiet reminder
          that time is finite.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Birth date
            <input
              type="date"
              value={draftBirth}
              onChange={(e) => setDraftBirth(e.target.value)}
              className="rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-black outline-none focus:border-black/50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white dark:focus:border-white/50"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Life expectancy (years)
            <input
              type="number"
              min={1}
              max={120}
              value={draftYears}
              onChange={(e) => setDraftYears(e.target.value)}
              className="rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-black outline-none focus:border-black/50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white dark:focus:border-white/50"
            />
          </label>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={!draftBirth}
              className="rounded-xl bg-black px-4 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-neutral-800 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
            >
              Save
            </button>
            {birthDate && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-xl px-4 py-2 text-[13.5px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-black dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const weeksLived = Math.min(currentWeekIndex, totalWeeks);
  const percentLived = Math.min(100, Math.round((weeksLived / totalWeeks) * 100));

  return (
    <div className="rounded-2xl border border-neutral-300 bg-white p-5 dark:border-neutral-700 dark:bg-black">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold text-black dark:text-white">
            Memento Mori
          </h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {ageYears.toFixed(1)} years lived · {weeksLived.toLocaleString()} of{" "}
            {totalWeeks.toLocaleString()} weeks ({percentLived}%)
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <ReminderToggle />
          <button
            type="button"
            onClick={() => {
              setDraftBirth(birthDate);
              setDraftYears(String(lifeExpectancy));
              setEditing(true);
            }}
            className="text-xs font-medium text-black hover:underline dark:text-white"
          >
            Edit
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <div
          className="grid gap-[2px]"
          style={{
            gridTemplateColumns: `repeat(${WEEKS_PER_ROW}, minmax(11px, 1fr))`,
          }}
        >
          {Array.from({ length: totalWeeks }, (_, weekIndex) => {
            const isFuture = weekIndex > currentWeekIndex;
            const isCurrent = weekIndex === currentWeekIndex;
            const isChecked = checkedSet.has(weekIndex);
            return (
              <button
                key={weekIndex}
                type="button"
                disabled={isFuture}
                onClick={() => toggleMementoWeek(weekIndex)}
                title={`Week ${weekIndex + 1} of ${totalWeeks}`}
                className={cn(
                  "aspect-square rounded-[2px] border transition-colors",
                  isCurrent
                    ? "border-black ring-1 ring-black dark:border-white dark:ring-white"
                    : "border-neutral-300 dark:border-neutral-700",
                  isFuture
                    ? "border-dashed bg-neutral-50 dark:bg-neutral-950"
                    : isChecked
                      ? "bg-black dark:bg-white"
                      : "bg-white hover:bg-neutral-100 dark:bg-black dark:hover:bg-neutral-900"
                )}
              />
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-neutral-500 dark:text-neutral-400">
        Filled = checked in that week · pale = week passed unchecked · dashed
        = ahead. Tap this week&apos;s highlighted block (or any past block) to
        check in.
      </p>
    </div>
  );
}
