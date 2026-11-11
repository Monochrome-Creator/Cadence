"use client";

import { useEffect } from "react";

import { isShowing, type PromptId } from "@/lib/machines/prompts";
import { useProdStore } from "@/store/use-prod-store";

/**
 * Asks for the screen while `wants` is true and says whether this prompt is the one
 * showing. A prompt that is waiting renders nothing; its own state (drafts, snooze)
 * is untouched, so it picks up where it was when its turn comes.
 */
export function usePrompt(id: PromptId, wants: boolean): boolean {
  useEffect(() => {
    if (!wants) return;
    useProdStore.getState().requestPrompt(id);
    return () => useProdStore.getState().releasePrompt(id);
  }, [id, wants]);

  return useProdStore((state) => isShowing(state.prompts, id)) && wants;
}
