import { CVOL } from "./goal.ts";

/**
 * Cross-training as volume substitution (feature 5). When a tissue constraint
 * caps weekly RUNNING load below the aerobic load the week's rails would
 * otherwise allow, the lost aerobic volume is offered back as NON-impact work
 * (bike/pool) so total aerobic load still lands on target — without adding
 * running impact the tissue can't take.
 *
 * The accounting rule that must never be broken: running-specific CTL and total
 * CTL are tracked SEPARATELY and never conflated, because only running load
 * predicts running performance. Cross-training builds the engine, not the legs.
 *
 * Pure module. No PMC recursion here — the split is computed from TSS targets;
 * generatePlan runs a second run-only τ=42/7 accumulator over the emitted load.
 */

export interface CrossTrainSplit {
  /** True when a tissue cap actually forced running below the aerobic target. */
  active: boolean;
  /** Running TSS the tissue allows this week. */
  runTss: number;
  /** Non-impact TSS added to close the aerobic gap (0 when inactive). */
  crossTss: number;
  /** run + cross — the total aerobic load the week now carries. */
  totalTss: number;
}

/**
 * Split a week's aerobic target into safe running + cross-training. `targetTss`
 * is the rail-safe weekly load; `runCapTss` is the tissue ceiling on running
 * (Infinity ⇒ no cap ⇒ inactive, split is all-running). Cross-training only
 * appears when the cap genuinely bites — never prophylactically.
 */
export function crossTrainSplit(targetTss: number, runCapTss: number): CrossTrainSplit {
  const runTss = Math.min(targetTss, runCapTss);
  const crossTss = Math.max(0, targetTss - runTss);
  return { active: crossTss > 1, runTss, crossTss, totalTss: runTss + crossTss };
}

/** km ⇄ TSS bridge for surfacing the cross-training volume as km-equivalent. */
export function tssToAerobicKm(tss: number): number {
  return tss / CVOL;
}

/** Which non-impact modality closes the gap. Bike is the default aerobic
 *  substitute; a pool option is offered when the gap is large enough to split. */
export function crossKindFor(gapTss: number): "bike-z2" | "swim-endurance" {
  return gapTss >= 40 ? "bike-z2" : "swim-endurance";
}
