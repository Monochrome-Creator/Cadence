"use client";

import { useState, useTransition } from "react";
import { Layers, Sparkles } from "lucide-react";

import { useProdStore } from "@/store/use-prod-store";
import { Button } from "@/components/ui/button";
import { generateFlashcards } from "./actions";

export default function FlashcardsPage() {
  const flashcards = useProdStore((state) => state.flashcards);
  const setFlashcards = useProdStore((state) => state.setFlashcards);

  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleGenerate = () => {
    setError(null);
    startTransition(async () => {
      try {
        const cards = await generateFlashcards(text);
        setFlashcards(cards);
        if (cards.length === 0) {
          setError("No flashcards were generated from that text.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  };

  return (
    <div className="px-8 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-10">
          <h1 className="font-heading text-4xl font-semibold tracking-tight text-[var(--c-ink-2)]">
            Flashcards
          </h1>
          <p className="mt-2 text-sm text-[var(--c-dim)]">
            Paste your notes and let AI turn them into study cards.
          </p>
        </header>

        <div className="mb-8 rounded-3xl border border-[var(--c-line)] bg-[var(--c-panel)] p-6 shadow-[0_2px_8px_rgba(74,64,54,0.05)]">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste text, notes, or an article here..."
            rows={8}
            className="w-full resize-y rounded-2xl border border-[var(--c-line)] bg-[var(--c-cream)] p-4 text-sm text-[var(--c-ink-2)] outline-none focus-visible:border-[#a35d4d] focus-visible:bg-[var(--c-panel)]"
          />

          <div className="mt-4 flex items-center justify-between">
            {error ? (
              <p className="text-sm text-[#a35d4d]">{error}</p>
            ) : (
              <span />
            )}
            <Button
              onClick={handleGenerate}
              disabled={isPending || text.trim().length === 0}
              className="bg-[#a35d4d] text-white hover:bg-[#8f4f41] disabled:opacity-40"
            >
              <Sparkles className="size-4" />
              {isPending ? "Generating..." : "Generate Flashcards"}
            </Button>
          </div>
        </div>

        {flashcards.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {flashcards.map((card, index) => (
              <div
                key={index}
                className="rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] p-5 shadow-[0_2px_8px_rgba(74,64,54,0.05)]"
              >
                <p className="mb-2 text-sm font-semibold text-[var(--c-ink-2)]">
                  {card.question}
                </p>
                <p className="text-sm text-[var(--c-ink-3)]">{card.answer}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[var(--c-line-strong)] py-16 text-center">
            <Layers className="mb-3 size-8 text-[var(--c-line-strong)]" />
            <p className="text-sm text-[var(--c-dim)]">
              Your generated flashcards will appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
