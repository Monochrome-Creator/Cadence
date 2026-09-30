"use client";

import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { Bell, BellOff, Maximize2, X } from "lucide-react";

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

/**
 * Portrait "life calendar" layout: one row per year, 52 week-blocks running
 * left to right within each row (top-to-bottom over the years). Rows are
 * grouped into 5-year bands with a small gap and an age label between bands,
 * and each row is split into quarters with its own small gap — the same
 * banding the classic life-calendar poster uses. Cells stretch to fill the
 * available width, so the grid never needs horizontal scrolling.
 */
const WEEKS_PER_YEAR = 52;
const WEEKS_PER_QUARTER = 13;
const YEARS_PER_BLOCK = 5;

/** 0-based week index (weeks since birth) for a given birth date + "today". */
function weekIndexFor(birthDate: string, today: Date): number {
  const days = differenceInCalendarDays(today, parseISO(birthDate));
  return Math.floor(days / 7);
}

function WeekCell({
  weekIndex,
  totalWeeks,
  currentWeekIndex,
  isChecked,
  onToggle,
  cellHeightClassName,
}: {
  weekIndex: number;
  totalWeeks: number;
  currentWeekIndex: number;
  isChecked: boolean;
  onToggle: (weekIndex: number) => void;
  cellHeightClassName: string;
}) {
  const isFuture = weekIndex > currentWeekIndex;
  const isCurrent = weekIndex === currentWeekIndex;

  return (
    <button
      type="button"
      disabled={isFuture}
      onClick={() => onToggle(weekIndex)}
      title={`Week ${weekIndex + 1} of ${totalWeeks}`}
      className={cn(
        "flex-1 rounded-[1px] border transition-colors",
        cellHeightClassName,
        isCurrent
          ? "border-black ring-1 ring-black dark:border-white dark:ring-white"
          : "border-neutral-300 dark:border-neutral-700",
        isFuture
          ? "border-dashed bg-neutral-50 dark:bg-neutral-950"
          : isChecked
            ? "bg-black dark:bg-white"
            : "bg-neutral-300 hover:bg-neutral-400 dark:bg-neutral-700 dark:hover:bg-neutral-600"
      )}
    />
  );
}

