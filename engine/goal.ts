import type { RaceType } from "./plan.ts";

/**
 * Goal-backed periodization math (docs/periodization-spec.md §1, §5).
 *
 * Pure module, no `src/` imports, mirrors engine/reference.ts. It *consumes*
 * the PMC constants (τ=42/7 live in pipeline/derive.ts + plan.ts) — it never
 * re-derives or tunes them (taper-rules rule 6). Everything here is a
 * FUNCTION of race distance + goal pace: monotone (faster pace and longer
 * distance ⇒ higher required CTL) and invertible (reachable CTL ⇒ finish).
 *
 * Model: Daniels VDOT backbone (Model B). Chosen over the RTS-CTL closed form
 * (Model A, retained only as an O(1) cross-check) because the whole point of
 * the gap assessment is to read a realistic finish from the *reachable* ~26
 * CTL, far below the 1:24 anchor — the region where Model A's time ∝ d²/CTL
 * hyperbola blows up (2:42) and the VDOT curve stays believable (~1:44).
 */

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// ——— constants (documented; none are safety rails) ————————————————————
const CVOL = 4.9; // TSS per weekly-km (avg training pace ~5:00–5:20, IF ~0.80)
const TAPER_RETENTION = 0.94; // CTL retained across a 2–3 wk taper (ATL sheds far more)

// Distance → km. Tri types have no run-pace goal target (returns undefined).
export function raceDistanceKm(t: RaceType): number | undefined {
  switch (t) {
    case "run-5k":
      return 5;
    case "run-10k":
      return 10;
    case "run-half":
      return 21.1;
    case "run-marathon":
      return 42.2;
    default:
      return undefined; // sprint/olympic/half-ironman/ironman: no run goal yet
  }
}

/** Parse "H:MM:SS" or "MM:SS" → seconds; undefined on anything malformed. */
export function parseGoalTime(s: string): number | undefined {
  const parts = s.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return undefined;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  const total =
    parts.length === 3 ? nums[0] * 3600 + nums[1] * 60 + nums[2] : nums[0] * 60 + nums[1];
  return total > 0 ? total : undefined;
}

/**
 * Daniels VDOT. T in MINUTES, D in km. Domain-clamped D ∈ [3, 50]. Strictly
 * decreasing in T at fixed D (the property the inverse bisection relies on).
 */
export function vdot(distanceKm: number, timeMin: number): number {
  const D = clamp(distanceKm, 3, 50);
  const v = (1000 * D) / timeMin; // race velocity, m/min
  const vo2 = 0.182258 * v + 0.000104 * v * v - 4.6; // O2 cost of that pace
  const pct = // fractional utilization of VO2max at that duration
    0.8 + 0.1894393 * Math.exp(-0.012778 * timeMin) + 0.2989558 * Math.exp(-0.1932605 * timeMin);
  return vo2 / pct;
}

// weekly running-volume norm (competitive band) with a mild endurance premium
function weeklyKm(vdotVal: number, distanceKm: number): number {
  return Math.max(0, 3.0 * vdotVal - 90) * Math.pow(distanceKm / 21.1, 0.15);
}

export interface GoalCtl {
  /** Pre-taper summit the trajectory aims for (~53 at the 1:24 anchor). */
  peakCtl: number;
  /** peak × taper retention — the headline "requires ~X" (~50 at the anchor). */
  raceDayCtl: number;
  vdot: number;
  weeklyTss: number;
}

/** Forward: required CTL from race distance + goal pace. */
export function goalCtlTarget(distanceKm: number, goalTimeSec: number): GoalCtl {
  const T = goalTimeSec / 60;
  const v = vdot(distanceKm, T);
  const wKm = weeklyKm(v, distanceKm);
  const weeklyTss = CVOL * wKm;
  const peakCtl = weeklyTss / 7; // sustained-load equilibrium
  return { peakCtl, raceDayCtl: peakCtl * TAPER_RETENTION, vdot: v, weeklyTss };
}

/**
 * Inverse: finish estimate (seconds) from a reachable race-day CTL. Exact
 * inverse of the forward chain down to VDOT*, then a monotone bisection for
 * the finish time (vdot decreasing in T ⇒ unique root). A load-limited bound,
 * never a hard prediction (§1.3): economy can beat it, so callers clamp it no
 * faster than the goal pace.
 */
export function finishEstimate(reachableRaceDayCtl: number, distanceKm: number): number {
  const peakCtl = reachableRaceDayCtl / TAPER_RETENTION;
  const weeklyTss = 7 * peakCtl;
  const wKm = weeklyTss / CVOL;
  const vdotTarget = (wKm / Math.pow(distanceKm / 21.1, 0.15) + 90) / 3.0;
  let lo = 2.5 * distanceKm; // physiological bracket, minutes
  let hi = 9.0 * distanceKm;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (vdot(distanceKm, mid) > vdotTarget) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * 60; // seconds
}

// ——— long-run progression (§5): distance-tied, injury-capped ——————————

export const LONG_EASY_KMH = 11.6; // easy long-run pace
const LONG_MULT: Record<RaceType, number> = {
  "run-5k": 2.6,
  "run-10k": 1.6,
  "run-half": 1.15,
  "run-marathon": 0.76,
  // tri types never reach the run-long progression (gated on a run goal)
  sprint: 1.15,
  olympic: 1.15,
  "half-ironman": 1.0,
  ironman: 0.9,
};
const INJURY_CAP_KM = 24; // calf/tendon absolute ceiling this cycle (the 22–26 band)
const INJURY_STEP_KM = 2.0; // ≤ +2 km/week — the safe long-run step, the real limiter
const INJURY_RATE = 0.15; // ≤ +15%/week (min with the step; step binds above ~13 km)
export const LONG_MIN_CAP = 130; // minutes — calf duration ceiling (≤ engine's 156)

/** Peak long-run distance for a race, injury-capped. */
export function peakLongKm(raceType: RaceType): number {
  const d = raceDistanceKm(raceType) ?? 21.1;
  return Math.min(d * LONG_MULT[raceType], INJURY_CAP_KM);
}

/** Weekly build progression, injury-tightened; hold flat on cutback weeks. */
export function longRunKm(prevKm: number, peakKm: number, cutback: boolean): number {
  if (cutback) return prevKm; // 3:1 cutback holds the long run flat
  return Math.min(peakKm, prevKm * (1 + INJURY_RATE), prevKm + INJURY_STEP_KM);
}
