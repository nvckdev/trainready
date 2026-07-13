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
    const clamped = Math.max(60, Math.min(trailingMean * hi, Math.max(trailingMean * lo, raw)));
    const guarded = raw !== clamped;

    const peakEra = this.eras?.find((e) => e.weight > 1);
    return {
      phase: ref.phase,
      weekTss: Math.round(clamped),
      sessions: Math.min(13, Math.max(3, Math.round(clamped / 62))),
      shares: ref.shares,
      rationale: `Learned from ${this.history.length} weeks of your history${peakEra ? ` (capability anchored on your ${peakEra.span} block)` : ""}: ${Math.round(raw)} TSS${guarded ? `, held to ${Math.round(clamped)} by the ${ref.phase} guardrail` : ""}. ${ref.rationale}`,
    };
  }
}
