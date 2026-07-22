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

/** Estimated running km for one session (0 for non-run). Speeds default to the
 *  legacy constants; generatePlan passes the athlete's pace-derived speeds
 *  (refinement 4) so achieved km and the caps that priced them agree. */
export function sessionRunKm(s: PlannedSessionOut, easyKmh = LONG_EASY_KMH, qualityKmh = 12.4): number {
  if (s.discipline !== "run") return 0;
  return s.durationHr * (QUALITY.test(s.title) ? qualityKmh : easyKmh);
}

/** Running km across a week's sessions (the race event is discipline "race"). */
export function weekRunKm(sessions: PlannedSessionOut[], easyKmh = LONG_EASY_KMH, qualityKmh = 12.4): number {
  return sessions.reduce((sum, s) => sum + sessionRunKm(s, easyKmh, qualityKmh), 0);
}

/** Peak weekly running km across the plan's TRAINING weeks (excludes the race week). */
export function peakWeekRunKm(weeks: PlanWeek[], easyKmh = LONG_EASY_KMH, qualityKmh = 12.4): number {
  const training = weeks.filter((w) => w.phase !== "race");
  return training.length ? Math.max(...training.map((w) => weekRunKm(w.sessions, easyKmh, qualityKmh))) : 0;
}

/** Longest single long-run in the plan, km-equivalent. */
export function peakLongRunKm(weeks: PlanWeek[], easyKmh = LONG_EASY_KMH): number {
  let peak = 0;
  for (const w of weeks)
    for (const s of w.sessions)
      if (s.discipline === "run" && /long/i.test(s.title)) peak = Math.max(peak, s.durationHr * easyKmh);
  return peak;
}
