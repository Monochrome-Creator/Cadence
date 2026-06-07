"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import TextareaAutosize from "react-textarea-autosize";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { format, isValid, parseISO } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  FolderPlus,
  GripVertical,
  HelpCircle,
  ListFilter,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  Sparkles,
  Tags,
  Target,
  Timer,
  Trash2,
  X,
} from "lucide-react";

import {
  LIFE_PILLARS,
  TASK_STATUSES,
  clampPercent,
  computeL3Fraction,
  computeSubtaskRollups,
  effectiveTaskProgress,
  useProdStore,
  type Goal,
  type LifePillar,
  type Recurrence,
  type Subtask,
  type SubtaskLevel,
  type SubtaskRollup,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@/store/use-prod-store";
import { PILLAR_THEME } from "@/lib/life-pillars";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PRIORITIES: TaskPriority[] = ["Low", "Medium", "High", "Critical"];

/** Lower number = higher priority, used for sorting. */
const PRIORITY_ORDER: Record<TaskPriority, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

/** Muted, sophisticated pill palettes (soft background + deep text). */
const STATUS_PILL: Record<TaskStatus, string> = {
  "Working on it": "bg-[#f3e7d0] text-[#8a6d3b]",
  Stuck: "bg-[#f6e0e0] text-[#9b3b3b]",
  Done: "bg-[#e3ece0] text-[#4d7049]",
  "Not Started": "bg-[#efe9e0] text-[#8a7d6b]",
  Inbox: "bg-[#e9e6f0] text-[#6a5b88]",
};

const PRIORITY_PILL: Record<TaskPriority, string> = {
  Low: "bg-[#e7edf0] text-[#5b7488]",
  Medium: "bg-[#f3ecd9] text-[#8a763b]",
  High: "bg-[#f6e6da] text-[#a35d4d]",
  Critical: "bg-[#f4dede] text-[#9b3b3b]",
};

/** A category's color treatment: pill chip, left spine accent, full-card tint. */
type CategoryTheme = { pill: string; spine: string; tint: string };

/** Rotating palette of muted, premium color sets for custom categories. */
const CATEGORY_THEMES: CategoryTheme[] = [
  { pill: "bg-[#e3ece0] text-[#4d7049]", spine: "border-l-[#8aa877]", tint: "bg-[#f5f8f2]" }, // sage
  { pill: "bg-[#e7edf0] text-[#5b7488]", spine: "border-l-[#88a3b6]", tint: "bg-[#f3f7f9]" }, // muted blue
  { pill: "bg-[#f3ecd9] text-[#8a763b]", spine: "border-l-[#c6ac63]", tint: "bg-[#faf6ea]" }, // warm ochre
  { pill: "bg-[#efe3ea] text-[#8a5d72]", spine: "border-l-[#b98ca6]", tint: "bg-[#faf3f7]" }, // soft plum
  { pill: "bg-[#f5e3da] text-[#a35d4d]", spine: "border-l-[#cf8e77]", tint: "bg-[#fcf4ef]" }, // terracotta
  { pill: "bg-[#e0ebe8] text-[#4f7d72]", spine: "border-l-[#7aa99b]", tint: "bg-[#f3f8f6]" }, // soft teal
];

/** Neutral treatment for the default/empty "General" bucket — no card tint. */
const NEUTRAL_THEME: CategoryTheme = {
  pill: "bg-[#efe9e0] text-[#8a7d6b]",
  spine: "border-l-[var(--c-line-strong)]",
  tint: "",
};

/** Pin the canonical buckets to specific colors; hash anything custom. */
const CANONICAL_THEMES: Record<string, CategoryTheme> = {
  Work: CATEGORY_THEMES[0],
  Personal: CATEGORY_THEMES[1],
  Health: CATEGORY_THEMES[2],
  Learning: CATEGORY_THEMES[3],
};

/**
 * Resolves a stable color theme for any category string. Empty/"General" stay
 * neutral; the canonical names keep their hand-picked colors; every other
 * custom value is hashed deterministically onto the palette so the same label
 * always renders the same color across the board.
 */
function categoryTheme(category: string): CategoryTheme {
  const key = category.trim();
  if (!key || key === "General") return NEUTRAL_THEME;
  if (CANONICAL_THEMES[key]) return CANONICAL_THEMES[key];
  let sum = 0;
  for (let i = 0; i < key.length; i++) sum += key.charCodeAt(i);
  return CATEGORY_THEMES[sum % CATEGORY_THEMES.length];
}

/** Recurrence options + human labels for the row's repeat control. */
const RECURRENCES: Recurrence[] = [
  "none",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
];
const RECURRENCE_LABELS: Record<Recurrence, string> = {
  none: "No repeat",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

const PILL_TRIGGER =
  "h-auto w-auto justify-center gap-1 rounded-full border-0 px-3 py-2 text-xs font-medium shadow-none md:w-full md:py-1";

const GRID_COLS =
  "md:grid-cols-[minmax(240px,1.4fr)_108px_100px_108px_120px_76px_68px]";

/** Human-readable deadline: "29 May 2026" (two-digit day, abbr month, full year). */
const DEADLINE_FORMAT = "dd MMM yyyy";

/** All selectable micro-task depths. */
const SUBTASK_LEVELS: SubtaskLevel[] = ["L1", "L2", "L3"];

/** Progressive left indentation per nesting depth. */
const LEVEL_INDENT: Record<SubtaskLevel, string> = {
  L1: "ml-0",
  L2: "ml-6",
  L3: "ml-12",
};

/** Distinct badge tint per nesting depth. */
const LEVEL_BADGE: Record<SubtaskLevel, string> = {
  L1: "bg-[#a35d4d]/12 text-[#a35d4d]",
  L2: "bg-[var(--c-dim)]/18 text-[#8a7d6b]",
  L3: "bg-[#6f9e6a]/18 text-[#5f7d56]",
};

/** Click-to-cycle order for an existing micro-task's level badge. */
const NEXT_LEVEL: Record<SubtaskLevel, SubtaskLevel> = {
  L1: "L2",
  L2: "L3",
  L3: "L1",
};

/** One step deeper, used when inserting a child under a micro-task (L3 caps). */
const DEEPER_LEVEL: Record<SubtaskLevel, SubtaskLevel> = {
  L1: "L2",
  L2: "L3",
  L3: "L3",
};

type SortDirection = "none" | "desc" | "asc";
type CategorySort = "none" | "asc" | "desc";
type StatusFilter = TaskStatus | "all";

/**
 * Quick-glance status filter pills shown above the board. "All Active" (value
 * "all") shows every task and is the only state where manual drag-reorder is
 * enabled; the rest narrow the board to one status at a time.
 */
const STATUS_FILTER_PILLS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All Active" },
  { value: "Working on it", label: "Working on it" },
  { value: "Stuck", label: "Stuck" },
  { value: "Not Started", label: "Not Started" },
];

const CATEGORY_SORT_LABELS: Record<CategorySort, string> = {
  none: "Sort: Category",
  asc: "Category A–Z",
  desc: "Category Z–A",
};

/* -------------------------------------------------------------------------- */
/*                              Deadline helpers                              */
/* -------------------------------------------------------------------------- */

/** Pull a yyyy-MM-dd value out of a stored deadline string (or "" if none). */
function toDateInputValue(deadline: string): string {
  const match = deadline.match(/\d{4}-\d{2}-\d{2}/);
  if (!match) return "";
  return isValid(parseISO(match[0])) ? match[0] : "";
}

/** Render the stored deadline as the strict "29 May 2026" format. */
function formatDeadline(deadline: string): string {
  const iso = toDateInputValue(deadline);
  if (!iso) return "";
  return format(parseISO(iso), DEADLINE_FORMAT);
}

/** Tight "5 Jun" form for the inline micro-task deadline chips. */
function formatCompactDeadline(deadline: string): string {
  const iso = toDateInputValue(deadline);
  if (!iso) return "";
  return format(parseISO(iso), "d MMM");
}

/* -------------------------------------------------------------------------- */
/*                                Deadline field                              */
/* -------------------------------------------------------------------------- */

function DeadlineField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const display = formatDeadline(value);

  const openPicker = () => {
    const el = inputRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") {
      el.showPicker();
    } else {
      el.focus();
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openPicker}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md border border-transparent px-2 py-1.5 text-sm transition-colors hover:border-[var(--c-line)]",
          display ? "text-[var(--c-ink-3)]" : "text-[var(--c-faint)]"
        )}
      >
        <CalendarDays className="size-3.5 shrink-0 text-[var(--c-faint)]" />
        {display || "Set date"}
      </button>
      {/* Native picker drives the value; visually hidden but still focusable. */}
      <input
        ref={inputRef}
        type="date"
        value={toDateInputValue(value)}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Pick a deadline"
        className="pointer-events-none absolute bottom-0 left-2 size-0 opacity-0"
        tabIndex={-1}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                               Session stepper                              */
