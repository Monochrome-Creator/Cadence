"use client";

import { useMemo } from "react";
import { CloudUpload, Pencil, Plus, Trash2, UploadCloud } from "lucide-react";

import { useProdStore, type Task } from "@/store/use-prod-store";

/* -------------------------------------------------------------------------- */
/*                           Sync review modal                                */
/* -------------------------------------------------------------------------- */

/**
 * "You have offline changes" prompt, mounted once in the root layout. It only
 * surfaces when a reconnect found unsynced local edits that the cloud copy would
 * have overwritten (store sets `pendingSync` instead of clobbering them). The
 * user chooses:
 *   - Apply  → push the offline edits/deletions up, then adopt the merged set.
 *   - Discard → drop the local-only changes and take the cloud copy.
 *
 * Everything stays on-device until the user decides — nothing is exposed without
 * a valid session, so the choice is purely "which of my own copies wins".
 */

/** A pending change row for display. */
type Change =
  | { kind: "new" | "edit"; id: string; title: string }
  | { kind: "delete"; id: string; title: string };

export function SyncReviewModal() {
  const pendingSync = useProdStore((s) => s.pendingSync);
  const isSyncing = useProdStore((s) => s.isSyncing);
  const applyPendingSync = useProdStore((s) => s.applyPendingSync);
  const discardPendingSync = useProdStore((s) => s.discardPendingSync);

  const changes = useMemo<Change[]>(() => {
    if (!pendingSync) return [];
    const cloudById = new Map<string, Task>(
      pendingSync.cloudTasks.map((t) => [t.id, t])
    );
    const localById = new Map<string, Task>(
      pendingSync.localTasks.map((t) => [t.id, t])
    );
    const edits: Change[] = pendingSync.unsyncedIds
      .map((id) => {
        const local = localById.get(id);
        if (!local) return null;
        return {
          kind: cloudById.has(id) ? "edit" : "new",
          id,
          title: local.title || "Untitled task",
        } as Change;
      })
      .filter((c): c is Change => c !== null);
    const deletes: Change[] = pendingSync.deletedIds.map((id) => ({
      kind: "delete" as const,
      id,
      title: cloudById.get(id)?.title || "Untitled task",
    }));
    return [...edits, ...deletes];
  }, [pendingSync]);

  if (!pendingSync) return null;

  const count = changes.length;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(40,33,28,0.35)] p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Offline changes review"
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-[var(--c-line)] bg-[var(--c-panel)] shadow-[0_20px_60px_rgba(74,64,54,0.25)]"
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#f6e6da] text-[#a35d4d]">
            <CloudUpload className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-xl font-semibold tracking-tight text-[var(--c-ink-2)]">
              You have offline changes
            </h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--c-ink-3)]">
              {count === 1
                ? "This change was made"
                : `These ${count} changes were made`}{" "}
              on this device while you were disconnected. Save them to the cloud,
              or discard them and keep the cloud copy instead.
            </p>
          </div>
        </div>

        {/* Scrollable change list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <div className="flex flex-col gap-2 pb-2">
            {changes.map((change) => (
              <div
                key={`${change.kind}-${change.id}`}
                className="flex items-center gap-3 rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel-soft)] p-3"
              >
                {change.kind === "delete" ? (
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#f6dada] text-[#9b3b3b]">
                    <Trash2 className="size-3.5" />
                  </span>
                ) : change.kind === "new" ? (
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#eef0e7] text-[#5f6b4a]">
                    <Plus className="size-3.5" strokeWidth={2.5} />
                  </span>
                ) : (
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#eae4f2] text-[#6b5b8a]">
                    <Pencil className="size-3.5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] leading-snug font-medium break-words text-[var(--c-ink-2)]">
                    {change.title}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-[var(--c-dim)]">
                    {change.kind === "delete"
                      ? "Deleted here"
                      : change.kind === "new"
                        ? "Added here"
                        : "Edited here"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-5">
          <button
            type="button"
            onClick={() => discardPendingSync()}
            disabled={isSyncing}
            className="rounded-full px-4 py-2 text-[13px] font-medium text-[var(--c-ink-3)] transition-colors hover:bg-[var(--c-beige)] hover:text-[var(--c-ink-2)] disabled:opacity-40"
          >
            Discard &amp; use cloud
          </button>
          <button
            type="button"
            onClick={() => void applyPendingSync()}
            disabled={isSyncing}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#a35d4d] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#8f4f41] disabled:opacity-40"
          >
            <UploadCloud className="size-4" />
            {isSyncing ? "Saving…" : "Save my changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
