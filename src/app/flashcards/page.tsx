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
          <h1 className="font-heading text-4xl font-semibold tracking-tight text-[#4a4036]">
            Flashcards
          </h1>
          <p className="mt-2 text-sm text-[#9c8e7c]">
            Paste your notes and let AI turn them into study cards.
          </p>
        </header>

        <div className="mb-8 rounded-3xl border border-[#e8e0d5] bg-white p-6 shadow-[0_2px_8px_rgba(74,64,54,0.05)]">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste text, notes, or an article here..."
            rows={8}
            className="w-full resize-y rounded-2xl border border-[#e8e0d5] bg-[#fdfbf7] p-4 text-sm text-[#4a4036] outline-none focus-visible:border-[#a35d4d] focus-visible:bg-white"
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
                className="rounded-2xl border border-[#e8e0d5] bg-white p-5 shadow-[0_2px_8px_rgba(74,64,54,0.05)]"
              >
                <p className="mb-2 text-sm font-semibold text-[#4a4036]">
                  {card.question}
                </p>
                <p className="text-sm text-[#6b5f50]">{card.answer}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[#d8cab8] py-16 text-center">
            <Layers className="mb-3 size-8 text-[#d8cab8]" />
            <p className="text-sm text-[#9c8e7c]">
              Your generated flashcards will appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
