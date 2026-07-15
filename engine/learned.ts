import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { referenceEngine } from "./reference.ts";
import type { AthleteState, Engine, WeekPrescription } from "./types.ts";

/**
 * taper-v1: a learned prescription layer inside physiology guardrails.
 *
 * A ridge regression maps athlete state → next week's load, trained only on
 * weeks the athlete has already lived (walk-forward, refit as history grows,
 * zero look-ahead). Its output is then clamped into phase-dependent bounds
 * derived from the reference engine's periodization rules, so the learned
 * layer personalizes *within* the safety scaffold (PRD §6: priors as the
 * backbone, learned components on top).
 *
 * Era weighting: when data/app/athlete-context.json declares trainingEras,
 * training samples are weighted era_weight × recency_decay so that CAPABILITY
 * (what load the athlete has demonstrated they can absorb, i.e. the learned
 * state→load mapping) anchors on the primary/peak era instead of being
 * dragged down by a recent reduced-volume era. STATE stays current: the
 * features fed at prescription time are today's CTL/ATL/TSB, and the phase
 * bounds + ramp caps still govern the path back up — era weighting never
 * lets the engine jump to peak-era load. With no context file (or an
 * unparseable one) sample weights are not applied at all and behavior is
 * bit-for-bit the previous unweighted regression.
 */

type Example = { state: AthleteState; actualTss: number; weekStart?: string };

const LAMBDA = 12; // ridge strength
const MIN_TRAIN = 24; // weeks of history before the learned layer activates
const PEAK_ERA_WEIGHT = 2; // primary-era weeks count double for capability
const RECENCY_HALF_LIFE_WEEKS = 156; // gentle decay; eras carry the signal

interface Era {
  span: string; // as written in athlete-context.json, for rationale text
  startMonth: string; // "YYYY-MM"
  endMonth: string | null; // null = present
  weight: number;
}

/**
 * Reads trainingEras from data/app/athlete-context.json (gitignored corpus).
 * Returns null — meaning "no era weighting, legacy behavior exactly" — when
 * the file is absent, unreadable, or any span fails to parse. Never throws:
 * the corpus-less CI path must stay deterministic.
 */
function loadEras(): Era[] | null {
  try {
    const path = join(process.cwd(), "data", "app", "athlete-context.json");
    if (!existsSync(path)) return null;
    const ctx = JSON.parse(readFileSync(path, "utf8")) as {
      trainingEras?: Array<{ span?: string; weight?: string }>;
    };
    if (!Array.isArray(ctx.trainingEras) || ctx.trainingEras.length === 0) return null;
    const eras: Era[] = [];
    for (const e of ctx.trainingEras) {
      const span = String(e.span ?? "").trim();
      const m = /^(\d{4}-\d{2})\s*(?:→|->)\s*(\d{4}-\d{2}|present)$/.exec(span);
      if (!m) return null; // one bad span disables the feature, not the engine
      eras.push({
        span,
        startMonth: m[1],
        endMonth: m[2] === "present" ? null : m[2],
        weight: String(e.weight ?? "").startsWith("primary") ? PEAK_ERA_WEIGHT : 1,
      });
    }
    return eras;
  } catch {
    return null;
  }
}

function eraWeightFor(eras: Era[], weekStart: string): number {
  const month = weekStart.slice(0, 7);
  for (const e of eras) {
    if (month >= e.startMonth && (e.endMonth === null || month <= e.endMonth)) return e.weight;
  }
  return 1;
}

function featurize(s: AthleteState): number[] {
  const last4 = s.last4WeeksTss;
  const mean4 = last4.reduce((a, b) => a + b, 0) / Math.max(1, last4.length);
  const slope4 = last4.length >= 2 ? last4[last4.length - 1] - last4[0] : 0;
  const d = s.daysToNextRace;
  return [
    1, // intercept
    s.ctl,
    s.atl,
    s.tsb,
    mean4,
    slope4,
    s.breakRatio,
    Math.min(30, s.daysSinceLastSession),
    d !== null && d <= 21 ? 1 : 0, // taper window
    d !== null && d <= 7 ? 1 : 0, // race week
    s.weeksSinceStart % 4 === 3 ? 1 : 0, // cutback rhythm slot
  ];
}