function WeekGrid({
  lifeExpectancy,
  totalWeeks,
  currentWeekIndex,
  checkedSet,
  onToggle,
  cellHeightClassName,
}: {
  lifeExpectancy: number;
  totalWeeks: number;
  currentWeekIndex: number;
  checkedSet: Set<number>;
  onToggle: (weekIndex: number) => void;
  cellHeightClassName: string;
}) {
  const years = Array.from({ length: lifeExpectancy }, (_, i) => i);
  const blocks: number[][] = [];
  for (let i = 0; i < years.length; i += YEARS_PER_BLOCK) {
    blocks.push(years.slice(i, i + YEARS_PER_BLOCK));
  }

  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((blockYears, blockIndex) => (
        <div key={blockIndex} className="flex items-center gap-2">
          <div className="flex flex-1 flex-col gap-[3px]">
            {blockYears.map((year) => (
              <div key={year} className="flex gap-1.5">
                {Array.from({ length: WEEKS_PER_YEAR / WEEKS_PER_QUARTER }, (_, quarter) => (
                  <div key={quarter} className="flex flex-1 gap-[2px]">
                    {Array.from({ length: WEEKS_PER_QUARTER }, (_, i) => {
                      const weekIndex =
                        year * WEEKS_PER_YEAR + quarter * WEEKS_PER_QUARTER + i;
                      return (
                        <WeekCell
                          key={weekIndex}
                          weekIndex={weekIndex}
                          totalWeeks={totalWeeks}
                          currentWeekIndex={currentWeekIndex}
                          isChecked={checkedSet.has(weekIndex)}
                          onToggle={onToggle}
                          cellHeightClassName={cellHeightClassName}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <span className="w-6 shrink-0 text-right text-[10px] text-neutral-400 dark:text-neutral-600">
            {blockYears[blockYears.length - 1] + 1}
          </span>
        </div>
      ))}
    </div>
  );
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
  const isHydrated = useProdStore((state) => state.isHydrated);

  // The store persists with skipHydration, so birthDate is still "" on the
  // first render even when one is saved. Deriving the setup form from hydrated
  // state (rather than latching it into useState) keeps a saved birth date from
  // being hidden behind the form forever.
  const [editing, setEditing] = useState(false);
  // null = untouched, so the fields fall back to the stored values. Reset to
  // null on save/cancel so reopening the form re-reads the store.
  const [draftBirth, setDraftBirth] = useState<string | null>(null);
  const [draftYears, setDraftYears] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState(false);

  const birthValue = draftBirth ?? (birthDate || "1994-09-09");
  const yearsValue = draftYears ?? String(lifeExpectancy);

  const checkedSet = useMemo(() => new Set(checkedWeeks), [checkedWeeks]);

  const today = useMemo(() => new Date(), []);
  const currentWeekIndex = birthDate ? weekIndexFor(birthDate, today) : 0;
  // 52 weeks/row is the classic approximation (not exactly 365.25/7) so the
  // grid stays a clean rectangle — the same convention every life-calendar
  // poster uses.
  const totalWeeks = lifeExpectancy * WEEKS_PER_YEAR;
  const ageYears = birthDate
    ? differenceInCalendarDays(today, parseISO(birthDate)) / 365.25
    : 0;

  // Esc closes the enlarged view.
  useEffect(() => {
    if (!enlarged) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEnlarged(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enlarged]);

  const handleSave = () => {
    const years = Number(yearsValue);
    if (!birthValue || !Number.isFinite(years) || years <= 0) return;
    setMementoBirthDate(birthValue);
    setMementoLifeExpectancy(Math.round(years));
    setDraftBirth(null);
    setDraftYears(null);
    setEditing(false);
  };

  const handleCancel = () => {
    setDraftBirth(null);
    setDraftYears(null);
    setEditing(false);
  };

  // Nothing meaningful to draw until the persisted birth date has landed.
  if (!isHydrated) return null;

  if (editing || birthDate === "") {
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
              value={birthValue}
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
              value={yearsValue}
              onChange={(e) => setDraftYears(e.target.value)}
              className="rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-black outline-none focus:border-black/50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white dark:focus:border-white/50"
            />
          </label>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={!birthValue}
              className="rounded-xl bg-black px-4 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-neutral-800 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
            >
              Save
            </button>
            {birthDate && (
              <button
                type="button"
                onClick={handleCancel}
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
            onClick={() => setEnlarged(true)}
            className="flex items-center gap-1 text-xs font-medium text-black hover:underline dark:text-white"
          >
            <Maximize2 className="size-3.5" />
            Enlarge
          </button>
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

      <div className="mt-4">
        <WeekGrid
          lifeExpectancy={lifeExpectancy}
          totalWeeks={totalWeeks}
          currentWeekIndex={currentWeekIndex}
          checkedSet={checkedSet}
          onToggle={toggleMementoWeek}
          cellHeightClassName="h-2"
        />
      </div>

      <p className="mt-3 text-[11px] text-neutral-500 dark:text-neutral-400">
        Grey = week passed, unchecked · black = checked in · dashed = ahead.
        Tap this week&apos;s highlighted block (or any past block) to check
        in.
      </p>

      {enlarged && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
          onClick={() => setEnlarged(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Memento Mori — enlarged"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-neutral-300 bg-white p-5 dark:border-neutral-700 dark:bg-black"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-heading text-base font-semibold text-black dark:text-white">
                Memento Mori
              </h3>
              <button
                type="button"
                onClick={() => setEnlarged(false)}
                className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100 hover:text-black dark:hover:bg-neutral-900 dark:hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-4 overflow-y-auto pr-1">
              <WeekGrid
                lifeExpectancy={lifeExpectancy}
                totalWeeks={totalWeeks}
                currentWeekIndex={currentWeekIndex}
                checkedSet={checkedSet}
                onToggle={toggleMementoWeek}
                cellHeightClassName="h-4"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
