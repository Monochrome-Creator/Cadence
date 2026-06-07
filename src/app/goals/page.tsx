"use client";

import { useMemo, useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Trophy,
} from "lucide-react";

import {
  useProdStore,
  type Goal,
  type LifePillar,
} from "@/store/use-prod-store";
import { PILLAR_ORDER, PILLAR_THEME } from "@/lib/life-pillars";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

function formatTarget(date: string): string {
  const match = date.match(/\d{4}-\d{2}-\d{2}/);
  if (!match || !isValid(parseISO(match[0]))) return "";
  return format(parseISO(match[0]), "dd MMM yyyy");
}

/* -------------------------------------------------------------------------- */
/*                          Pillar picker (compact)                           */
/* -------------------------------------------------------------------------- */

function PillarPicker({
  value,
  onChange,
}: {
  value: LifePillar | undefined;
  onChange: (next: LifePillar | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onChange(undefined)}
        className={cn(
          "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
          !value
            ? "border-[#a35d4d] bg-[#f6e6da] text-[#a35d4d]"
            : "border-[var(--c-line)] text-[var(--c-dim)] hover:border-[var(--c-line-strong)]"
        )}
      >
        No pillar
      </button>
      {PILLAR_ORDER.map((p) => {
        const active = value === p;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(active ? undefined : p)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
              active
                ? cn("border-transparent", PILLAR_THEME[p].badge)
                : "border-[var(--c-line)] text-[var(--c-dim)] hover:border-[var(--c-line-strong)]"
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                active ? PILLAR_THEME[p].dot : "bg-[var(--c-faint)]"
              )}
            />
            {PILLAR_THEME[p].label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Add-goal form                                  */
/* -------------------------------------------------------------------------- */

function AddGoalForm({ onDone }: { onDone: () => void }) {
  const addGoal = useProdStore((s) => s.addGoal);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [pillar, setPillar] = useState<LifePillar | undefined>(undefined);

  const commit = () => {
    const t = title.trim();
    if (!t) return;
    addGoal({
      title: t,
      description: description.trim(),
      targetDate,
      lifePillar: pillar,
      status: "active",
    });
    onDone();
  };

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-[#a35d4d]/30 bg-[var(--c-panel)] p-6 shadow-[0_2px_12px_rgba(74,64,54,0.08)]">
      <h3 className="font-heading text-lg font-semibold text-[var(--c-ink-2)]">
        New North Star goal
      </h3>

      {/* Title */}
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") onDone();
        }}
        placeholder="What's the big goal? e.g. Build a $500k portfolio"
        maxLength={120}
        className="rounded-xl border border-[var(--c-line)] bg-[var(--c-panel-soft)] px-4 py-3 text-[15px] text-[var(--c-ink-2)] placeholder:text-[var(--c-dim)] outline-none transition-colors focus:border-[#a35d4d]/50 focus:ring-2 focus:ring-[#a35d4d]/15"
      />

      {/* Why it matters */}
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Why does this matter to you? (optional)"
        maxLength={200}
        className="rounded-xl border border-[var(--c-line)] bg-[var(--c-panel-soft)] px-4 py-3 text-[14px] text-[var(--c-ink-2)] placeholder:text-[var(--c-dim)] outline-none transition-colors focus:border-[#a35d4d]/50 focus:ring-2 focus:ring-[#a35d4d]/15"
      />

      {/* Target date + Pillar row */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 shrink-0 text-[var(--c-dim)]" />
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="rounded-lg border border-[var(--c-line)] bg-[var(--c-panel-soft)] px-3 py-1.5 text-[13px] text-[var(--c-ink-2)] outline-none focus:border-[#a35d4d]/50"
          />
        </div>
      </div>

      {/* Pillar picker */}
      <div className="flex flex-col gap-2">
        <p className="text-[12px] font-semibold tracking-[0.04em] text-[var(--c-dim)] uppercase">
          Life pillar (optional)
        </p>
        <PillarPicker value={pillar} onChange={setPillar} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={commit}
          disabled={!title.trim()}
          className="rounded-xl bg-[#a35d4d] px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#8f4f41] disabled:opacity-40"
        >
          Add goal
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-xl px-4 py-2.5 text-[13.5px] font-medium text-[var(--c-dim)] transition-colors hover:bg-[var(--c-beige-2)] hover:text-[var(--c-ink-2)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                               Goal card                                    */
/* -------------------------------------------------------------------------- */

function GoalCard({
  goal,
  linkedCount,
  doneCount,
}: {
  goal: Goal;
  linkedCount: number;
  doneCount: number;
}) {
  const updateGoal = useProdStore((s) => s.updateGoal);
  const deleteGoal = useProdStore((s) => s.deleteGoal);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goal.title);
  const [descDraft, setDescDraft] = useState(goal.description);

  const progress =
    linkedCount > 0 ? Math.round((doneCount / linkedCount) * 100) : 0;
  const target = formatTarget(goal.targetDate);
  const isDone = goal.status === "done";
  const pillar = goal.lifePillar ? PILLAR_THEME[goal.lifePillar] : null;

  const commitEdit = () => {
    const t = draft.trim();
    if (t) updateGoal(goal.id, { title: t, description: descDraft.trim() });
    else setDraft(goal.title);
    setEditing(false);
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-3xl border border-l-4 bg-[var(--c-panel)] p-5 shadow-[0_1px_4px_rgba(74,64,54,0.05)] transition-shadow hover:shadow-[0_6px_20px_rgba(74,64,54,0.08)]",
        pillar
          ? `border-[var(--c-line)]`
          : "border-[var(--c-line)]",
        isDone && "opacity-60"
      )}
      style={
        pillar
          ? { borderLeftColor: pillar.fill }
          : { borderLeftColor: "var(--c-line-strong)" }
      }
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-2xl"
          style={
            pillar
              ? { backgroundColor: `${pillar.fill}22` }
              : { backgroundColor: "var(--c-beige)" }
          }
        >
          <Target
            className="size-5"
            style={pillar ? { color: pillar.fill } : { color: "#a35d4d" }}
          />
        </span>

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex flex-col gap-2">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    setDraft(goal.title);
                    setEditing(false);
                  }
                }}
                className="rounded-lg border border-[#a35d4d]/40 bg-[var(--c-panel-soft)] px-3 py-1.5 text-[15px] font-semibold text-[var(--c-ink-2)] outline-none"
              />
              <input
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                placeholder="Why does this matter?"
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="rounded-lg border border-[var(--c-line)] bg-[var(--c-panel-soft)] px-3 py-1.5 text-[13px] text-[var(--c-ink-2)] placeholder:text-[var(--c-dim)] outline-none"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => !isDone && setEditing(true)}
              className={cn(
                "text-left",
                !isDone && "cursor-text hover:underline decoration-dashed underline-offset-2"
              )}
            >
              <p
                className={cn(
                  "text-[15px] font-semibold leading-snug text-[var(--c-ink-2)]",
                  isDone && "line-through"
                )}
              >
                {goal.title}
              </p>
              {goal.description && (
                <p className="mt-0.5 text-[13px] text-[var(--c-ink-3)]">
                  {goal.description}
                </p>
              )}
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          {!isDone && (
            <button
              type="button"
              title="Mark goal achieved"
              onClick={() => updateGoal(goal.id, { status: "done" })}
              className="flex size-8 items-center justify-center rounded-full text-[var(--c-faint)] transition-colors hover:bg-[#e3ece0] hover:text-[#4d7049]"
            >
              <Trophy className="size-4" />
            </button>
          )}
          <button
            type="button"
            title="Delete goal"
            onClick={() => deleteGoal(goal.id)}
            className="flex size-8 items-center justify-center rounded-full text-[var(--c-faint)] transition-colors hover:bg-[#f6e0e0] hover:text-[#9b3b3b]"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      {/* Metadata row */}
      <div className="flex flex-wrap items-center gap-2">
        {pillar && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium",
              pillar ? PILLAR_THEME[goal.lifePillar!].badge : ""
            )}
          >
            <Sparkles className="size-3" />
            {pillar.label}
          </span>
        )}
        {target && (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--c-dim)]">
            <CalendarDays className="size-3.5 text-[var(--c-faint)]" />
            Target: {target}
          </span>
        )}
        <span className="text-[12.5px] text-[var(--c-dim)]">
          {linkedCount === 0
            ? "No tasks linked yet"
            : `${doneCount} of ${linkedCount} tasks done`}
        </span>
      </div>

      {/* Progress bar */}
      {linkedCount > 0 && (
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--c-beige)]">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{
                width: `${progress}%`,
                backgroundColor: pillar ? pillar.fill : "#6f9e6a",
              }}
            />
          </div>
          <span className="w-10 text-right font-mono text-[12px] font-semibold tabular-nums text-[var(--c-dim)]">
            {progress}%
          </span>
        </div>
      )}

      {/* Reopen achieved goal */}
      {isDone && (
        <button
          type="button"
          onClick={() => updateGoal(goal.id, { status: "active" })}
          className="self-start rounded-xl border border-[var(--c-line)] px-3 py-1.5 text-[12px] font-medium text-[var(--c-dim)] transition-colors hover:bg-[var(--c-beige-2)] hover:text-[var(--c-ink-2)]"
        >
          Reopen
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                               Goals page                                   */
/* -------------------------------------------------------------------------- */

export default function GoalsPage() {
  const goals = useProdStore((s) => s.goals);
  const tasks = useProdStore((s) => s.tasks);

  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);

  // Derive per-goal task counts for progress bars.
  const goalStats = useMemo(() => {
    const map = new Map<string, { linked: number; done: number }>();
    for (const task of tasks) {
      if (!task.goalId) continue;
      const prev = map.get(task.goalId) ?? { linked: 0, done: 0 };
      map.set(task.goalId, {
        linked: prev.linked + 1,
        done: prev.done + (task.status === "Done" ? 1 : 0),
      });
    }
    return map;
  }, [tasks]);

  const active = useMemo(
    () => [...goals].filter((g) => g.status === "active").sort((a, b) => a.order - b.order),
    [goals]
  );
  const done = useMemo(
    () => [...goals].filter((g) => g.status === "done").sort((a, b) => a.order - b.order),
    [goals]
  );

  return (
    <div className="px-5 py-7 md:px-8 md:py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        {/* Header */}
        <header>
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#f6e6da] text-[#a35d4d]">
              <Target className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="font-heading text-3xl font-semibold tracking-tight text-[var(--c-ink-2)] md:text-[34px]">
                North Star
              </h1>
              <p className="mt-1 text-[15px] text-[var(--c-ink-3)]">
                Your big goals. Link tasks to keep daily work anchored to what
                matters.
              </p>
            </div>
          </div>
        </header>

        {/* Add-goal form or button */}
        {adding ? (
          <AddGoalForm onDone={() => setAdding(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] py-5 text-sm font-medium text-[var(--c-dim)] transition-colors hover:border-[#a35d4d]/50 hover:bg-[var(--c-beige-2)] hover:text-[#a35d4d]"
          >
            <Plus className="size-4" />
            Add a North Star goal
          </button>
        )}

        {/* Active goals */}
        {active.length > 0 ? (
          <div className="flex flex-col gap-3">
            {active.map((goal) => {
              const stats = goalStats.get(goal.id) ?? { linked: 0, done: 0 };
              return (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  linkedCount={stats.linked}
                  doneCount={stats.done}
                />
              );
            })}
          </div>
        ) : !adding ? (
          <div className="rounded-2xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] py-14 text-center text-sm text-[var(--c-dim)]">
            No active goals yet. Add one above to anchor your daily work.
          </div>
        ) : null}

        {/* Achieved goals — collapsible */}
        {done.length > 0 && (
          <section>
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className="flex w-full items-center justify-between rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] px-5 py-3.5 text-left shadow-[0_1px_3px_rgba(74,64,54,0.05)] transition-colors hover:bg-[var(--c-beige-2)]"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-md bg-[#6f9e6a] text-white">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
                <span className="font-heading text-base font-semibold text-[var(--c-ink-2)]">
                  Achieved goals
                </span>
                <span className="rounded-full bg-[var(--c-beige)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--c-dim)]">
                  {done.length}
                </span>
              </div>
              <ChevronDown
                className={cn(
                  "size-5 text-[var(--c-dim)] transition-transform",
                  showDone && "rotate-180"
                )}
              />
            </button>
            {showDone && (
              <div className="mt-2.5 flex flex-col gap-3">
                {done.map((goal) => {
                  const stats = goalStats.get(goal.id) ?? { linked: 0, done: 0 };
                  return (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      linkedCount={stats.linked}
                      doneCount={stats.done}
                    />
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