/* -------------------------------------------------------------------------- */

function SessionStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div
      className="group flex items-center justify-center gap-1 text-sm font-medium text-[var(--c-ink-3)]"
      title={`${value} focus sessions (25 min each) — hover to adjust or click to type`}
    >
      <button
        type="button"
        aria-label="Decrease sessions"
        disabled={value <= 0}
        onClick={() => onChange(value - 1)}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--c-faint)] opacity-100 transition-all hover:bg-[var(--c-beige)] hover:text-[#a35d4d] disabled:pointer-events-none disabled:opacity-30 md:size-5 md:opacity-0 md:group-hover:opacity-100 md:disabled:opacity-0"
      >
        <Minus className="size-3" />
      </button>

      <span className="flex items-center gap-1">
        <Timer className="size-4 shrink-0 text-[#a35d4d]" />
        <input
          type="number"
          min={0}
          value={value}
          aria-label="Pomodoro sessions logged"
          onChange={(e) => onChange(e.target.valueAsNumber || 0)}
          className="w-7 rounded-md border border-transparent bg-transparent px-0.5 py-0.5 text-center tabular-nums transition-colors hover:border-[var(--c-line)] focus-visible:border-[#a35d4d] focus-visible:bg-[var(--c-panel)] focus-visible:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </span>

      <button
        type="button"
        aria-label="Increase sessions"
        onClick={() => onChange(value + 1)}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--c-faint)] opacity-100 transition-all hover:bg-[var(--c-beige)] hover:text-[#a35d4d] md:size-5 md:opacity-0 md:group-hover:opacity-100"
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                         Compact micro-task controls                        */
/* -------------------------------------------------------------------------- */

/** Tiny inline deadline picker for a single micro-task row. */
function MicroDeadlineField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const display = formatCompactDeadline(value);

  const openPicker = () => {
    const el = inputRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") el.showPicker();
    else el.focus();
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={openPicker}
        title={display ? `Due ${display}` : "Set micro-task deadline"}
        aria-label={
          display ? `Deadline ${display}, click to change` : "Set micro-task deadline"
        }
        className={cn(
          "flex items-center gap-1 rounded-md border border-transparent px-1.5 py-1 text-[11px] transition-colors hover:border-[var(--c-line)]",
          display ? "text-[var(--c-ink-3)]" : "text-[var(--c-faint)]"
        )}
      >
        <CalendarDays className="size-3.5 shrink-0 text-[var(--c-faint)]" />
        {display && <span className="tabular-nums">{display}</span>}
      </button>
      <input
        ref={inputRef}
        type="date"
        value={toDateInputValue(value)}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Pick a micro-task deadline"
        className="pointer-events-none absolute bottom-0 left-1.5 size-0 opacity-0"
        tabIndex={-1}
      />
    </div>
  );
}

/**
 * Completion percent for a micro-task. Leaf rows (L3, or any row with no
 * children) get an editable 10%-step input; parent rows show a read-only,
 * auto-rolled-up average in a muted sage chip.
 */
