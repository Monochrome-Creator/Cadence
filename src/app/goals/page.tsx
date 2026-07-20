"use client";

import { useEffect, useMemo, useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Grid3x3,
  LayoutList,
  Plus,
  Sparkles,
  Star,
  Target,
  Trash2,
  Trophy,
  X,
} from "lucide-react";

import {
  useProdStore,
  type Behaviour,
  type Goal,
  type LifePillar,
  type Theme,
} from "@/store/use-prod-store";
import { useToastStore } from "@/store/use-toast";
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

/** Coerce a stored target date into the yyyy-MM-dd a <input type="date"> needs. */
function toDateInputValue(date: string): string {
  const match = date.match(/\d{4}-\d{2}-\d{2}/);
  return match && isValid(parseISO(match[0])) ? match[0] : "";
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
        {isDone ? (
          target && (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--c-dim)]">
              <CalendarDays className="size-3.5 text-[var(--c-faint)]" />
              Target: {target}
            </span>
          )
        ) : (
          <label
            title="Set a target date"
            className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--c-dim)]"
          >
            <CalendarDays className="size-3.5 text-[var(--c-faint)]" />
            <span>Target:</span>
            <input
              type="date"
              value={toDateInputValue(goal.targetDate)}
              onChange={(e) =>
                updateGoal(goal.id, { targetDate: e.target.value })
              }
              className="rounded-md border border-[var(--c-line)] bg-[var(--c-panel-soft)] px-2 py-0.5 text-[12.5px] text-[var(--c-ink-2)] outline-none focus:border-[#a35d4d]/50"
            />
          </label>
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
/*                          Pillar behaviours (Mandala)                        */
/* -------------------------------------------------------------------------- */

/** Local `yyyy-MM-dd` for "completed today" checks (client-only component). */
function todayKey(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/**
 * Maps a 0..8 cell index within a 3×3 block to its 0..7 behaviour/theme slot,
 * skipping the centre (index 4 → -1). The same map places the 8 outer blocks
 * around the centre and the 8 theme labels inside the centre block, so one
 * lookup drives the whole 9×9 layout deterministically.
 */
const SLOT_BY_CELL = [0, 1, 2, 3, -1, 4, 5, 6, 7] as const;

/* ------------------------------- chips view ------------------------------- */

function BehaviourChip({
  themeId,
  behaviour,
  today,
}: {
  themeId: string;
  behaviour: Behaviour;
  today: string;
}) {
  const updateBehaviour = useProdStore((s) => s.updateBehaviour);
  const deleteBehaviour = useProdStore((s) => s.deleteBehaviour);
  const toggleBehaviourActive = useProdStore((s) => s.toggleBehaviourActive);
  const completeBehaviour = useProdStore((s) => s.completeBehaviour);
  const undoDeleteMandala = useProdStore((s) => s.undoDeleteMandala);
  const showToast = useToastStore((s) => s.showToast);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(behaviour.title);
  const doneToday = behaviour.lastCompletedDate === today;

  const commit = () => {
    const t = draft.trim();
    if (t) updateBehaviour(themeId, behaviour.id, { title: t });
    else setDraft(behaviour.title);
    setEditing(false);
  };
  const handleDelete = () => {
    deleteBehaviour(themeId, behaviour.id);
    showToast({
      message: `Deleted “${behaviour.title}”`,
      action: { label: "Undo", onClick: undoDeleteMandala },
    });
  };

  return (
    <span
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-full border py-1 pr-2 pl-1 text-[12.5px]",
        behaviour.activeThisWeek
          ? "border-[#a35d4d]/40 bg-[#f6e6da]"
          : "border-[var(--c-line)] bg-[var(--c-panel-soft)]",
        doneToday && "opacity-60"
      )}
    >
      <button
        type="button"
        onClick={() => completeBehaviour(themeId, behaviour.id)}
        title="Mark done today"
        aria-label="Mark done today"
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full transition-colors",
          doneToday
            ? "bg-[#6f9e6a] text-white"
            : "bg-[var(--c-beige)] text-[var(--c-dim)] hover:text-[#6f9e6a]"
        )}
      >
        <Check className="size-3" strokeWidth={3} />
      </button>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(behaviour.title);
              setEditing(false);
            }
          }}
          maxLength={60}
          className="w-32 rounded-md border border-[#a35d4d]/40 bg-[var(--c-panel)] px-1.5 py-0.5 text-[12.5px] text-[var(--c-ink-2)] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={cn(
            "max-w-[12rem] truncate text-left text-[var(--c-ink-2)]",
            doneToday && "line-through"
          )}
        >
          {behaviour.title}
        </button>
      )}
      <button
        type="button"
        onClick={() => toggleBehaviourActive(themeId, behaviour.id)}
        title={behaviour.activeThisWeek ? "Active this week" : "Mark active this week"}
        aria-pressed={!!behaviour.activeThisWeek}
        className={cn(
          "flex size-4 shrink-0 items-center justify-center transition-colors",
          behaviour.activeThisWeek
            ? "text-[#a35d4d]"
            : "text-[var(--c-faint)] hover:text-[#a35d4d]"
        )}
      >
        <Star
          className="size-3.5"
          fill={behaviour.activeThisWeek ? "currentColor" : "none"}
        />
      </button>
      <button
        type="button"
        onClick={handleDelete}
        title="Delete behaviour"
        aria-label="Delete behaviour"
        className="flex size-4 shrink-0 items-center justify-center text-[var(--c-faint)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[#9b3b3b]"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}

