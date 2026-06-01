"use server";

import Anthropic from "@anthropic-ai/sdk";

import type { Flashcard } from "@/store/use-prod-store";

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You generate study flashcards from a body of text.
Respond with a single strict JSON object and nothing else — no markdown, no code
fences, no commentary. The object must have exactly one key, "flashcards", whose
value is an array of objects, each with string keys "question" and "answer".`;

export async function generateFlashcards(text: string): Promise<Flashcard[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Create flashcards from the following text:\n\n${trimmed}`,
      },
    ],
  });

  const raw = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Model did not return valid JSON");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { flashcards?: unknown }).flashcards)
  ) {
    throw new Error("Response JSON missing a 'flashcards' array");
  }

  const flashcards = (parsed as { flashcards: unknown[] }).flashcards;

  return flashcards
    .filter(
      (card): card is Flashcard =>
        typeof card === "object" &&
        card !== null &&
        typeof (card as Flashcard).question === "string" &&
        typeof (card as Flashcard).answer === "string"
    )
    .map((card) => ({ question: card.question, answer: card.answer }));
}
