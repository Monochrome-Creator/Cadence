"use client";

import { useState } from "react";
import { ArrowRight, Inbox as InboxIcon, Plus, Trash2 } from "lucide-react";

import { useProdStore, type Task } from "@/store/use-prod-store";

/**
 * Frictionless Inbox — a brain-dump holding pen. New items are captured with a
 * single text input and nothing else: no due date, priority, or micro-tasks.
 * They land with status "Inbox" and stay off the board and dashboard until the
 * user promotes them ("Move to board" flips the status to "Not Started").
 */
export default function InboxPage() {
  const inboxTasks = useProdStore((state) =>
    state.tasks.filter((task) => task.status === "Inbox")
  );
  const addTask = useProdStore((state) => state.addTask);

  const [draft, setDraft] = useState("");

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    addTask({
      title: trimmed,
      status: "Inbox",
      priority: "Medium",
      deadline: "",
      pomodorosLogged: 0,
    });
    setDraft("");
  };

  return (
    <div className="px-5 py-7 md:px-8 md:py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        {/* Header */}
        <header>
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#e9e6f0] text-[#6a5b88]">
              <InboxIcon className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="font-heading text-3xl font-semibold tracking-tight text-[var(--c-ink-2)] md:text-[34px]">
                Inbox
              </h1>
              <p className="mt-1 text-[15px] text-[var(--c-ink-3)]">
                Capture anything now, organise it later.
              </p>
            </div>
          </div>
        </header>

        {/* Brain-dump input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="flex items-center gap-2 rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] px-4 py-2.5 shadow-[0_1px_3px_rgba(74,64,54,0.05)] focus-within:border-[#a35d4d]/40 focus-within:ring-2 focus-within:ring-[#a35d4d]/15"
        >
          <Plus className="size-5 shrink-0 text-[var(--c-dim)]" />
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What's on your mind?"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--c-ink-2)] placeholder:text-[var(--c-dim)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="shrink-0 rounded-xl bg-[#a35d4d] px-4 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-[#8f4f41] disabled:opacity-40"
          >
            Add
          </button>
        </form>

        <p className="-mt-2 text-[12.5px] text-[var(--c-dim)]">
          Tip: press{" "}
          <kbd className="rounded-md border border-[var(--c-line)] bg-[var(--c-beige)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--c-ink-3)]">
            ⌘K
          </kbd>{" "}
          anywhere to quick-add to your inbox.
        </p>

        {/* Holding pen */}
        {inboxTasks.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {inboxTasks.map((task) => (
              <InboxRow key={task.id} task={task} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-panel-soft)] py-14 text-center text-sm text-[var(--c-dim)]">
            Your inbox is clear. Jot down whatever&rsquo;s on your mind above.
          </div>
        )}
      </div>
    </div>
  );
}

/** A single captured item: inline-editable title + promote/delete actions. */
function InboxRow({ task }: { task: Task }) {
  const updateTask = useProdStore((state) => state.updateTask);
  const deleteTask = useProdStore((state) => state.deleteTask);

  const [title, setTitle] = useState(task.title);

  const commit = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) updateTask(task.id, { title: trimmed });
    else setTitle(task.title);
  };

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] px-4 py-3 shadow-[0_1px_3px_rgba(74,64,54,0.04)] transition-shadow hover:shadow-[0_4px_14px_rgba(74,64,54,0.06)]">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setTitle(task.title);
            e.currentTarget.blur();
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--c-ink-2)] focus:outline-none"
      />
      <button
        type="button"
        onClick={() => updateTask(task.id, { status: "Not Started" })}
        title="Move to board"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--c-beige)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--c-ink-3)] transition-colors hover:bg-[var(--c-beige-2)] hover:text-[#a35d4d]"
      >
        Move to board <ArrowRight className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => deleteTask(task.id)}
        title="Delete"
        aria-label="Delete"
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--c-dim)] transition-colors hover:bg-[#f6e0e0] hover:text-[#9b3b3b]"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
