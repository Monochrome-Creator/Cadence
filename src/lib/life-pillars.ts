/* -------------------------------------------------------------------------- */
/*                     Four Pillars — shared design tokens                     */
/* -------------------------------------------------------------------------- */
/**
 * Global color + label map for the "Four Pillars" life areas (Wealth, Health,
 * Career, Personal IP). Centralised here so the board cards, the dashboard
 * badges, and the Balance widget all draw from one source of truth.
 *
 * Each theme carries:
 *  - `label`: the human-facing name ("Personal_IP" → "Personal IP").
 *  - `badge`: Tailwind classes for the small pill (soft bg + readable text,
 *             with dark-mode variants).
 *  - `fill` : a solid hex for progress bars / rings.
 *  - `dot`  : a small swatch background class for legends.
 */

import { LIFE_PILLARS, type LifePillar } from "@/store/use-prod-store";

export interface PillarTheme {
  label: string;
  badge: string;
  fill: string;
  dot: string;
}

export const PILLAR_THEME: Record<LifePillar, PillarTheme> = {
  // Wealth — green
  Wealth: {
    label: "Wealth",
    badge:
      "bg-[#e3ece0] text-[#4d7049] dark:bg-[#26331f] dark:text-[#a9c9a0]",
    fill: "#6f9e6a",
    dot: "bg-[#6f9e6a]",
  },
  // Health — blue
  Health: {
    label: "Health",
    badge:
      "bg-[#e0eaf2] text-[#3f6488] dark:bg-[#1c2c3a] dark:text-[#9cc0dd]",
    fill: "#5b8bb5",
    dot: "bg-[#5b8bb5]",
  },
  // Career — purple
  Career: {
    label: "Career",
    badge:
      "bg-[#e9e6f0] text-[#6a5b88] dark:bg-[#2a2440] dark:text-[#bcb0db]",
    fill: "#8676b0",
    dot: "bg-[#8676b0]",
  },
  // Personal IP — orange
  Personal_IP: {
    label: "Personal IP",
    badge:
      "bg-[#f7e7d4] text-[#9a6533] dark:bg-[#3a2a16] dark:text-[#e3b87f]",
    fill: "#cf8f43",
    dot: "bg-[#cf8f43]",
  },
};

/** Canonical render order for selectors, badges, and the widget. */
export const PILLAR_ORDER: readonly LifePillar[] = LIFE_PILLARS;

/** Human label for a pillar value (handles the underscore in Personal_IP). */
export function pillarLabel(pillar: LifePillar): string {
  return PILLAR_THEME[pillar].label;
}
