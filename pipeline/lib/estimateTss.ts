import type { Discipline } from "./types.ts";

/**
 * TrainingPeaks only auto-computes planned TSS for structured bike workouts
 * (corpus coverage: 98% bike, 11% run, 0% swim). For everything else we
 * estimate from planned duration/distance and an intensity factor read off
 * the workout text: TSS ≈ hours × IF² × 100.
 */

const IF_RULES: Array<[RegExp, number]> = [
  [/\brace\b(?!.*pace)/i, 0.95],
  [/\bvo2|hard|sprint|anaerobic|all.?out\b/i, 0.88],
  [/\btempo|threshold|cv\b|steady|sweet.?spot|race pace\b/i, 0.82],
  [/\blong|endurance\b/i, 0.72],
  [/\beasy|shakeout|recovery|z ?1|zone ?1|z ?2|zone ?2|spin\b/i, 0.66],
];

const DEFAULT_IF = 0.7;

// Fallback speeds for duration-from-distance (athlete-typical easy paces)
const EASY_KMH: Partial<Record<Discipline, number>> = {
  run: 11.6, // ~5:10/km
  swim: 3.4, // CSS × ~0.85
  bike: 30,
  walk: 5.5,
};

export function estimatePlannedTss(p: {
  discipline: Discipline;
  durationHr: number | null;
  distanceKm: number | null;
  title: string | null;
  description: string | null;
}): number | null {
  let hours = p.durationHr;
  if ((hours === null || hours <= 0.02) && p.distanceKm) {
    const kmh = EASY_KMH[p.discipline];
    if (kmh) hours = p.distanceKm / kmh;
  }
  if (!hours || hours <= 0.02) return null;

  const text = `${p.title ?? ""}\n${p.description ?? ""}`;
  const intensity = IF_RULES.find(([re]) => re.test(text))?.[1] ?? DEFAULT_IF;
  const tss = hours * intensity * intensity * 100;
  return Math.min(300, Math.max(5, Math.round(tss * 10) / 10));
}