/** Solve (XᵀX + λI)w = Xᵀy via Gaussian elimination (k is tiny). */
function ridge(X: number[][], y: number[], lambda: number): number[] {
  const k = X[0].length;
  const A: number[][] = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => {
      let s = i === j && i > 0 ? lambda : i === j ? 1e-9 : 0; // don't shrink intercept
      for (const row of X) s += row[i] * row[j];
      return s;
    })
  );
  const b: number[] = Array.from({ length: k }, (_, i) =>
    X.reduce((s, row, r) => s + row[i] * y[r], 0)
  );
  // Gaussian elimination with partial pivoting
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    const div = A[col][col] || 1e-9;
    for (let r = col + 1; r < k; r++) {
      const f = A[r][col] / div;
      for (let c = col; c < k; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const w = new Array(k).fill(0);
  for (let r = k - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < k; c++) s -= A[r][c] * w[c];
    w[r] = s / (A[r][r] || 1e-9);
  }
  return w;
}

// ——— anchor-v2 (DEFAULT ON; legacy escape hatch) ————————————————————
//
// The legacy upper clamp is trailing-month mean × phase fraction, which a
// single outlier week can drag around (one 334-TSS week among ~50-TSS weeks
// pulled the "mean" to 125). Anchor-v2, explicitly proposed by the human
// (documented sign-off per taper-rules rule 4), is now the DEFAULT (flipped
// 2026-07-13 with the human's sign-off, once the week-1 base-floor leak below
// was root-caused — see isFirstPlanWeek). The legacy trailing-mean path is
// still reachable via opts.anchorLegacy or env ANCHOR_LEGACY=1. Anchor-v2
// replaces that ceiling for base/build/offseason weeks with
//   anchor = max(maintenance CTL×7, recent peak week × 0.95^(weeks since peak))
//   capped at +20% over the ramp-cap reference (approved range 20–25%,
//   shipping 20).
// Ramp-cap reference (audit round 2 smoothing): max(previous non-zero week,
// 0.7 × best week in the trailing 6). With the reference pinned to just the
// previous non-zero week, one small week right after an outlier collapsed
// the cap (observed: ..., 334, 40 → cap 40×1.2 = 48 → weekly floor), so an
// outlier's influence VANISHED the moment it stopped being the previous
// week. The 0.7 × best-of-6 term lets that influence decay across the
// window instead.
// Rails still apply after: the TSB floor (−25 forces the recovery phase
// upstream in the reference engine) and the weekly floor of 60 TSS.
// Taper/race weeks never reach this code (protocol lock, rule 2).

const ANCHOR_V2_PEAK_DECAY = 0.95; // per week since the peak week
const ANCHOR_V2_RAMP_CAP = 1.2; // ≤ +20% over the ramp-cap reference
const ANCHOR_V2_BEST_WINDOW = 6; // trailing weeks scanned for the best week
const ANCHOR_V2_BEST_FRACTION = 0.7; // outlier influence decays to 70%, not to 0
const ANCHOR_V2_MAX_CUT = 0.65; // consecutive prescriptions may fall ≤ 35%
// Week-1 base floor (audit round 2, fix 3): post-seed-fix a plan's first week
// opens ≈ maintenance (CTL×7), which HOLDS fitness but cannot build it. With
// ≤ 14 weeks of runway to the race and a base/build week, floor the first
// plan week at 1.15 × maintenance so the season actually opens with an
// overload — still under the rule-4 ramp rails (see prescribeWeek).
const ANCHOR_V2_BASE_FLOOR = 1.15; // × maintenance (CTL×7)
const ANCHOR_V2_BASE_FLOOR_RUNWAY_DAYS = 98; // 14 weeks
// Goal-backed periodization floor (docs/periodization-spec.md §2.1).
// Fires ONLY when generatePlan threaded a race goal onto the state
// (state.goalPeakCtl) — plan-only, absent on the backtest replay path. It
// generalizes the week-1 base floor to every base/build week while CTL is
// still short of the goal summit, pushing the week toward the +20% ramp
// CEILING so CTL climbs (rule 4: build weeks may push toward the cap, never
// exceed it). The calf/tendon protection is NOT an extra weekly haircut — it
// lives in the long-run distance progression (engine/goal.ts, ≤ +2 km/wk,
// 24 km cap) and the −25 TSB floor, which route the reference engine to a
// recovery week before load ever gets dangerous. The floor is itself
// min()-capped by the SAME rails as the base floor (trailing-month mean and
// the smoothed ramp-cap reference), so it can never breach them.
const ANCHOR_V2_GOAL_RAMP = ANCHOR_V2_RAMP_CAP; // +20% ramp ceiling (the rail)