function ThemeCard({ theme, today }: { theme: Theme; today: string }) {
  const updateTheme = useProdStore((s) => s.updateTheme);
  const deleteTheme = useProdStore((s) => s.deleteTheme);
  const addBehaviour = useProdStore((s) => s.addBehaviour);
  const undoDeleteMandala = useProdStore((s) => s.undoDeleteMandala);
  const showToast = useToastStore((s) => s.showToast);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(theme.title);
  const [adding, setAdding] = useState(false);
  const [behDraft, setBehDraft] = useState("");

  const handleDelete = () => {
    deleteTheme(theme.id);
    showToast({
      message: `Deleted “${theme.title}”`,
      action: { label: "Undo", onClick: undoDeleteMandala },
    });
  };

  const pillar = theme.lifePillar ? PILLAR_THEME[theme.lifePillar] : null;
  const behaviours = useMemo(
    () => [...theme.behaviours].sort((a, b) => a.order - b.order),
    [theme.behaviours]
  );

  const commitTitle = () => {
    const t = draft.trim();
    if (t) updateTheme(theme.id, { title: t });
    else setDraft(theme.title);
    setEditing(false);
  };
  const commitBehaviour = () => {
    const t = behDraft.trim();
    if (t) addBehaviour(theme.id, t);
    setBehDraft("");
    setAdding(false);
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-3xl border border-l-4 border-[var(--c-line)] bg-[var(--c-panel)] p-5 shadow-[0_1px_4px_rgba(74,64,54,0.05)]"
      style={{ borderLeftColor: pillar ? pillar.fill : "var(--c-line-strong)" }}
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setDraft(theme.title);
                  setEditing(false);
                }
              }}
              maxLength={40}
              className="w-full rounded-lg border border-[#a35d4d]/40 bg-[var(--c-panel-soft)] px-2.5 py-1 text-[15px] font-semibold text-[var(--c-ink-2)] outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-left text-[15px] font-semibold text-[var(--c-ink-2)] hover:underline decoration-dashed underline-offset-2"
            >
              {theme.title}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleDelete}
          title="Delete theme"
          aria-label="Delete theme"
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--c-faint)] transition-colors hover:bg-[#f6e0e0] hover:text-[#9b3b3b]"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {/* Pillar tag */}
      <PillarPicker
        value={theme.lifePillar}
        onChange={(next) => updateTheme(theme.id, { lifePillar: next })}
      />

      {/* Behaviour chips */}
      <div className="flex flex-wrap items-center gap-2">
        {behaviours.map((b) => (
          <BehaviourChip
            key={b.id}
            themeId={theme.id}
            behaviour={b}
            today={today}
          />
        ))}
        {adding ? (
          <input
            autoFocus
            value={behDraft}
            onChange={(e) => setBehDraft(e.target.value)}
            onBlur={commitBehaviour}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setBehDraft("");
                setAdding(false);
              }
            }}
            placeholder="New behaviour…"
            maxLength={60}
            className="w-40 rounded-full border border-[#a35d4d]/40 bg-[var(--c-panel-soft)] px-3 py-1 text-[12.5px] text-[var(--c-ink-2)] placeholder:text-[var(--c-dim)] outline-none"
          />
        ) : (
          behaviours.length < 8 && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--c-line-strong)] px-2.5 py-1 text-[12px] font-medium text-[var(--c-dim)] transition-colors hover:border-[#a35d4d]/50 hover:text-[#a35d4d]"
            >
              <Plus className="size-3" />
              Behaviour
            </button>
          )
        )}
      </div>
    </div>
  );
}

