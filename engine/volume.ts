import type { PlannedSessionOut, PlanWeek } from "./plan.ts";
import { LONG_EASY_KMH } from "./goal.ts";

/**
 * Volume measurement (feature 2) — reads the km ACHIEVED in an emitted plan so
 * it can be checked against the direct km targets (peakWeeklyKm / peakLongKm).
 * Pure, presentation-adjacent: it only reads sessions the engine already built,
 * never the PMC path. Km is estimated from session duration at a zone-blended
 * pace (quality days run a touch faster than easy/long days).
 */

const QUALITY = /tempo|interval|threshold|vo2|strides|\bcv\b/i;

/** Estimated running km for one session (0 for non-run). */
export function sessionRunKm(s: PlannedSessionOut): number {
  if (s.discipline !== "run") return 0;
  const kmh = QUALITY.test(s.title) ? 12.4 : LONG_EASY_KMH; // ~4:50 vs ~5:10/km
  return s.durationHr * kmh;
}

/** Running km across a week's sessions (the race event is discipline "race"). */
export function weekRunKm(sessions: PlannedSessionOut[]): number {
  return sessions.reduce((sum, s) => sum + sessionRunKm(s), 0);
}

/** Peak weekly running km across the plan's TRAINING weeks (excludes the race week). */
export function peakWeekRunKm(weeks: PlanWeek[]): number {
  const training = weeks.filter((w) => w.phase !== "race");
  return training.length ? Math.max(...training.map((w) => weekRunKm(w.sessions))) : 0;
}

/** Longest single long-run in the plan, km-equivalent. */
export function peakLongRunKm(weeks: PlanWeek[]): number {
  let peak = 0;
  for (const w of weeks)
    for (const s of w.sessions)
      if (s.discipline === "run" && /long/i.test(s.title)) peak = Math.max(peak, s.durationHr * LONG_EASY_KMH);
  return peak;
}
