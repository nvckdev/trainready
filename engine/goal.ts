import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
 * Invert vdot(distanceKm, t) = vdotTarget → finish time in MINUTES via the
 * monotone bisection (vdot strictly decreasing in T ⇒ unique root). Shared by
 * the generic fallback, the personal-curve model, and the invariant clamp.
 */
function invertVdotMin(distanceKm: number, vdotTarget: number): number {
  let lo = 2.5 * distanceKm; // physiological bracket, minutes
  let hi = 9.0 * distanceKm;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (vdot(distanceKm, mid) > vdotTarget) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Generic VDOT-from-reachable-CTL finish (seconds). The pre-calibration body,
 *  used verbatim as the no-anchor fallback (byte-identical for anchorless athletes). */
function genericFinishSec(reachableRaceDayCtl: number, distanceKm: number): number {
  const peakCtl = reachableRaceDayCtl / TAPER_RETENTION;
  const weeklyTss = 7 * peakCtl;
  const wKm = weeklyTss / CVOL;
  const vdotTarget = (wKm / Math.pow(distanceKm / 21.1, 0.15) + 90) / 3.0;
  return invertVdotMin(distanceKm, vdotTarget) * 60; // seconds
}

// ——— personal-anchored finish model (docs/finish-calibration.md §§1–4) ———

/** A demonstrated race: distance, finish, and the labeled CTL on race day. */
export interface RaceAnchor {
  date: string; // ISO — used only for age-degradation of the ceiling
  distanceKm: number;
  timeSec: number;
  ctlAtRace: number;
}

// None of these are safety rails — they shape a display-only projection.
export const CEIL_DECAY_PER_YR = 0.02; // VDOT lost per year off peak (detraining is slow)
export const CEIL_DECAY_CAP = 0.1; // total degradation floor: Vceil ≥ 0.90·Vbest
export const DETRAINED_FLOOR_FRAC = 0.72; // V0 = f0·Vceil — deep-detrained floor at C=0

function yearsSince(dateStr: string, asOfMs: number): number {
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (asOfMs - t) / (365.25 * 24 * 3600 * 1000));
}

/**
 * Fit the saturating support curve `V(C) = Vceil − (Vceil − V0)·exp(−C/λ)` from
 * the athlete's race anchors (§§1–2). `Vceil` is the best VDOT ever shown,
 * degraded gently for years since; `λ` is fit through the recent support anchor
 * (least squares when ≥2). Returns null when the anchors can't constrain a curve.
 */