/* ------------------------------- grid view -------------------------------- */

function MandalaGrid({
  themes,
  core,
  today,
}: {
  themes: Theme[];
  core: string;
  today: string;
}) {
  const completeBehaviour = useProdStore((s) => s.completeBehaviour);
  const themeByOrder = useMemo(
    () => new Map(themes.map((t) => [t.order, t] as const)),
    [themes]
  );

  const cells: React.ReactNode[] = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const blockRow = Math.floor(r / 3);
      const blockCol = Math.floor(c / 3);
      const inCell = (r % 3) * 3 + (c % 3);
      const key = `${r}-${c}`;
      const base =
        "flex aspect-square items-center justify-center rounded-md border p-0.5 text-center text-[9px] leading-tight break-words";

      if (blockRow === 1 && blockCol === 1) {
        // Centre block: core + the 8 theme labels around it.
        if (inCell === 4) {
          cells.push(
            <div
              key={key}
              className={cn(
                base,
                "border-[#a35d4d]/40 bg-[#f6e6da] font-semibold text-[#8f4f41]"
              )}
              title={core || "Set your central focus below"}
            >
              {core || "Core"}
            </div>
          );
          continue;
        }
        const theme = themeByOrder.get(SLOT_BY_CELL[inCell]);
        const p = theme?.lifePillar ? PILLAR_THEME[theme.lifePillar] : null;
        cells.push(
          <div
            key={key}
            className={cn(
              base,
              theme
                ? "font-semibold text-[var(--c-ink-2)]"
                : "border-dashed border-[var(--c-faint)] text-[var(--c-faint)]"
            )}
            style={{
              backgroundColor: p ? `${p.fill}33` : "var(--c-panel-soft)",
              borderColor: p ? `${p.fill}66` : undefined,
            }}
            title={theme?.title}
          >
            {theme ? theme.title : ""}
          </div>
        );
        continue;
      }

      // Outer block: its centre mirrors the theme title; the rest are actions.
      const order = SLOT_BY_CELL[blockRow * 3 + blockCol];
      const theme = themeByOrder.get(order);
      const p = theme?.lifePillar ? PILLAR_THEME[theme.lifePillar] : null;

      if (inCell === 4) {
        cells.push(
          <div
            key={key}
            className={cn(
              base,
              theme
                ? "font-semibold text-[var(--c-ink-2)]"
                : "border-dashed border-[var(--c-faint)] text-[var(--c-faint)]"
            )}
            style={{
              backgroundColor: p ? `${p.fill}33` : "var(--c-panel-soft)",
              borderColor: p ? `${p.fill}66` : undefined,
            }}
            title={theme?.title}
          >
            {theme ? theme.title : ""}
          </div>
        );
        continue;
      }

      const beh = theme?.behaviours.find((b) => b.order === SLOT_BY_CELL[inCell]);
      const doneToday = beh?.lastCompletedDate === today;
      cells.push(
        beh ? (
          <button
            key={key}
            type="button"
            onClick={() => completeBehaviour(theme!.id, beh.id)}
            title={`${beh.title}${doneToday ? " — done today" : " — tap to mark done"}`}
            className={cn(
              base,
              "transition-colors",
              doneToday
                ? "border-[#6f9e6a]/50 bg-[#eef3e9] text-[var(--c-dim)] line-through"
                : "border-[var(--c-line)] bg-[var(--c-panel)] text-[var(--c-ink-3)] hover:border-[#a35d4d]/40 hover:bg-[var(--c-beige-2)]",
              beh.activeThisWeek && !doneToday && "ring-1 ring-[#a35d4d]/40"
            )}
          >
            {beh.title}
          </button>
        ) : (
          <div
            key={key}
            className={cn(
              base,
              "border-dashed border-[var(--c-faint)] bg-[var(--c-panel-soft)]"
            )}
          />
        )
      );
    }
  }

  return (
    <>
      {/* The 9×9 grid needs room to breathe — desktop only. */}
      <div className="hidden md:block">
        <div className="mx-auto grid max-w-2xl grid-cols-9 gap-1">{cells}</div>
        <p className="mt-3 text-center text-[12px] text-[var(--c-dim)]">
          Tap an action cell to mark it done today. Add or edit behaviours in the
          list view.
        </p>
      </div>
      <div className="rounded-2xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] px-4 py-8 text-center text-[13px] text-[var(--c-dim)] md:hidden">
        The 64-box grid is best on a larger screen. Switch to the list view to
        manage your behaviours here.
      </div>
    </>
  );
}