function PercentControl({
  percent,
  editable,
  onChange,
}: {
  percent: number;
  editable: boolean;
  onChange: (next: number) => void;
}) {
  // While editing, the input shows its own draft string so the user can clear
  // the field (and type a fresh number) instead of fighting a controlled "0"
  // that snaps back on every keystroke. When not focused it just mirrors the
  // committed value, so no effect is needed to keep them in sync.
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const value = focused ? draft : String(percent);

  if (!editable) {
    return (
      <span
        title="Auto-calculated from the average of its sub-tasks"
        aria-label={`Rolled-up progress ${percent} percent`}
        className="flex shrink-0 items-center rounded-md bg-[var(--c-beige-2)] px-1.5 py-1 text-[11px] font-semibold tabular-nums text-[#5f7d56]"
      >
        {percent}%
      </span>
    );
  }
  return (
    <label
      title="Completion percent"
      className="flex shrink-0 items-center gap-0.5 rounded-md border border-[#6f9e6a]/40 bg-[var(--c-panel-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[#5f7d56] transition-colors focus-within:border-[#6f9e6a]"
    >
      <input
        type="number"
        min={0}
        max={100}
        step={10}
        value={value}
        aria-label="Completion percent"
        onFocus={(e) => {
          setDraft(String(percent));
          setFocused(true);
          e.target.select();
        }}
        onChange={(e) => {
          const raw = e.target.value;
          // Allow an empty field while editing — don't force it back to 0.
          if (raw === "") {
            setDraft("");
            return;
          }
          const next = clampPercent(e.target.valueAsNumber);
          // Canonicalise (strips leading zeros, clamps) and commit live.
          setDraft(String(next));
          onChange(next);
        }}
        onBlur={() => {
          setFocused(false);
          // An empty/invalid field on blur settles to 0.
          const next = draft === "" ? 0 : clampPercent(Number(draft));
          setDraft(String(next));
          onChange(next);
        }}
        className="w-7 border-0 bg-transparent p-0 text-right text-[11px] font-semibold tabular-nums text-[#5f7d56] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      %
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/*                          L1 / L2 / L3 guide tooltip                        */
/* -------------------------------------------------------------------------- */

/** Verbatim framework copy shown in the hover guide. */
const LEVEL_GUIDE: { level: SubtaskLevel; text: string }[] = [
  {
    level: "L1",
    text: "Level 1 (L1): The Parent / Phase. High-level outcome. Write using Nouns/Outcomes (e.g., 'E-Commerce Website Launch').",
  },
  {
    level: "L2",
    text: "Level 2 (L2): The Summary Task / Sub-Job. Aggregates progress of everything underneath it. Write using Noun + Verb or Category Names (e.g., 'Website Design').",
  },
  {
    level: "L3",
    text: "Level 3 (L3): The Work Package / Action Task. Bite-sized, actionable tasks taking 8–80 hours. Always start with an Action Verb (e.g., 'Design homepage wireframe').",
  },
];

/** Subtle "?" affordance that reveals the L1/L2/L3 guide on hover or focus. */
function LevelGuideTooltip() {
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label="L1/L2/L3 framework guide"
        className="flex size-9 items-center justify-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel-soft)] text-[var(--c-dim)] transition-colors hover:border-[#a35d4d]/30 hover:bg-[var(--c-beige-2)] hover:text-[#a35d4d]"
      >
        <HelpCircle className="size-4" />
      </button>
      <div
        role="tooltip"
        className="pointer-events-none absolute top-full right-0 z-50 mt-2 w-80 max-w-[calc(100vw-3rem)] origin-top-right rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] p-4 text-left opacity-0 shadow-[0_8px_30px_rgba(74,64,54,0.18)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <p className="mb-3 font-heading text-sm font-semibold text-[var(--c-ink-2)]">
          The L1 / L2 / L3 framework
        </p>
        <ul className="space-y-3">
          {LEVEL_GUIDE.map((guide) => (
            <li key={guide.level} className="flex gap-2">
              <span
                className={cn(
                  "mt-px h-fit shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
                  LEVEL_BADGE[guide.level]
                )}
              >
                {guide.level}
              </span>
              <p className="text-xs leading-snug text-[var(--c-dim)]">
                {guide.text}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                            Nested micro-task panel                         */
/* -------------------------------------------------------------------------- */

/** A single draggable micro-task row inside {@link MicroTaskPanel}. */
function SortableMicroTask({
  taskId,
  subtask,
  roll,
  focusId,
  setFocusId,
  updateSubtask,
  toggleComplete,
  deleteSubtask,
  insertChild,
}: {
  taskId: string;
  subtask: Subtask;
  roll: SubtaskRollup | undefined;
  focusId: string | null;
  setFocusId: (id: string | null) => void;
  updateSubtask: ReturnType<typeof useProdStore.getState>["updateSubtask"];
  toggleComplete: ReturnType<typeof useProdStore.getState>["toggleSubtaskComplete"];
  deleteSubtask: ReturnType<typeof useProdStore.getState>["deleteSubtask"];
  insertChild: (subtaskId: string, level: SubtaskLevel) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: subtask.id });

  const done = subtask.status === "done";
  const nested = subtask.level !== "L1";

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group/sub flex items-stretch",
        // Each tier nests one indentation step deeper.
        LEVEL_INDENT[subtask.level],
        isDragging && "relative z-10 opacity-80"
      )}
    >
      {/* Vertical guide line clarifies the nesting hierarchy. */}
      {nested && (
        <span
          aria-hidden
          className="mr-2 w-px shrink-0 self-stretch bg-[var(--c-line-strong)]"
        />
      )}

      <div className="flex flex-1 items-start gap-2 rounded-lg bg-[var(--c-panel-soft)] px-2 py-1.5">
        {/* Drag handle — hover-revealed, reorders this row up/down. */}
        <button
          type="button"
          aria-label="Drag to reorder micro-task"
          className="mt-0.5 flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-[var(--c-faint)] opacity-0 transition-all hover:text-[#a35d4d] focus-visible:opacity-100 group-hover/sub:opacity-100 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>

        <button
          type="button"
          aria-label={done ? "Mark as to-do" : "Mark as done"}
          onClick={() => toggleComplete(taskId, subtask.id)}
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
            done
              ? "border-[#6f9e6a] bg-[#6f9e6a] text-white"
              : "border-[var(--c-line-strong)] text-transparent hover:border-[#a35d4d]"
          )}
        >
          <Check className="size-3" />
        </button>

        {/* Click the badge to cycle this micro-task's depth. */}
        <button
          type="button"
          onClick={() =>
            updateSubtask(taskId, subtask.id, {
              level: NEXT_LEVEL[subtask.level],
            })
          }
          title={`Level ${subtask.level} — click to change depth`}
          aria-label={`Micro-task level ${subtask.level}, click to cycle`}
          className={cn(
            "mt-0.5 shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide transition-transform hover:scale-105 active:scale-95",
            LEVEL_BADGE[subtask.level]
          )}
        >
          {subtask.level}
        </button>

        <TextareaAutosize
          value={subtask.title}
          onChange={(e) =>
            updateSubtask(taskId, subtask.id, {
              title: e.target.value,
            })
          }
          ref={
            focusId === subtask.id
              ? (el) => {
                  if (el) {
                    el.focus();
                    setFocusId(null);
                  }
                }
              : undefined
          }
          placeholder="Micro-task…"
          rows={1}
          className={cn(
            "mt-px min-w-0 flex-1 resize-none rounded border border-transparent bg-transparent px-1 py-0.5 text-sm leading-snug outline-none transition-colors hover:border-[var(--c-line)] focus:border-[#a35d4d] focus:bg-[var(--c-panel)]",
            done ? "text-[var(--c-faint)] line-through" : "text-[var(--c-ink-2)]"
          )}
        />

        {/* Completion percent — editable on leaves, rolled-up on parents. */}
        <span className="mt-0.5 flex shrink-0 items-center gap-1">
          <PercentControl
            percent={roll?.percent ?? 0}
            editable={roll?.editable ?? true}
            onChange={(next) =>
              updateSubtask(taskId, subtask.id, { percent: next })
            }
          />
          <MicroDeadlineField
            value={subtask.deadline ?? ""}
            onChange={(next) =>
              updateSubtask(taskId, subtask.id, { deadline: next })
            }
          />
        </span>

        {/* Hover-revealed inline "add child" affordance. */}
        <button
          type="button"
          onClick={() => insertChild(subtask.id, subtask.level)}
          title={`Add ${DEEPER_LEVEL[subtask.level]} below`}
          aria-label={`Add ${DEEPER_LEVEL[subtask.level]} micro-task below`}
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-[var(--c-faint)] opacity-0 transition-all hover:bg-[var(--c-beige)] hover:text-[#a35d4d] focus-visible:opacity-100 group-hover/sub:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>

        {/* Hover-revealed delete — drops this row and its children. */}
        <button
          type="button"
          onClick={() => deleteSubtask(taskId, subtask.id)}
          title={`Delete this ${subtask.level} micro-task`}
          aria-label={`Delete ${subtask.level} micro-task`}
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-[var(--c-faint)] opacity-0 transition-all hover:bg-[#f6e0e0] hover:text-[#9b3b3b] focus-visible:opacity-100 group-hover/sub:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function MicroTaskPanel({ task }: { task: Task }) {
  const updateTask = useProdStore((state) => state.updateTask);
  const addSubtask = useProdStore((state) => state.addSubtask);
  const updateSubtask = useProdStore((state) => state.updateSubtask);
  const insertSubtaskAfter = useProdStore((state) => state.insertSubtaskAfter);
  const deleteSubtask = useProdStore((state) => state.deleteSubtask);
  const reorderSubtasks = useProdStore((state) => state.reorderSubtasks);
  const toggleSubtaskComplete = useProdStore(
    (state) => state.toggleSubtaskComplete
  );

  // Isolated sensors for the nested micro-task list so dragging a row never
  // bubbles up to the board's card-level drag context.
  const subtaskSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleSubtaskDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorderSubtasks(task.id, String(active.id), String(over.id));
    }
  };

  const [newSubtask, setNewSubtask] = useState("");
  const [newLevel, setNewLevel] = useState<SubtaskLevel>("L1");
  // Id of a freshly inserted micro-task whose field should grab focus.
  const [focusId, setFocusId] = useState<string | null>(null);

  const commitSubtask = () => {
    const title = newSubtask.trim();
    if (!title) return;
    addSubtask(task.id, title, newLevel);
    setNewSubtask("");
  };

  // Insert a blank child one level deeper, directly below `subtask`.
  const insertChild = (subtaskId: string, level: SubtaskLevel) => {
    const newId = insertSubtaskAfter(task.id, subtaskId, DEEPER_LEVEL[level]);
    if (newId) setFocusId(newId);
  };

  // Per-row completion: leaves keep their own percent; parents average children.
  const rollups = computeSubtaskRollups(task.subtasks);

  return (
    <div className="border-t border-[var(--c-line-2)] p-3 md:pl-12">
      {/* Warmer beige skin wrapping all micro-tasks */}
      <div className="rounded-xl bg-[var(--c-beige)] p-3">
        {/* Sub-category — second-level grouping within the task's category. */}
        <label className="mb-3 flex items-center gap-2 px-1">
          <span className="text-[11px] font-semibold tracking-wide text-[var(--c-dim)] uppercase">
            Sub-category
          </span>
          <input
            value={task.subcategory}
            onChange={(e) =>
              updateTask(task.id, { subcategory: e.target.value })
            }
            placeholder="e.g. Planning, Bug fixes…"
            aria-label="Task sub-category"
            className="min-w-0 flex-1 rounded-full border border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] px-3 py-1 text-xs font-medium text-[var(--c-ink-3)] outline-none transition-colors placeholder:text-[var(--c-faint)] focus:border-[#a35d4d] focus:ring-2 focus:ring-[#a35d4d]/20"
          />
        </label>

        <p className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-[var(--c-dim)] uppercase">
          Micro-tasks
        </p>

        <div className="space-y-1">
          {task.subtasks.length === 0 && (
            <p className="px-1 py-1 text-xs text-[var(--c-faint)]">
              No micro-tasks yet. Break this down below.
            </p>
          )}

          <DndContext
            sensors={subtaskSensors}
            collisionDetection={closestCorners}
            onDragEnd={handleSubtaskDragEnd}
          >
            <SortableContext
              items={task.subtasks.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {task.subtasks.map((subtask) => (
                <SortableMicroTask
                  key={subtask.id}
                  taskId={task.id}
                  subtask={subtask}
                  roll={rollups[subtask.id]}
                  focusId={focusId}
                  setFocusId={setFocusId}
                  updateSubtask={updateSubtask}
                  toggleComplete={toggleSubtaskComplete}
                  deleteSubtask={deleteSubtask}
                  insertChild={insertChild}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {/* Add micro-task row */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Sleek segmented pill toggle — choose depth before typing. */}
          <div
            role="group"
            aria-label="Micro-task depth"
            className="flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] p-0.5"
          >
            {SUBTASK_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setNewLevel(level)}
                aria-pressed={newLevel === level}
                title={`Add as ${level} micro-task`}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all",
                  newLevel === level
                    ? "bg-[#a35d4d] text-white shadow-[0_1px_2px_rgba(74,64,54,0.18)]"
                    : "text-[var(--c-dim)] hover:text-[#a35d4d]"
                )}
              >
                {level}
              </button>
            ))}
          </div>
          <Input
            value={newSubtask}
            onChange={(e) => setNewSubtask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitSubtask();
            }}
            placeholder={`New ${newLevel} micro-task…`}
            className="h-8 min-w-0 flex-1 border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] text-sm text-[var(--c-ink-2)] shadow-none focus-visible:border-[#a35d4d]"
          />
          <Button
            size="sm"
            onClick={commitSubtask}
            disabled={newSubtask.trim().length === 0}
            className="h-8 shrink-0 bg-[#a35d4d] text-white hover:bg-[#8f4f41] disabled:opacity-40"
          >
            <Plus className="size-3.5" />
            Add Micro-task
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Sortable task card                            */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*                          Life Pillar selector pill                          */
/* -------------------------------------------------------------------------- */
/**
 * Compact, colored pill that both displays a task's life pillar and lets the
 * user reassign it inline. Renders a muted "+ Pillar" affordance when unset.
 * Used on the board card meta row and the new-task composer. The `"none"`
 * sentinel maps to/from an unset (undefined) pillar.
 */
function PillarSelect({
  value,
  onChange,
}: {
  value: LifePillar | undefined;
  onChange: (next: LifePillar | undefined) => void;
}) {
  return (
    <Select
      value={value ?? "none"}
      onValueChange={(next) =>
        onChange(next === "none" ? undefined : (next as LifePillar))
      }
    >
      <SelectTrigger
        aria-label="Set life pillar"
        title={value ? `Pillar: ${PILLAR_THEME[value].label}` : "Assign a life pillar"}
        className={cn(
          "h-auto w-auto justify-center gap-1 rounded-full border-0 px-2 py-0.5 text-[11px] font-medium shadow-none [&>svg:last-child]:hidden",
          value
            ? PILLAR_THEME[value].badge
            : "bg-[var(--c-panel-soft)] text-[var(--c-dim)] hover:text-[#a35d4d]"
        )}
      >
        {value ? (
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3" />
            {PILLAR_THEME[value].label}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Plus className="size-3" />
            Pillar
          </span>
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No pillar</SelectItem>
        {LIFE_PILLARS.map((pillar) => (
          <SelectItem key={pillar} value={pillar}>
            <span className={cn("size-2 rounded-full", PILLAR_THEME[pillar].dot)} />
            {PILLAR_THEME[pillar].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* -------------------------------------------------------------------------- */
/*                          North Star goal selector                           */
/* -------------------------------------------------------------------------- */
/**
 * Compact pill that shows the linked goal title (truncated) or a muted
 * "+ Goal" affordance. Uses the same icon-only trigger pattern as PillarSelect.
 * "none" sentinel maps to an unset (undefined) goalId.
 */
function GoalSelect({
  value,
  goals,
  onChange,
}: {
  value: string | undefined;
  goals: Goal[];
  onChange: (next: string | undefined) => void;
}) {
  const active = goals.filter((g) => g.status === "active");
  const linked = goals.find((g) => g.id === value);
  return (
    <Select
      value={value ?? "none"}
      onValueChange={(next) =>
        onChange(!next || next === "none" ? undefined : next)
      }
    >
      <SelectTrigger
        aria-label="Link to a goal"
        title={linked ? `Goal: ${linked.title}` : "Link to a North Star goal"}
        className={cn(
          "h-auto w-auto max-w-[140px] justify-center gap-1 rounded-full border-0 px-2 py-0.5 text-[11px] font-medium shadow-none [&>svg:last-child]:hidden",
          linked
            ? "bg-[#f6e6da] text-[#a35d4d]"
            : "bg-[var(--c-panel-soft)] text-[var(--c-dim)] hover:text-[#a35d4d]"
        )}
      >
        <span className="inline-flex items-center gap-1 truncate">
          <Target className="size-3 shrink-0" />
          <span className="truncate">
            {linked ? linked.title : "Goal"}
          </span>
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No goal</SelectItem>
        {active.length === 0 ? (
          <SelectItem value="__empty__" disabled>
            No active goals yet
          </SelectItem>
        ) : (
          active.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.title}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

function SortableTaskCard({
  task,
  isActive,
  dragEnabled,
}: {
  task: Task;
  isActive: boolean;
  dragEnabled: boolean;
}) {
  const updateTask = useProdStore((state) => state.updateTask);
  const updateTaskSessions = useProdStore((state) => state.updateTaskSessions);
  const deleteTask = useProdStore((state) => state.deleteTask);
  const addCategory = useProdStore((state) => state.addCategory);
  const setActiveTask = useProdStore((state) => state.setActiveTask);
  const completeAndRepeatTask = useProdStore(
    (state) => state.completeAndRepeatTask
  );
  const goals = useProdStore((state) => state.goals);

  // A task with no micro-tasks owns an editable manual percentage; once it has
  // children, progress becomes the read-only roll-up of their completion.
  const hasSubtasks = task.subtasks.length > 0;
  const isDone = task.status === "Done";

  // Marking a recurring task Done regenerates the next occurrence instead of a
  // plain status write. Leaving Done clears a stale manual 100% so the bar and
  // status stay in agreement (only relevant for childless tasks).
  const handleStatusChange = (next: TaskStatus) => {
    if (next === "Done" && task.recurrence !== "none") {
      completeAndRepeatTask(task.id);
    } else if (next === "Done") {
      updateTask(task.id, { status: "Done", ...(hasSubtasks ? {} : { progress: 100 }) });
    } else {
      updateTask(task.id, {
        status: next,
        ...(!hasSubtasks && isDone ? { progress: 0 } : {}),
      });
    }
  };

  // Manual percentage field (shown only on childless tasks). Hitting 100% marks
  // the task Done; dropping back below reopens it so the bar tracks the field.
  const handleProgressChange = (next: number) => {
    if (next >= 100) {
      if (task.recurrence !== "none") completeAndRepeatTask(task.id);
      else updateTask(task.id, { progress: 100, status: "Done" });
    } else {
      updateTask(task.id, {
        progress: next,
        ...(isDone ? { status: "Working on it" as TaskStatus } : {}),
      });
    }
  };

  // Completion circle next to the title — force-complete (or reopen) the task.
  const handleToggleComplete = () => {
    if (isDone) {
      updateTask(task.id, {
        status: "Working on it",
        ...(hasSubtasks ? {} : { progress: 0 }),
      });
    } else if (task.recurrence !== "none") {
      completeAndRepeatTask(task.id);
    } else {
      updateTask(task.id, {
        status: "Done",
        ...(hasSubtasks ? {} : { progress: 100 }),
      });
    }
  };

  const [expanded, setExpanded] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: !dragEnabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const doneCount = task.subtasks.filter((s) => s.status === "done").length;
  // Overall completion: Done → 100, else the L1 roll-up, else the manual %.
  const progress = effectiveTaskProgress(task);
  // Fraction badge: completed L3 action tasks over total L3s. Falls back to the
  // plain done/total of all micro-tasks when the card has no L3s yet.
  const l3 = computeL3Fraction(task.subtasks);
  const fractionDone = l3.total > 0 ? l3.done : doneCount;
  const fractionTotal = l3.total > 0 ? l3.total : task.subtasks.length;
  // Color-codes the whole card by category for at-a-glance grouping.
  const theme = categoryTheme(task.category);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-xl border border-l-4 border-[var(--c-line)] bg-[var(--c-panel-soft)] shadow-[0_1px_4px_rgba(74,64,54,0.04)] transition-shadow hover:shadow-[0_4px_14px_rgba(74,64,54,0.07)]",
        theme.spine,
        theme.tint,
        // Dark mode flattens the pale category tints to a single warm panel.
        "dark:bg-[var(--c-panel)]",
        isActive && "border-[#a35d4d]/40 ring-2 ring-[#a35d4d]/25",
        // The original collapses to a faint placeholder while the overlay floats.
        isDragging && "opacity-40"
      )}
    >
      {/* Main row — stacks on mobile, becomes a 6-column grid on desktop. */}
      <div
        className={cn(
          "flex flex-col gap-3 p-4 md:grid md:items-center md:gap-4",
          GRID_COLS
        )}
      >
        {/* Drag handle + expand chevron + focus + title */}
        <div className="flex min-w-0 items-start gap-1.5 md:items-center">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            disabled={!dragEnabled}
            className={cn(
              // Hidden on mobile: a 24px touch-drag handle is impractical and
              // crowds the title. Reordering stays available on desktop.
              "hidden size-6 shrink-0 items-center justify-center rounded-md text-[var(--c-line-strong)] transition-colors md:flex",
              dragEnabled
                ? "cursor-grab hover:bg-[var(--c-beige)] hover:text-[var(--c-dim)] active:cursor-grabbing"
                : "cursor-not-allowed opacity-30"
            )}
            title={
              dragEnabled
                ? "Drag to reorder"
                : "Clear sort & filter to reorder manually"
            }
          >
            <GripVertical className="size-4" />
          </button>

          {/* Collapse / expand chevron — far left of the row */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse micro-tasks" : "Expand micro-tasks"}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--c-dim)] transition-colors hover:bg-[var(--c-beige)] hover:text-[#a35d4d]"
          >
            <ChevronRight
              className={cn(
                "size-4 transition-transform duration-300 ease-out",
                expanded && "rotate-90"
              )}
            />
          </button>

          <button
            type="button"
            title={isActive ? "Active focus task" : "Set as focus task"}
            onClick={() => setActiveTask(isActive ? null : task.id)}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
              isActive
                ? "bg-[#a35d4d] text-white"
                : "bg-[var(--c-beige)] text-[var(--c-dim)] hover:bg-[var(--c-beige-2)] hover:text-[#a35d4d]"
            )}
          >
            <Target className="size-3.5" />
          </button>

          {/* Completion circle — force-complete (or reopen) the whole task. */}
          <button
            type="button"
            onClick={handleToggleComplete}
            aria-label={isDone ? "Mark task as not done" : "Mark task complete"}
            title={isDone ? "Completed — click to reopen" : "Mark complete"}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors",
              isDone
                ? "border-[#6f9e6a] bg-[#6f9e6a] text-white"
                : "border-[var(--c-line-strong)] text-transparent hover:border-[#6f9e6a] hover:text-[#6f9e6a]"
            )}
          >
            <Check className="size-3.5" />
          </button>

          {/* Title gets its own full-width column; the subtask count rides
              alongside, and the sub-category sits on its own line below so it
              never squeezes the title. */}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <TextareaAutosize
                value={task.title}
                onChange={(e) => updateTask(task.id, { title: e.target.value })}
                placeholder="Untitled task"
                rows={1}
                className="min-w-0 flex-1 resize-none rounded-md border border-transparent bg-transparent px-2 py-1 text-base leading-snug font-medium break-words text-[var(--c-ink-2)] outline-none transition-colors hover:border-[var(--c-line)] focus:border-[#a35d4d] md:text-sm"
              />

              {task.subtasks.length > 0 && (
                <span className="shrink-0 rounded-full bg-[var(--c-beige)] px-2 py-0.5 text-[11px] font-medium text-[var(--c-dim)]">
                  {fractionDone}/{fractionTotal}
                </span>
              )}
            </div>

            <div className="ml-2 flex flex-wrap items-center gap-1.5">
              <PillarSelect
                value={task.lifePillar}
                onChange={(next) => updateTask(task.id, { lifePillar: next })}
              />
              <GoalSelect
                value={task.goalId}
                goals={goals}
                onChange={(next) => updateTask(task.id, { goalId: next })}
              />
              {task.subcategory.trim() && (
                <span
                  title={`Sub-category: ${task.subcategory}`}
                  className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-[var(--c-panel-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--c-dim)]"
                >
                  <CornerDownRight className="size-3 shrink-0 text-[var(--c-faint)]" />
                  {task.subcategory}
                </span>
              )}
              {task.recurrence !== "none" && (
                <span
                  title={`Repeats ${RECURRENCE_LABELS[task.recurrence]}`}
                  className="inline-flex items-center gap-1 rounded-full bg-[#f6e6da] px-2 py-0.5 text-[11px] font-medium text-[#a35d4d]"
                >
                  <Repeat className="size-3 shrink-0" />
                  {RECURRENCE_LABELS[task.recurrence]}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Secondary controls: a tidy 2-column grid on mobile (Status | Priority,
            full-width Category, Sessions | Actions); flattened into the desktop
            grid columns via display:contents (md:contents), so these base grid
            classes never affect the desktop layout. */}
        <div className="grid grid-cols-2 items-center gap-2 md:contents">
          {/* Status pill */}
          <Select
          value={task.status}
          onValueChange={(value) => handleStatusChange(value as TaskStatus)}
        >
          <SelectTrigger className={cn(PILL_TRIGGER, STATUS_PILL[task.status])}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TASK_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Priority pill */}
        <Select
          value={task.priority}
          onValueChange={(value) =>
            updateTask(task.id, { priority: value as TaskPriority })
          }
        >
          <SelectTrigger
            className={cn(PILL_TRIGGER, PRIORITY_PILL[task.priority])}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITIES.map((priority) => (
              <SelectItem key={priority} value={priority}>
                {priority}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Category — free-text, color-coded pill */}
        <input
          value={task.category}
          onChange={(e) => updateTask(task.id, { category: e.target.value })}
          onBlur={(e) => {
            // Register a typed-in category so its column persists even when empty.
            const value = e.target.value.trim();
            if (value) addCategory(value);
          }}
          placeholder="Category"
          aria-label="Task category"
          className={cn(
            "col-span-2 h-auto w-full min-w-0 rounded-full border-0 px-3 py-2 text-center text-xs font-medium shadow-none outline-none transition-colors placeholder:text-[var(--c-faint)] focus:ring-2 focus:ring-[#a35d4d]/25 md:col-auto md:w-full md:py-1",
            theme.pill
          )}
        />

        {/* Deadline (date-fns formatted) — hidden on small phone screens */}
        <div className="hidden md:block">
          <DeadlineField
            value={task.deadline}
            onChange={(next) => updateTask(task.id, { deadline: next })}
          />
        </div>

        {/* Pomodoro sessions — manually editable stepper */}
        <SessionStepper
          value={task.pomodorosLogged}
          onChange={(next) => updateTaskSessions(task.id, next)}
        />

          {/* Actions: recurrence + delete */}
          <div className="ml-auto flex items-center justify-center gap-1 md:ml-0">
            {/* Recurrence — subtle loop button; tinted when a repeat is set */}
            <Select
              value={task.recurrence}
              onValueChange={(value) =>
                updateTask(task.id, { recurrence: value as Recurrence })
              }
            >
              <SelectTrigger
                aria-label="Set recurrence"
                title={`Repeat: ${RECURRENCE_LABELS[task.recurrence]}`}
                className={cn(
                  "size-10 w-10 shrink-0 justify-center gap-0 rounded-full border-0 p-0 shadow-none md:size-8 md:w-8 [&>svg:last-child]:hidden",
                  task.recurrence !== "none"
                    ? "bg-[#f6e6da] text-[#a35d4d]"
                    : "bg-transparent text-[var(--c-faint)] hover:bg-[var(--c-beige)] hover:text-[#a35d4d]"
                )}
              >
                <Repeat className="size-4" />
              </SelectTrigger>
              <SelectContent>
                {RECURRENCES.map((recurrence) => (
                  <SelectItem key={recurrence} value={recurrence}>
                    {RECURRENCE_LABELS[recurrence]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <button
              type="button"
              title="Delete task"
              onClick={() => deleteTask(task.id)}
              className="flex size-10 items-center justify-center rounded-full text-[var(--c-faint)] transition-colors hover:bg-[#f6e0e0] hover:text-[#9b3b3b] md:size-8"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Overall progress. With micro-tasks it's the read-only L1 roll-up; with
          none, the percentage field is manually editable (and hitting 100%
          completes the task). */}
      <div className="-mt-1 flex items-center gap-2 px-4 pb-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--c-beige)]">
          <div
            className="h-full rounded-full bg-[#6f9e6a] transition-[width] duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <PercentControl
          percent={progress}
          editable={!hasSubtasks}
          onChange={handleProgressChange}
        />
      </div>

      {/* Smoothly animated micro-task compartment */}
      <div
        className={cn(
          "grid transition-all duration-300 ease-out",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          {/* Mobile-only: the Deadline column is hidden in the row on phones,
              so it's surfaced here in the expandable view instead of dropped. */}
          <div className="border-t border-[var(--c-line-2)] px-4 py-3 md:hidden">
            <p className="mb-1 text-[11px] font-semibold tracking-wide text-[var(--c-dim)] uppercase">
              Deadline
            </p>
            <DeadlineField
              value={task.deadline}
              onChange={(next) => updateTask(task.id, { deadline: next })}
            />
          </div>

          <MicroTaskPanel task={task} />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                         Floating drag-overlay card                         */
/* -------------------------------------------------------------------------- */

function TaskDragOverlayCard({ task }: { task: Task }) {
  const doneCount = task.subtasks.filter((s) => s.status === "done").length;
  const l3 = computeL3Fraction(task.subtasks);
  const fractionDone = l3.total > 0 ? l3.done : doneCount;
  const fractionTotal = l3.total > 0 ? l3.total : task.subtasks.length;
  const deadline = formatDeadline(task.deadline);
  const theme = categoryTheme(task.category);

  return (
    <div
      className={cn(
        "flex cursor-grabbing items-center gap-3 rounded-xl border border-l-4 border-[var(--c-line)] bg-[var(--c-cream)] p-4 shadow-[0_18px_44px_rgba(74,64,54,0.22)]",
        theme.spine,
        theme.tint,
        "dark:bg-[var(--c-panel)]"
      )}
    >
      <GripVertical className="size-4 shrink-0 text-[#a35d4d]" />
      <span className="flex-1 truncate font-medium text-[var(--c-ink-2)]">
        {task.title || "Untitled task"}
      </span>
      {task.category.trim() && (
        <span
          className={cn(
            "shrink-0 rounded-full px-3 py-1 text-xs font-medium",
            theme.pill
          )}
        >
          {task.category}
        </span>
      )}
      {task.lifePillar && (
        <span
          className={cn(
            "hidden shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium sm:inline-flex",
            PILLAR_THEME[task.lifePillar].badge
          )}
        >
          <Sparkles className="size-3" />
          {PILLAR_THEME[task.lifePillar].label}
        </span>
      )}
      <span
        className={cn(
          "shrink-0 rounded-full px-3 py-1 text-xs font-medium",
          STATUS_PILL[task.status]
        )}
      >
        {task.status}
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full px-3 py-1 text-xs font-medium",
          PRIORITY_PILL[task.priority]
        )}
      >
        {task.priority}
      </span>
      {deadline && (
        <span className="hidden shrink-0 items-center gap-1.5 text-sm text-[var(--c-ink-3)] sm:flex">
          <CalendarDays className="size-3.5 text-[var(--c-faint)]" />
          {deadline}
        </span>
      )}
      {task.subtasks.length > 0 && (
        <span className="shrink-0 rounded-full bg-[var(--c-beige)] px-2 py-0.5 text-[11px] font-medium text-[var(--c-dim)]">
          {fractionDone}/{fractionTotal}
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                         Sortable category section                          */
/* -------------------------------------------------------------------------- */

/**
 * Wraps an entire category section (header + tasks + add-row) in a sortable
 * container so the whole group can be drag-reordered on the board.
 *
 * The drag handle lives inside the section header — the component passes
 * `dragHandleProps` via a render prop so the handle button can sit precisely
 * inside the existing header row without a wrapper div between them.
 */
function SortableCategorySection({
  id,
  dragEnabled,
  children,
}: {
  id: string;
  dragEnabled: boolean;
  children: (dragHandleProps: React.HTMLAttributes<HTMLElement>) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, data: { type: "section" }, disabled: !dragEnabled });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn("relative", isDragging && "opacity-40")}
    >
      {children({ ...attributes, ...listeners })}
    </div>
  );
}

/**
 * Lightweight floating ghost shown while a category section is being dragged.
 * Mirrors the section header's visual weight without rendering all child cards.
 */
function CategoryDragOverlayHeader({
  category,
  count,
}: {
  category: string;
  count: number;
}) {
  const theme = categoryTheme(category);
  return (
    <div className="flex cursor-grabbing items-center gap-3 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] px-5 py-3.5 shadow-[0_18px_44px_rgba(74,64,54,0.18)]">
      <GripVertical className="size-4 shrink-0 text-[#a35d4d]" />
      <span className="font-heading text-xl font-semibold tracking-tight text-[var(--c-ink-2)]">
        {category}
      </span>
      <span
        className={cn(
          "rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
          theme.pill
        )}
      >
        {count}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                          Droppable category column                         */
/* -------------------------------------------------------------------------- */

/**
 * A category's card stack, registered as a droppable so a task can be dropped
 * into the empty area of a column (not just onto another card). The `column`
 * data tag lets the drag handlers tell a column target apart from a card.
 */
function CategoryDropZone({
  category,
  children,
}: {
  category: string;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({
    id: `column:${category}`,
    data: { type: "column", category },
  });
  return (
    <div ref={setNodeRef} className="space-y-4">
      {children}
    </div>
  );
}

/**
 * Resolve which category column a drop target belongs to. A card target carries
 * its container id via dnd-kit's `sortable` data; a bare column target carries
 * our own `{ type: "column", category }` tag.
 */
function resolveDropCategory(over: DragOverEvent["over"]): string | null {
  if (!over) return null;
  const data = over.data.current;
  if (data?.type === "column" && typeof data.category === "string") {
    return data.category;
  }
  const containerId = data?.sortable?.containerId;
  return typeof containerId === "string" ? containerId : null;
}

/* -------------------------------------------------------------------------- */
/*                                 Board page                                 */
/* -------------------------------------------------------------------------- */

export default function BoardPage() {
  const tasks = useProdStore((state) => state.tasks);
  const categories = useProdStore((state) => state.categories);
  const activeTaskId = useProdStore((state) => state.activeTaskId);
  const addTask = useProdStore((state) => state.addTask);
  const reorderTasks = useProdStore((state) => state.reorderTasks);
  const moveTask = useProdStore((state) => state.moveTask);
  const addCategory = useProdStore((state) => state.addCategory);
  const renameCategory = useProdStore((state) => state.renameCategory);
  const deleteCategory = useProdStore((state) => state.deleteCategory);
  const reorderCategories = useProdStore((state) => state.reorderCategories);
  const forceSync = useProdStore((state) => state.forceSync);

  // Manual cloud refresh — spins the icon while the round-trip is in flight.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      // forceSync never throws (it fails soft to offline), so this is safe.
      await forceSync();
    } finally {
      setIsRefreshing(false);
    }
  };

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showCompleted, setShowCompleted] = useState(false);
  const [sortDirection, setSortDirection] = useState<SortDirection>("none");
  const [categorySort, setCategorySort] = useState<CategorySort>("none");

  // Which category section currently has its inline "add task" row open.
  const [addingCategory, setAddingCategory] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  // Optional life pillar to stamp on the task being composed.
  const [newPillar, setNewPillar] = useState<LifePillar | undefined>(undefined);

  // Inline category header rename + the bottom "new category" composer.
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  // Task currently being dragged — drives the floating task DragOverlay.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Category section being dragged — drives the floating section DragOverlay.
  const [draggingCategory, setDraggingCategory] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Manual drag only makes sense on the full, unsorted list.
  const dragEnabled =
    statusFilter === "all" &&
    sortDirection === "none" &&
    categorySort === "none";

  const visibleTasks = useMemo(() => {
    // Inbox tasks are a separate holding pen (see /inbox) and never appear on
    // the board until the user promotes them to another status. Done tasks also
    // leave the active groups — they collect in the collapsible "Completed"
    // section at the bottom of the board.
    const boardTasks = tasks.filter(
      (task) => task.status !== "Inbox" && task.status !== "Done"
    );
    const filtered =
      statusFilter === "all"
        ? boardTasks
        : boardTasks.filter((task) => task.status === statusFilter);

    // Category sort takes precedence when active. Group by main category, then
    // by sub-category so related jobs cluster together as you scroll.
    if (categorySort !== "none") {
      return [...filtered].sort((a, b) => {
        const diff =
          a.category.localeCompare(b.category) ||
          a.subcategory.localeCompare(b.subcategory);
        return categorySort === "asc" ? diff : -diff;
      });
    }

    if (sortDirection === "none") {
      // Respect the manual drag-and-drop order.
      return [...filtered].sort((a, b) => a.order - b.order);
    }

    return [...filtered].sort((a, b) => {
      const diff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return sortDirection === "desc" ? diff : -diff;
    });
  }, [tasks, statusFilter, sortDirection, categorySort]);

  // Group the visible tasks by master category for the grouped-board layout.
  // Columns come from the managed `categories` list (so empty ones persist),
  // plus any orphan categories present on tasks but not yet in the list. Each
  // entry is [category, tasksInThatCategory], preserving the within-group order
  // already established by visibleTasks (manual order / priority sort).
  const sections = useMemo<[string, Task[]][]>(() => {
    const map = new Map<string, Task[]>();
    for (const task of visibleTasks) {
      const key = task.category.trim() || "General";
      const bucket = map.get(key);
      if (bucket) bucket.push(task);
      else map.set(key, [task]);
    }

    // Managed columns first (in their saved order), then any orphan categories.
    const names = [...categories];
    for (const key of map.keys()) {
      if (!names.includes(key)) names.push(key);
    }

    if (categorySort === "asc") {
      names.sort((a, b) => a.localeCompare(b));
    } else if (categorySort === "desc") {
      names.sort((a, b) => b.localeCompare(a));
    }

    return names.map((name) => [name, map.get(name) ?? []]);
  }, [visibleTasks, categories, categorySort]);

  // Done tasks, pulled out of the active groups and gathered into the
  // collapsible "Completed" section at the bottom (mirrors the Dashboard).
  const completedTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.status === "Done")
        .sort((a, b) => a.order - b.order),
    [tasks]
  );

  const draggingTask = draggingId
    ? tasks.find((task) => task.id === draggingId) ?? null
    : null;

  const cycleSort = () => {
    setCategorySort("none");
    setSortDirection((prev) =>
      prev === "none" ? "desc" : prev === "desc" ? "asc" : "none"
    );
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.type === "section") {
      // Extract the plain category name from the "section:{name}" id.
      setDraggingCategory(String(event.active.id).replace(/^section:/, ""));
    } else {
      setDraggingId(String(event.active.id));
    }
  };

  // Live cross-column transfer: as a card is dragged over a different category,
  // move it into that category right away so the placeholder lands in the right
  // group (and the floating overlay recolors to the new category).
  const handleDragOver = (event: DragOverEvent) => {
    // Section reorders are handled entirely in dragEnd — no live preview needed.
    if (event.active.data.current?.type === "section") return;

    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    if (activeId === String(over.id)) return;

    const targetCategory = resolveDropCategory(over);
    if (!targetCategory) return;

    const activeTask = tasks.find((t) => t.id === activeId);
    if (!activeTask) return;
    const activeCategory = activeTask.category.trim() || "General";
    if (activeCategory === targetCategory) return;

    const overIsCard = over.data.current?.type !== "column";
    moveTask(activeId, overIsCard ? String(over.id) : null, targetCategory);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    // ── Section reorder ──────────────────────────────────────────────────────
    if (active.data.current?.type === "section") {
      setDraggingCategory(null);
      if (over && active.id !== over.id) {
        const sectionNames = sections.map(([cat]) => cat);
        const fromIdx = sectionNames.indexOf(
          String(active.id).replace(/^section:/, "")
        );
        const toIdx = sectionNames.indexOf(
          String(over.id).replace(/^section:/, "")
        );
        if (fromIdx !== -1 && toIdx !== -1) {
          reorderCategories(arrayMove(sectionNames, fromIdx, toIdx));
        }
      }
      return;
    }

    // ── Task reorder / move ──────────────────────────────────────────────────
    setDraggingId(null);
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const targetCategory = resolveDropCategory(over);
    const activeTask = tasks.find((t) => t.id === activeId);
    if (!activeTask || !targetCategory) return;
    const activeCategory = activeTask.category.trim() || "General";
    const overIsCard = over.data.current?.type !== "column";

    if (activeCategory !== targetCategory) {
      // Fallback if a fast drop skipped the live dragOver transfer.
      moveTask(activeId, overIsCard ? overId : null, targetCategory);
    } else if (overIsCard) {
      // Same column: finalize the exact position.
      reorderTasks(activeId, overId);
    }
  };

  const handleDragCancel = () => {
    setDraggingId(null);
    setDraggingCategory(null);
  };

  // Creates a task pre-assigned to the section it was added from, and keeps the
  // input open for rapid entry within that same category.
  const commitNewTask = (category: string) => {
    const title = newTitle.trim();
    if (!title) return;
    addTask({
      title,
      status: "Not Started",
      priority: "Medium",
      deadline: "",
      pomodorosLogged: 0,
      category,
      ...(newPillar ? { lifePillar: newPillar } : {}),
    });
    setNewTitle("");
  };

  const startAdding = (category: string) => {
    setAddingCategory(category);
    setNewTitle("");
    setNewPillar(undefined);
  };

  const cancelAdding = () => {
    setAddingCategory(null);
    setNewTitle("");
    setNewPillar(undefined);
  };

  /* ----------------------------- category CRUD ---------------------------- */

  const startRename = (category: string) => {
    setEditingCategory(category);
    setCategoryDraft(category);
  };

  const cancelRename = () => {
    setEditingCategory(null);
    setCategoryDraft("");
  };

  const commitRename = (original: string) => {
    const next = categoryDraft.trim();
    if (next && next !== original) renameCategory(original, next);
    setEditingCategory(null);
    setCategoryDraft("");
  };

  const handleDeleteCategory = (category: string, count: number) => {
    if (
      count > 0 &&
      !window.confirm(
        `Delete "${category}"? Its ${count} task${
          count === 1 ? "" : "s"
        } will move to General.`
      )
    ) {
      return;
    }
    deleteCategory(category);
  };

  const commitNewCategory = () => {
    const name = newCategoryName.trim();
    if (name) addCategory(name);
    setNewCategoryName("");
    setCreatingCategory(false);
  };

  const cancelNewCategory = () => {
    setNewCategoryName("");
    setCreatingCategory(false);
  };

  return (
    <div className="px-8 py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-[var(--c-ink-2)] md:text-4xl">
              Main Board
            </h1>
            <p className="mt-2 text-sm text-[var(--c-dim)]">
              {visibleTasks.length}
              {statusFilter === "all"
                ? ` ${visibleTasks.length === 1 ? "task" : "tasks"}`
                : ` of ${tasks.length} shown`}{" "}
              ·{" "}
              {dragEnabled
                ? "drag to reorder"
                : "clear sort & filter to reorder"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as StatusFilter)}
            >
              <SelectTrigger className="h-9 gap-2 rounded-full border-[var(--c-line)] bg-[var(--c-panel-soft)] px-4 text-sm text-[var(--c-ink-3)]">
                <ListFilter className="size-4 text-[var(--c-dim)]" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {TASK_STATUSES.filter((status) => status !== "Inbox").map(
                  (status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              onClick={cycleSort}
              className={cn(
                "h-9 gap-2 rounded-full border-[var(--c-line)] bg-[var(--c-panel-soft)] px-4 text-sm text-[var(--c-ink-3)] hover:bg-[var(--c-beige-2)] hover:text-[#a35d4d]",
                sortDirection !== "none" &&
                  "border-[#a35d4d]/30 bg-[var(--c-beige-2)] text-[#a35d4d]"
              )}
            >
              {sortDirection === "asc" ? (
                <ArrowUp className="size-4" />
              ) : (
                <ArrowDown className="size-4" />
              )}
              Sort by Priority
            </Button>

            <Select
              value={categorySort}
              onValueChange={(value) => {
                const next = value as CategorySort;
                setCategorySort(next);
                if (next !== "none") setSortDirection("none");
              }}
            >
              <SelectTrigger
                className={cn(
                  "h-9 gap-2 rounded-full border-[var(--c-line)] bg-[var(--c-panel-soft)] px-4 text-sm text-[var(--c-ink-3)]",
                  categorySort !== "none" &&
                    "border-[#a35d4d]/30 bg-[var(--c-beige-2)] text-[#a35d4d]"
                )}
              >
                <Tags className="size-4 text-[var(--c-dim)]" />
                <SelectValue>
                  {(value) => CATEGORY_SORT_LABELS[value as CategorySort]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CATEGORY_SORT_LABELS) as CategorySort[]).map(
                  (key) => (
                    <SelectItem key={key} value={key}>
                      {CATEGORY_SORT_LABELS[key]}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Refresh from cloud"
              aria-label="Refresh from cloud"
              className="h-9 min-w-9 gap-2 rounded-full border-[var(--c-line)] bg-[var(--c-panel-soft)] px-4 text-sm text-[var(--c-ink-3)] hover:bg-[var(--c-beige-2)] hover:text-[#a35d4d]"
            >
              <RefreshCw
                className={cn("size-4", isRefreshing && "animate-spin")}
              />
              <span className="hidden sm:inline">Refresh</span>
            </Button>

            <LevelGuideTooltip />
          </div>
        </header>

        {/* Quick-glance status filter pills — narrow the board to one status. */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {STATUS_FILTER_PILLS.map(({ value, label }) => {
            const active = statusFilter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                aria-pressed={active}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                  active
                    ? "border-[#a35d4d]/30 bg-[var(--c-beige-2)] text-[#a35d4d]"
                    : "border-[var(--c-line)] bg-[var(--c-panel-soft)] text-[var(--c-ink-3)] hover:bg-[var(--c-beige-2)] hover:text-[#a35d4d]"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        {statusFilter !== "all" && visibleTasks.length === 0 && tasks.length > 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] py-14 text-center text-sm text-[var(--c-dim)]">
            No tasks match this filter.
          </div>
        ) : (
          // One board-wide DnD context so cards can be dragged across category
          // columns. Each section is its own SortableContext (id = category);
          // the handlers reassign a task's category when it crosses columns.
          <DndContext
            id="board-dnd"
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {/* Outer context: makes entire category sections sortable */}
            <SortableContext
              items={sections.map(([cat]) => `section:${cat}`)}
              strategy={verticalListSortingStrategy}
            >
            <div className="space-y-12">
              {sections.map(([category, groupTasks]) => {
                // Color-codes the category header pill to match its card spine.
                const theme = categoryTheme(category);
                return (
                  <SortableCategorySection
                    key={category}
                    id={`section:${category}`}
                    dragEnabled={dragEnabled}
                  >
                  {(dragHandleProps) => (
                  <section>
                    {/* Master category header — bold serif name + count pill,
                        with inline rename + delete (General is protected). */}
                    <div className="group/header mb-4 flex items-center gap-3">
                      {/* Section drag handle — only shown when manual ordering is active */}
                      {dragEnabled && (
                        <button
                          type="button"
                          {...dragHandleProps}
                          title="Drag to reorder section"
                          aria-label={`Drag ${category} section to reorder`}
                          className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-[var(--c-faint)] transition-colors hover:bg-[var(--c-beige)] hover:text-[var(--c-dim)] active:cursor-grabbing"
                        >
                          <GripVertical className="size-4" />
                        </button>
                      )}
                      {editingCategory === category ? (
                        <input
                          autoFocus
                          value={categoryDraft}
                          onChange={(e) => setCategoryDraft(e.target.value)}
                          onBlur={() => commitRename(category)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(category);
                            if (e.key === "Escape") cancelRename();
                          }}
                          aria-label={`Rename ${category}`}
                          className="font-heading w-64 max-w-full rounded-md border border-[#a35d4d]/40 bg-[var(--c-panel)] px-2 py-0.5 text-2xl font-semibold tracking-tight text-[var(--c-ink-2)] outline-none focus:ring-2 focus:ring-[#a35d4d]/20"
                        />
                      ) : (
                        <h2 className="font-heading text-2xl font-semibold tracking-tight text-[var(--c-ink-2)]">
                          {category}
                        </h2>
                      )}
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
                          theme.pill
                        )}
                      >
                        {groupTasks.filter((t) => t.status !== "Done").length}
                      </span>

                      {/* General is the permanent fallback — no rename/delete. */}
                      {category !== "General" && editingCategory !== category && (
                        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/header:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => startRename(category)}
                            title="Rename category"
                            aria-label={`Rename ${category}`}
                            className="flex size-7 items-center justify-center rounded-full text-[var(--c-faint)] transition-colors hover:bg-[var(--c-beige)] hover:text-[#a35d4d]"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleDeleteCategory(category, groupTasks.length)
                            }
                            title="Delete category"
                            aria-label={`Delete ${category}`}
                            className="flex size-7 items-center justify-center rounded-full text-[var(--c-faint)] transition-colors hover:bg-[#f6e0e0] hover:text-[#9b3b3b]"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Column labels (md and up) */}
                    <div
                      className={cn(
                        "mb-3 hidden border border-l-4 border-transparent px-4 text-xs font-semibold tracking-wide text-[var(--c-faint)] uppercase md:grid md:items-center md:gap-4",
                        GRID_COLS
                      )}
                    >
                      <span>Task</span>
                      <span className="text-center">Status</span>
                      <span className="text-center">Priority</span>
                      <span className="text-center">Category</span>
                      <span>Deadline</span>
                      <span className="text-center">Sessions</span>
                      <span />
                    </div>

                    <SortableContext
                      id={category}
                      items={groupTasks.map((task) => task.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <CategoryDropZone category={category}>
                        {groupTasks.length > 0 ? (
                          groupTasks.map((task) => (
                            <SortableTaskCard
                              key={task.id}
                              task={task}
                              isActive={task.id === activeTaskId}
                              dragEnabled={dragEnabled}
                            />
                          ))
                        ) : (
                          // Keeps an empty column visible and a valid drop target.
                          <div className="rounded-xl border-2 border-dashed border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] py-8 text-center text-sm text-[var(--c-faint)]">
                            No tasks here yet — drag one over or add below.
                          </div>
                        )}
                      </CategoryDropZone>
                    </SortableContext>

                    {/* Add Task — scoped to this category */}
                    <div className="mt-4">
                      {addingCategory === category ? (
                      <div className="flex flex-col gap-2.5 rounded-xl border border-[#a35d4d]/30 bg-[var(--c-panel)] p-4 shadow-[0_1px_4px_rgba(74,64,54,0.05)]">
                        <div className="flex items-center gap-3">
                          <Plus className="size-5 shrink-0 text-[#a35d4d]" />
                          <Input
                            autoFocus
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitNewTask(category);
                              if (e.key === "Escape") cancelAdding();
                            }}
                            placeholder={`Add to ${category} — press Enter`}
                            className="border-transparent bg-transparent text-[var(--c-ink-2)] shadow-none focus-visible:border-[#a35d4d]"
                          />
                          <Button
                            onClick={() => commitNewTask(category)}
                            disabled={newTitle.trim().length === 0}
                            className="bg-[#a35d4d] text-white hover:bg-[#8f4f41] disabled:opacity-40"
                          >
                            Add
                          </Button>
                          <button
                            type="button"
                            title="Cancel"
                            onClick={cancelAdding}
                            className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--c-dim)] transition-colors hover:bg-[var(--c-beige)] hover:text-[var(--c-ink-2)]"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 pl-8 text-[12px] text-[var(--c-dim)]">
                          <span>Life pillar:</span>
                          <PillarSelect value={newPillar} onChange={setNewPillar} />
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startAdding(category)}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] py-4 text-sm font-medium text-[var(--c-dim)] transition-colors hover:border-[#a35d4d]/50 hover:bg-[var(--c-beige-2)] hover:text-[#a35d4d]"
                      >
                        <Plus className="size-4" />
                        Add Task
                      </button>
                    )}
                  </div>
                  </section>
                  )}
                  </SortableCategorySection>
                );
              })}
            </div>
            </SortableContext>

            {/* New Category — board-level composer for creating a column directly */}
            <div className="mt-12">
              {creatingCategory ? (
                <div className="flex items-center gap-3 rounded-xl border border-[#a35d4d]/30 bg-[var(--c-panel)] p-4 shadow-[0_1px_4px_rgba(74,64,54,0.05)]">
                  <FolderPlus className="size-5 shrink-0 text-[#a35d4d]" />
                  <Input
                    autoFocus
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitNewCategory();
                      if (e.key === "Escape") cancelNewCategory();
                    }}
                    placeholder="New category name — press Enter"
                    className="border-transparent bg-transparent text-[var(--c-ink-2)] shadow-none focus-visible:border-[#a35d4d]"
                  />
                  <Button
                    onClick={commitNewCategory}
                    disabled={newCategoryName.trim().length === 0}
                    className="bg-[#a35d4d] text-white hover:bg-[#8f4f41] disabled:opacity-40"
                  >
                    Create
                  </Button>
                  <button
                    type="button"
                    title="Cancel"
                    onClick={cancelNewCategory}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--c-dim)] transition-colors hover:bg-[var(--c-beige)] hover:text-[var(--c-ink-2)]"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreatingCategory(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] py-4 text-sm font-semibold text-[var(--c-dim)] transition-colors hover:border-[#a35d4d]/50 hover:bg-[var(--c-beige-2)] hover:text-[#a35d4d]"
                >
                  <FolderPlus className="size-4" />
                  New Category
                </button>
              )}
            </div>

            {/* Completed — collapsible, defaults closed. Done tasks leave their
                category groups and gather here for later review. */}
            {completedTasks.length > 0 && (
              <section className="mt-12">
                <button
                  type="button"
                  onClick={() => setShowCompleted((v) => !v)}
                  aria-expanded={showCompleted}
                  className="flex w-full items-center justify-between rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] px-5 py-3.5 text-left shadow-[0_1px_3px_rgba(74,64,54,0.05)] transition-colors hover:bg-[var(--c-beige-2)]"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-md bg-[#6f9e6a] text-white">
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                    <h2 className="font-heading text-base font-semibold text-[var(--c-ink-2)] md:text-lg">
                      Completed
                    </h2>
                    <span className="rounded-full bg-[var(--c-beige)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--c-dim)]">
                      {completedTasks.length}
                    </span>
                  </div>
                  <ChevronDown
                    className={cn(
                      "size-5 text-[var(--c-dim)] transition-transform",
                      showCompleted && "rotate-180"
                    )}
                  />
                </button>

                {showCompleted && (
                  <div className="mt-3 flex flex-col gap-3">
                    {completedTasks.map((task) => (
                      <SortableTaskCard
                        key={task.id}
                        task={task}
                        isActive={task.id === activeTaskId}
                        dragEnabled={false}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Floating overlay: shows a task card or a category header ghost. */}
            <DragOverlay dropAnimation={{ duration: 220, easing: "ease" }}>
              {draggingTask ? (
                <TaskDragOverlayCard task={draggingTask} />
              ) : draggingCategory ? (
                <CategoryDragOverlayHeader
                  category={draggingCategory}
                  count={sections.find(([c]) => c === draggingCategory)?.[1].length ?? 0}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  );
}
