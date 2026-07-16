import type { Block, PlannedSessionOut, WorkoutStructure } from "./plan.ts";
import type { Phase, Zone } from "./types.ts";

/**
 * Intensity distribution as a first-class training variable (feature 1).
 *
 * TSS is intensity-blind — 150 TSS can be 90% easy or 50/50. The actual
 * training variable is how TIME is distributed across intensity zones. We model
 * every prescribed RUN session into three physiological zones (by time, not
 * distance) and enforce a hard Z1 floor: distribution is the constraint, volume
 * follows. Only running load predicts running performance, so distribution is
 * computed over run sessions.
 *
 * Pure and presentation-adjacent: reads the structured blocks the engine
 * already emits; never touches the PMC recursion or the backtest path.
 */

export type Zone3 = "z1" | "z2" | "z3";

/** Physiological 3-zone model (Seiler): Z1 below LT1 (easy/recovery), Z2 the
 *  LT1–LT2 band (tempo/sub-threshold), Z3 at or above LT2 (threshold, CV, VO2,
 *  race efforts). Threshold work sits AT LT2 ⇒ Z3. */
export const ZONE3: Record<Zone, Zone3> = {
  recovery: "z1",
  easy: "z1",
  tempo: "z2",
  threshold: "z3",
  cv: "z3",
  vo2: "z3",
  race: "z3",
};

/** Hard floor — no generated week may fall below this share of Z1 by time. */
export const Z1_FLOOR = 0.8;

export interface Distribution {
  z1Sec: number;
  z2Sec: number;
  z3Sec: number;
  totalSec: number;
  z1Pct: number;
  z2Pct: number;
  z3Pct: number;
}

/** Work seconds a block contributes (reps × per-rep size). Runs carry
 *  durationSec; a distance-defined block derives time from its pace window. */
function blockWorkSec(b: Block): number {
  let per = b.durationSec ?? 0;
  if (per === 0 && b.distanceM != null) {
    const pace = b.paceMinSecPerKm != null && b.paceMaxSecPerKm != null
      ? (b.paceMinSecPerKm + b.paceMaxSecPerKm) / 2
      : (b.paceMinSecPerKm ?? b.paceMaxSecPerKm ?? 0);
    per = (b.distanceM / 1000) * pace;
  }
  return per * (b.reps ?? 1);
}

/** Between-rep recovery time (N reps ⇒ N−1 easy jogs) — always Z1. */
function blockRecoverySec(b: Block): number {
  return (b.recoverySec ?? 0) * Math.max(0, (b.reps ?? 1) - 1);
}

/** Time-in-zone (seconds) for one session's structure. */
export function sessionZoneSeconds(w: WorkoutStructure): { z1: number; z2: number; z3: number } {
  let z1 = 0;
  let z2 = 0;
  let z3 = 0;
  for (const b of w.blocks) {
    const work = blockWorkSec(b);
    const zone = ZONE3[b.zone];
    if (zone === "z1") z1 += work;
    else if (zone === "z2") z2 += work;
    else z3 += work;
    z1 += blockRecoverySec(b); // recovery jog is easy
  }
  return { z1, z2, z3 };
}

/** Running intensity distribution across a week's run TRAINING sessions
 *  (time-weighted). Non-run and the race event (discipline "race") are excluded
 *  — you can't race easy, and only running load shapes running distribution. */
export function weekDistribution(sessions: PlannedSessionOut[]): Distribution {
  let z1 = 0;
  let z2 = 0;
  let z3 = 0;
  for (const s of sessions) {
    if (s.discipline !== "run" || !s.workout) continue;
    const zs = sessionZoneSeconds(s.workout);
    z1 += zs.z1;
    z2 += zs.z2;
    z3 += zs.z3;
  }
  const total = z1 + z2 + z3;
  return {
    z1Sec: z1,
    z2Sec: z2,
    z3Sec: z3,
    totalSec: total,
    z1Pct: total ? z1 / total : 0,
    z2Pct: total ? z2 / total : 0,
    z3Pct: total ? z3 / total : 0,
  };
}

/**
 * Target distribution by phase. Base/build sit near 88–92% Z1 with the
 * remainder split across Z2/Z3 — this tracks season-long ELITE descriptive
 * data, not the folk "80/20". Race-specific phases (taper/race) shift a little
 * more volume into Z2/Z3 for race-pace sharpening, but never below the floor.
 *
 * Confidence: elite-practice tier — this tracks descriptive distribution data
 * from elite training logs, not a controlled trial. We say "elites train this
 * way", not "research proves this is optimal". (Feature 6 formalizes the tier.)
 */
export function targetDistribution(phase: Phase): { z1: number; z2: number; z3: number } {
  switch (phase) {
    case "base":
      return { z1: 0.9, z2: 0.05, z3: 0.05 };
    case "build":
      return { z1: 0.88, z2: 0.06, z3: 0.06 };
    case "recovery":
    case "offseason":
      return { z1: 0.92, z2: 0.04, z3: 0.04 };
    case "taper":
      return { z1: 0.85, z2: 0.09, z3: 0.06 };
    case "race":
      return { z1: 0.82, z2: 0.1, z3: 0.08 };
    default:
      return { z1: 0.9, z2: 0.05, z3: 0.05 };
  }
}