/* ------------------------------ orchestrator ------------------------------ */

function MandalaSection() {
  const themes = useProdStore((s) => s.themes);
  const mandalaCore = useProdStore((s) => s.mandalaCore);
  const setMandalaCore = useProdStore((s) => s.setMandalaCore);
  const addTheme = useProdStore((s) => s.addTheme);
  const undoDeleteMandala = useProdStore((s) => s.undoDeleteMandala);
  const showToast = useToastStore((s) => s.showToast);

  const [view, setView] = useState<"chips" | "grid">("chips");
  const [editingCore, setEditingCore] = useState(false);
  const [coreDraft, setCoreDraft] = useState(mandalaCore);
  const [addingTheme, setAddingTheme] = useState(false);
  const [themeDraft, setThemeDraft] = useState("");

  const today = todayKey();
  const sortedThemes = useMemo(
    () => [...themes].sort((a, b) => a.order - b.order),
    [themes]
  );

  // Cmd/Ctrl+Z restores the last deleted theme or behaviour. Scoped to this
  // page (the only place Mandala deletes happen) and skipped while typing so it
  // never hijacks native text undo inside inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isUndo =
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        (e.key === "z" || e.key === "Z");
      if (!isUndo) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      ) {
        return;
      }
      if (useProdStore.getState().deletedMandala.length === 0) return;
      e.preventDefault();
      undoDeleteMandala();
      showToast({ message: "Restored" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undoDeleteMandala, showToast]);

  const commitCore = () => {
    setMandalaCore(coreDraft.trim());
    setEditingCore(false);
  };
  const commitTheme = () => {
    const t = themeDraft.trim();
    if (t) addTheme(t);
    setThemeDraft("");
    setAddingTheme(false);
  };

  return (
    <section className="mt-4 flex flex-col gap-4 border-t border-[var(--c-line)] pt-8">
      {/* Header + view toggle */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef3e9] text-[#6f9e6a]">
            <Grid3x3 className="size-5" />
          </span>
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight text-[var(--c-ink-2)]">
              Pillar behaviours
            </h2>
            <p className="mt-0.5 text-[14px] text-[var(--c-ink-3)]">
              What “winning” looks like — grouped into themes, one tap to log.
            </p>
          </div>
        </div>
        <div className="inline-flex items-center gap-1 rounded-full border border-[var(--c-line)] bg-[var(--c-panel-soft)] p-1">
          <button
            type="button"
            onClick={() => setView("chips")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors",
              view === "chips"
                ? "bg-[#a35d4d] text-white"
                : "text-[var(--c-dim)] hover:text-[var(--c-ink-2)]"
            )}
          >
            <LayoutList className="size-3.5" />
            List
          </button>
          <button
            type="button"
            onClick={() => setView("grid")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors",
              view === "grid"
                ? "bg-[#a35d4d] text-white"
                : "text-[var(--c-dim)] hover:text-[var(--c-ink-2)]"
            )}
          >
            <Grid3x3 className="size-3.5" />
            Grid
          </button>
        </div>
      </div>

      {/* Mandala core (central focus) */}
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel-soft)] px-4 py-3">
        <span className="text-[12px] font-semibold tracking-[0.04em] text-[var(--c-dim)] uppercase">
          Core
        </span>
        {editingCore ? (
          <input
            autoFocus
            value={coreDraft}
            onChange={(e) => setCoreDraft(e.target.value)}
            onBlur={commitCore}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setCoreDraft(mandalaCore);
                setEditingCore(false);
              }
            }}
            placeholder="Your central focus…"
            maxLength={60}
            className="flex-1 rounded-lg border border-[#a35d4d]/40 bg-[var(--c-panel)] px-3 py-1.5 text-[14px] font-medium text-[var(--c-ink-2)] outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setCoreDraft(mandalaCore);
              setEditingCore(true);
            }}
            className={cn(
              "flex-1 text-left text-[14px] font-medium hover:underline decoration-dashed underline-offset-2",
              mandalaCore ? "text-[var(--c-ink-2)]" : "text-[var(--c-dim)]"
            )}
          >
            {mandalaCore || "Set your central focus"}
          </button>
        )}
      </div>

      {/* Views */}
      {sortedThemes.length === 0 && !addingTheme ? (
        <div className="rounded-2xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] py-12 text-center text-sm text-[var(--c-dim)]">
          No themes yet. Add up to 8 life themes, each with the behaviours that
          define progress.
        </div>
      ) : view === "grid" ? (
        <MandalaGrid themes={sortedThemes} core={mandalaCore} today={today} />
      ) : (
        <div className="flex flex-col gap-3">
          {sortedThemes.map((theme) => (
            <ThemeCard key={theme.id} theme={theme} today={today} />
          ))}
        </div>
      )}

      {/* Add theme */}
      {addingTheme ? (
        <input
          autoFocus
          value={themeDraft}
          onChange={(e) => setThemeDraft(e.target.value)}
          onBlur={commitTheme}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setThemeDraft("");
              setAddingTheme(false);
            }
          }}
          placeholder="New theme, e.g. Health"
          maxLength={40}
          className="rounded-2xl border border-[#a35d4d]/40 bg-[var(--c-panel-soft)] px-4 py-3 text-[14px] text-[var(--c-ink-2)] placeholder:text-[var(--c-dim)] outline-none"
        />
      ) : (
        sortedThemes.length < 8 && (
          <button
            type="button"
            onClick={() => setAddingTheme(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] py-4 text-sm font-medium text-[var(--c-dim)] transition-colors hover:border-[#a35d4d]/50 hover:bg-[var(--c-beige-2)] hover:text-[#a35d4d]"
          >
            <Plus className="size-4" />
            Add a theme
          </button>
        )
      )}
    </section>
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

        {/* Success behaviours — Mandala */}
        <MandalaSection />
      </div>
    </div>
  );
}