/** Newest non-zero executed/prescribed week — the classic ramp base. */
function prevNonZeroWeek(state: AthleteState): number | undefined {
  return [...state.last4WeeksTss].reverse().find((v) => v > 0);
}

/** max(previous non-zero week, 0.7 × best week in the trailing 6): the
 *  smoothed base the +20% anchor ramp cap is measured against. */
function rampCapRef(state: AthleteState): number {
  const trailing = (state.trailingWeeksTss ?? state.last4WeeksTss).slice(-ANCHOR_V2_BEST_WINDOW);
  return Math.max(prevNonZeroWeek(state) ?? 0, ANCHOR_V2_BEST_FRACTION * Math.max(0, ...trailing));
}

function anchorV2Ceiling(state: AthleteState): number {
  const maintenance = state.ctl * 7; // weekly TSS that holds CTL steady
  const weeks = state.last4WeeksTss; // oldest → newest
  let peak = 0;
  for (let i = 0; i < weeks.length; i++) {
    const weeksSincePeak = weeks.length - 1 - i; // newest completed week = 0
    peak = Math.max(peak, weeks[i] * Math.pow(ANCHOR_V2_PEAK_DECAY, weeksSincePeak));
  }
  let anchor = Math.max(maintenance, peak);
  const capRef = rampCapRef(state);
  if (capRef > 0) anchor = Math.min(anchor, capRef * ANCHOR_V2_RAMP_CAP);
  return anchor;
}

export interface TaperV1Options {
  /** Anchor-v2 ceiling for non-taper weeks. NOW THE DEFAULT (flipped
   *  2026-07-13, human sign-off). Kept only as a harmless no-op alias — it
   *  no longer toggles anything, since anchor-v2 is standard. Existing callers
   *  and scripts that pass it (or set env TAPER_ANCHOR_V2=1) keep working. To
   *  turn anchor-v2 OFF, use `anchorLegacy` below, not `anchorV2: false`. */
  anchorV2?: boolean;
  /** Escape hatch back to the pre-anchor-v2 legacy path (trailing-mean ×
   *  phase ceiling, no week-1 base floor, no smoothing band). Byte-identical
   *  to the old flag-off behavior. Also switchable via env ANCHOR_LEGACY=1.
   *  Default false → anchor-v2 is on. */
  anchorLegacy?: boolean;
}

/** Phase-dependent bounds (fractions of trailing-month mean) the learned
 *  output may not leave. The scaffold, not the pilot. */
function bounds(state: AthleteState, phase: WeekPrescription["phase"]): [number, number] {
  switch (phase) {
    case "race":
      return [0.25, 0.6];
    case "taper":
      return [0.5, 0.95];
    case "offseason":
      return [0.3, 1.2];
    case "recovery":
      return [0.5, 0.95];
    default:
      return state.tsb < -25 ? [0.5, 0.9] : [0.55, 1.2];
  }
}

export class TaperV1 implements Engine {
  name = "taper-v1";
  private history: Example[] = [];
  private weights: number[] | null = null;
  private eras: Era[] | null = loadEras();
  private anchorV2: boolean;

  constructor(opts: TaperV1Options = {}) {
    // Anchor-v2 + smoothing is the standard path (default flipped 2026-07-13,
    // human sign-off). The ONLY way back to the legacy trailing-mean ceiling
    // is the explicit escape hatch: opts.anchorLegacy or env ANCHOR_LEGACY=1.
    // opts.anchorV2 / env TAPER_ANCHOR_V2 are still accepted but are now no-ops
    // (anchor-v2 is already on) — kept so existing callers don't break.
    const legacy = opts.anchorLegacy ?? process.env.ANCHOR_LEGACY === "1";
    this.anchorV2 = !legacy;
  }

