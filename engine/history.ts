import type { AthleteState } from "./types.ts";

/**
 * Base-richness / training-age (feature 3). One ramp cap (+20%) for everyone is
 * wrong for RETURNING athletes. Detraining research (Mujika & Padilla; retraining
 * case studies): a previously well-trained athlete keeps VO2max above untrained
 * baseline, loses recent gains first, and REACQUIRES base far faster than the
 * original build. finishEstimate already models this on the display side (the
 * durable-ability ceiling); this brings the same signal to the LOAD side.
 *
 * Pure module. The factor it produces becomes a plan-only AthleteState.rampCap
 * signal (set in generatePlan, never on the backtest path), which modulates the
 * learned-layer ramp ceiling. It NEVER exceeds an active tissue rampCeiling.
 */

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export interface BaseRichness {
  /** [0,1] — 0 de-novo, 1 deeply base-rich (years logged + big reclaimable peak). */
  richness: number;
  peakHistoricalCtl: number;
  yearsLogged: number;
}

/** Years of logged history that count as a full "deep base". */
const FULL_DEPTH_YEARS = 3;

/**
 * Derive base-richness from the athlete's history. `peakHint` lets the caller
 * fold in a demonstrated historical CTL that predates the weekly window (e.g. a
 * race-anchor CTL from a prior season). Returns undefined for EMPTY history —
 * then generatePlan leaves rampCap unset and the default +20% rail stands, so
 * synthetic/backtest paths (which pass no history) are byte-identical.
 */
export function deriveBaseRichness(
  history: Array<{ state: AthleteState; weekStart?: string }>,
  currentCtl: number,
  peakHint = 0
): BaseRichness | undefined {
  if (history.length === 0) return undefined;
  const peakHistoricalCtl = Math.max(currentCtl, peakHint, ...history.map((h) => h.state.ctl));
  const yearsLogged = history.length / 52;
  // How much durable base sits ABOVE the current (detrained) fitness — the room
  // a returning athlete can reclaim quickly. 0 when already at the historical peak.
  const reclaimable = peakHistoricalCtl > 0 ? clamp((peakHistoricalCtl - currentCtl) / peakHistoricalCtl, 0, 1) : 0;
  const depth = clamp(yearsLogged / FULL_DEPTH_YEARS, 0, 1);
  // Depth gates the whole factor (a novice can't be base-rich); the reclaimable
  // gap decides how much of that depth translates into a faster early rebuild.
  const richness = clamp(depth * (0.4 + 0.6 * reclaimable), 0, 1);
  return { richness, peakHistoricalCtl, yearsLogged };
}

/**
 * Base-richness → plan-side ramp cap, FLOORED at the ignorance default (1.2).
 *
 * The matrix caught the inversion the un-floored linear map produced: an
 * empty history fell through to the 1.2 default, while 4–26 weeks of
 * unremarkable history derived richness ≈0.02–0.10 and a cap of 1.10–1.12 —
 * importing a month of Strava made the allowed ramp TIGHTER than knowing
 * nothing. Product decision (2026-08-05): knowing a little must never cost
 * the athlete headroom; richness only ever pushes UPWARD from the default,
 * toward the 1.3 ceiling. Values at richness ≥ 0.5 are byte-identical to the
 * old map. The tissue rampCeiling (when active) still takes precedence.
 */
export function rampCapFromRichness(richness: number): number {
  return Math.max(1.2, 1.1 + 0.2 * clamp(richness, 0, 1));
}
