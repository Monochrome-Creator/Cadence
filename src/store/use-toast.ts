import { create } from "zustand";

/** A transient on-screen notification. */
export interface Toast {
  id: string;
  message: string;
  /** "error" renders the high-visibility red treatment; "default" is neutral. */
  variant: "error" | "default";
}

/** How long a toast stays up before auto-dismissing. */
const TOAST_DURATION_MS = 6000;

interface ToastState {
  toasts: Toast[];
  /** Push a toast; it auto-dismisses after {@link TOAST_DURATION_MS}. */
  showToast: (toast: { message: string; variant?: Toast["variant"] }) => void;
  /** Remove a toast early (e.g. the user dismisses it). */
  dismissToast: (id: string) => void;
}

/**
 * Tiny global toast queue. Kept out of the main prod store so UI-only ephemeral
 * state never touches the persisted/synced data layer. Store actions stay free
 * of UI concerns — callers (components) decide when to fire a toast.
 */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  showToast: ({ message, variant = "default" }) => {
    const id = `toast-${crypto.randomUUID()}`;
    set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, TOAST_DURATION_MS);
  },
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