  /** Walk-forward learning: record what actually happened, refit. */
  observe(state: AthleteState, actualTss: number, weekStart?: string): void {
    this.history.push({ state, actualTss, weekStart });
    if (this.history.length >= MIN_TRAIN) {
      const X = this.history.map((e) => featurize(e.state));
      const y = this.history.map((e) => e.actualTss);
      const w = this.sampleWeights();
      if (w) {
        // Weighted least squares via row scaling: XᵀWX = (√W·X)ᵀ(√W·X).
        for (let i = 0; i < X.length; i++) {
          const s = Math.sqrt(w[i]);
          X[i] = X[i].map((v) => v * s);
          y[i] *= s;
        }
      }
      this.weights = ridge(X, y, LAMBDA);
    }
  }

  /**
   * weight = era_weight × recency_decay. Null (no weighting at all) unless
   * trainingEras are configured — keeping the era-less path byte-identical
   * to the pre-era engine. Weeks without a known start date get era weight 1.
   */
  private sampleWeights(): number[] | null {
    if (!this.eras) return null;
    const n = this.history.length;
    return this.history.map((e, i) => {
      const eraW = e.weekStart ? eraWeightFor(this.eras!, e.weekStart) : 1;
      const decay = Math.pow(0.5, (n - 1 - i) / RECENCY_HALF_LIFE_WEEKS);
      return eraW * decay;
    });
  }