function fitPersonalCurve(
  anchors: RaceAnchor[],
  asOfMs: number
): { Vceil: number; V0: number; lambda: number } | null {
  const pts = anchors.map((a) => ({ C: a.ctlAtRace, V: vdot(a.distanceKm, a.timeSec / 60), date: a.date }));
  if (pts.length === 0) return null;
  const best = pts.reduce((b, p) => (p.V > b.V ? p : b), pts[0]);
  const Vceil = best.V * (1 - Math.min(CEIL_DECAY_PER_YR * yearsSince(best.date, asOfMs), CEIL_DECAY_CAP));
  const V0 = DETRAINED_FLOOR_FRAC * Vceil;
  // Support anchors constrain the rise; exclude the ceiling point itself. Keep
  // only points inside the ln domain (V < Vceil, C > 0).
  let support = pts.filter((p) => p !== best);
  if (support.length === 0) support = pts;
  support = support.filter((p) => p.V < Vceil && p.C > 0);
  if (support.length === 0) return null;
  let lambda: number;
  if (support.length === 1) {
    const { C, V } = support[0];
    lambda = -C / Math.log((Vceil - V) / (Vceil - V0));
  } else {
    // y = ln(Vceil − V) = ln(Vceil − V0) − C/λ ⇒ slope = −1/λ (least squares).
    const xs = support.map((p) => p.C);
    const ys = support.map((p) => Math.log(Vceil - p.V));
    const n = xs.length;
    const mx = xs.reduce((s, x) => s + x, 0) / n;
    const my = ys.reduce((s, y) => s + y, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    lambda = slope < 0 ? -1 / slope : Infinity;
  }
  if (!Number.isFinite(lambda) || lambda <= 0) return null;
  return { Vceil, V0, lambda };
}

/**
 * Finish estimate (seconds) from a reachable race-day CTL.
 *
 * With no personal race `anchors` this is the generic VDOT-from-CTL curve
 * (byte-identical to the pre-calibration model). With anchors it uses the
 * ceiling-saturating personal curve and enforces the HARD INVARIANT via a
 * clamp: the projection is **never slower** than any real race the athlete ran
 * at CTL ≤ the reachable CTL (§ clamp). The clamp holds regardless of any model
 * miscalibration because it caps at each qualifying anchor's equal-VDOT finish.
 *
 * Still a load-limited display bound, never a hard prediction — callers clamp it
 * no faster than the stated goal (plan.ts buildGoalGap).
 */
export function finishEstimate(
  reachableRaceDayCtl: number,
  distanceKm: number,
  anchors?: RaceAnchor[],
  asOf: string | number | Date = Date.now()
): number {
  const usable = (anchors ?? []).filter(
    (a) => a.distanceKm > 0 && a.timeSec > 0 && Number.isFinite(a.ctlAtRace)
  );
  if (usable.length === 0) return genericFinishSec(reachableRaceDayCtl, distanceKm);

  const asOfMs = asOf instanceof Date ? asOf.getTime() : typeof asOf === "string" ? Date.parse(asOf) : asOf;
  const curve = fitPersonalCurve(usable, Number.isFinite(asOfMs) ? (asOfMs as number) : Date.now());

  let modelSec = Infinity;
  if (curve) {
    const V = curve.Vceil - (curve.Vceil - curve.V0) * Math.exp(-reachableRaceDayCtl / curve.lambda);
    modelSec = invertVdotMin(distanceKm, V) * 60;
  }

  // HARD INVARIANT clamp: cap at the equal-VDOT finish of every anchor run at
  // CTL ≤ the reachable CTL (§ clamp). Independent of the model.
  let cap = Infinity;
  for (const a of usable) {
    if (a.ctlAtRace <= reachableRaceDayCtl) {
      const teq = invertVdotMin(distanceKm, vdot(a.distanceKm, a.timeSec / 60)) * 60;
      if (teq < cap) cap = teq;
    }
  }

  const result = Math.min(modelSec, cap);
  return Number.isFinite(result) ? result : genericFinishSec(reachableRaceDayCtl, distanceKm);
}

/**
 * Load the athlete's race anchors from the gitignored corpus
 * (data/app/athlete-context.json `keyPerformances`). Each entry needs
 * `distanceKm` and a finish (`timeSec`, else H:MM[:SS] `time`); `ctlAtRace` is
 * read from the entry or looked up by date in data/derived/pmc.csv (the
 * labeling convention, pipeline/lib/label.ts). Returns [] when the corpus is
 * absent (deployed site) or nothing is usable ⇒ generic fallback.
 */
export function loadRaceAnchors(): RaceAnchor[] {
  try {
    const ctxPath = join(process.cwd(), "data", "app", "athlete-context.json");
    if (!existsSync(ctxPath)) return [];
    const ctx = JSON.parse(readFileSync(ctxPath, "utf8"));
    const perfs: unknown = ctx?.keyPerformances;
    if (!Array.isArray(perfs) || perfs.length === 0) return [];
    let pmc: Map<string, number> | undefined;
    const anchors: RaceAnchor[] = [];
    for (const p of perfs as Array<Record<string, unknown>>) {
      const distanceKm = Number(p?.distanceKm);
      const timeSec = p?.timeSec != null ? Number(p.timeSec) : parseRaceTimeSec(p?.time);
      if (!(distanceKm > 0) || !(timeSec !== undefined && timeSec > 0)) continue;
      let ctl = p?.ctlAtRace != null ? Number(p.ctlAtRace) : NaN;
      if (!Number.isFinite(ctl) && typeof p?.date === "string") {
        pmc ??= loadPmcCtl();
        const v = pmc.get(p.date);
        if (v !== undefined) ctl = v;
      }
      if (!Number.isFinite(ctl)) continue;
      anchors.push({ date: typeof p?.date === "string" ? p.date : "", distanceKm, timeSec: timeSec!, ctlAtRace: ctl });
    }
    return anchors;
  } catch {
    return [];
  }
}

/** Race finish "H:MM:SS" or "H:MM" (hours:minutes) → seconds; undefined if bad. */
function parseRaceTimeSec(s: unknown): number | undefined {
  if (typeof s !== "string") return undefined;
  const parts = s.trim().split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  const total = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 3600 + parts[1] * 60;
  return total > 0 ? total : undefined;
}

/** date → CTL from data/derived/pmc.csv (header `date,tss,ctl,atl,tsb`). */
function loadPmcCtl(): Map<string, number> {
  const m = new Map<string, number>();
  try {
    const p = join(process.cwd(), "data", "derived", "pmc.csv");
    if (!existsSync(p)) return m;
    const [, ...rows] = readFileSync(p, "utf8").trim().split("\n");
    for (const r of rows) {
      const [date, , ctl] = r.split(",");
      if (date) m.set(date, Number(ctl));
    }
  } catch {
    /* corpus absent ⇒ empty map */
  }
  return m;
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