  prescribeWeek(state: AthleteState): WeekPrescription {
    const ref = referenceEngine.prescribeWeek(state);
    // The taper is protocol, not preference: race-proximal weeks follow the
    // physiology schedule exactly; the learned layer has no vote.
    if (ref.phase === "taper" || ref.phase === "race") return ref;
    if (!this.weights) {
      return { ...ref, rationale: `${ref.rationale} (learned layer warming up: ${this.history.length}/${MIN_TRAIN} weeks observed)` };
    }

    const x = featurize(state);
    const raw = x.reduce((s, xi, i) => s + xi * this.weights![i], 0);

    const trailingMean =
      state.last4WeeksTss.reduce((s, v) => s + v, 0) /
      Math.max(1, state.last4WeeksTss.length);
    const [lo, hi] = bounds(state, ref.phase);
    // Flag OFF (default): the legacy trailing-mean ceiling, byte-identical.
    // Flag ON, base/build/offseason only: the anchor-v2 ceiling replaces
    // trailingMean × hi (the +20% ramp cap is baked into the anchor itself,
    // so hi is not applied on top). Recovery weeks keep the legacy bounds —
    // the TSB floor already routed them there, and rails are rails.
    const useAnchor =
      this.anchorV2 && (ref.phase === "base" || ref.phase === "build" || ref.phase === "offseason");
    let ceiling = useAnchor ? anchorV2Ceiling(state) : trailingMean * hi;
    // Anchor-v2 smoothing extends to recovery weeks' CEILING only (floors and
    // phase routing stay legacy — rails are rails): the legacy trailing-mean
    // ceiling is outlier-inflatable (a 334-TSS week keeps the mean high for a
    // month), which whipsawed targets +72% INTO a cutback week. Under the
    // flag a recovery week may not exceed +20% over the previous non-zero
    // week; tightening a cutback's upper bound only ever lowers load.
    if (this.anchorV2 && ref.phase === "recovery") {
      const prev = prevNonZeroWeek(state);
      if (prev !== undefined) ceiling = Math.min(ceiling, prev * ANCHOR_V2_RAMP_CAP);
    }
    let value = Math.min(ceiling, Math.max(trailingMean * lo, raw));
    // Anchor-v2 week-1 base floor: the FIRST plan week only (isFirstPlanWeek —
    // generatePlan sets it on week 0), base/build, race ≤ 14 weeks out — lift
    // the opening week to 1.15 × maintenance (CTL×7) so a short runway starts
    // with an overload instead of a hold. The trigger is the EXPLICIT
    // first-plan-week signal, NOT `prevPrescribedTss === undefined`: that proxy
    // is also true for every backtest week, so it leaked the floor onto ~47
    // base/build backtest weeks and regressed the pinned baselines when
    // anchor-v2 became the default (measured 89.3/0.78/73). engine/backtest.ts
    // never sets isFirstPlanWeek, so the floor cannot fire in the backtest.
    // The floor may raise the value past the anchor CEILING (a preference, not
    // a rail) but never past the rule-4 rails: +20% over the trailing-month
    // mean AND over the smoothed ramp-cap reference. Weeks 2+ ramp from it
    // under the normal anchor rules (WoW band below). Taper/race weeks never
    // reach this code (protocol lock, rule 2); recovery keeps its legacy
    // bounds — rails are rails.
    let baseFloorLift = false;
    if (
      this.anchorV2 &&
      (ref.phase === "base" || ref.phase === "build") &&
      state.isFirstPlanWeek === true &&
      state.daysToNextRace !== null &&
      state.daysToNextRace <= ANCHOR_V2_BASE_FLOOR_RUNWAY_DAYS
    ) {
      const floor = Math.min(
        ANCHOR_V2_BASE_FLOOR * state.ctl * 7,
        trailingMean * ANCHOR_V2_RAMP_CAP,
        rampCapRef(state) * ANCHOR_V2_RAMP_CAP
      );
      if (floor > value) {
        value = floor;
        baseFloorLift = true;
      }
    }
    // Goal-backed periodization floor (spec §2.1): plan-only (gated on the
    // explicit goalPeakCtl signal — never set on the backtest path), base/build
    // only, and only while CTL is still short of the goal summit. Aims at the
    // injury-tempered ramp ceiling so every build week overloads at (just
    // under) the rails and CTL rises. It is placed AFTER the week-1 base floor
    // and BEFORE the WoW smoothing band + weekly-60 clamp, so all rule-4 rails
    // still bind afterward. Recovery weeks keep their legacy cutback bounds, so
    // the trajectory dips on cutbacks: rise, rise, rise, dip, rise → rising CTL.
    // Auto-off once state.ctl ≥ goalPeakCtl (the climb flattens at the peak
    // instead of overshooting past what the race needs).
    let goalFloorLift = false;
    if (
      this.anchorV2 &&
      (ref.phase === "base" || ref.phase === "build") &&
      state.goalPeakCtl !== undefined && // plan-only — absent in the backtest
      state.ctl < state.goalPeakCtl // stop overloading once at the summit
    ) {
      // Injury-tempered ramp ceiling: never above the +20% rail over the trailing
      // month or the smoothed ramp-cap reference, and never above the weekly TSS
      // the goal summit itself implies (no overshoot).
      const rampCeil = Math.min(trailingMean * ANCHOR_V2_GOAL_RAMP, rampCapRef(state) * ANCHOR_V2_GOAL_RAMP);
      const goalWeekly = state.goalPeakCtl * 7;
      const goalFloor = Math.min(rampCeil, goalWeekly);
      if (goalFloor > value) {
        value = goalFloor;
        goalFloorLift = true;
      }
    }
    // Anchor-v2 week-over-week smoothing band: within a simulated plan (the
    // caller tells us its own previous prescription), consecutive targets
    // move at most +20% / −35%. The band deliberately does NOT apply to the
    // first plan week — there the ramp-cap reference above (max(prev
    // non-zero week, 0.7 × best of trailing 6)) is what keeps one small
    // post-outlier week from collapsing the ceiling to the weekly floor.
    // Taper/race weeks never reach this code (protocol lock, rule 2).
    if (this.anchorV2 && state.prevPrescribedTss !== undefined) {
      value = Math.min(
        Math.max(value, state.prevPrescribedTss * ANCHOR_V2_MAX_CUT),
        state.prevPrescribedTss * ANCHOR_V2_RAMP_CAP
      );
    }
    const clamped = Math.max(60, value);
    const guarded = raw !== clamped;

    const peakEra = this.eras?.find((e) => e.weight > 1);
    return {
      phase: ref.phase,
      weekTss: Math.round(clamped),
      sessions: Math.min(13, Math.max(3, Math.round(clamped / 62))),
      shares: ref.shares,
      rationale: `Learned from ${this.history.length} weeks of your history${peakEra ? ` (capability anchored on your ${peakEra.span} block)` : ""}: ${Math.round(raw)} TSS${guarded ? (goalFloorLift ? `, lifted to ${Math.round(clamped)} by the goal target (race needs peak CTL ~${Math.round(state.goalPeakCtl!)}; ramping at the +20% ceiling, long run calf-capped)` : baseFloorLift ? `, lifted to ${Math.round(clamped)} by the week-1 base floor (1.15× maintenance — the race is inside 14 weeks, so the opening week must build, not hold)` : `, held to ${Math.round(clamped)} by the ${useAnchor ? "anchor-v2" : ref.phase} guardrail`) : ""}. ${ref.rationale}`,
    };
  }
}
