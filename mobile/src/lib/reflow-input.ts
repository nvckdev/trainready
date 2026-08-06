import type { Plan, PlanRequest } from "../../engine/plan.ts";
import type { DoneMarkFill } from "../../engine/plan-ops.ts";
import { buildLedger, demonstratedTrailingTss, type ReplanInput } from "../../engine/replan.ts";
import { reflowSafeRequest, type ReconcileDecision } from "../../engine/reconcile.ts";
import { tooSpeculativeToPrescribe, type SeededState } from "../../engine/seed.ts";
import type { Zones } from "../../engine/zones.ts";
import type { TissueRead } from "./tissue-store";

/**
 * The phone's reflow-input assembly — PURE, all reads passed in. The mobile
 * twin of src/lib/reflow-input.ts, and the seam the 2026-08-06 verification
 * findings lived in: the engine primitives were pinned while the field-by-
 * field wiring (tissueConstraints missing entirely; the fitness state built
 * without coverage) was inline in reconcileIfDue where no test could reach
 * it. reflow-input.test.ts snapshots the assembled input against fixed
 * synthetic sources, so a dropped or re-sourced field changes the snapshot.
 *
 * The two surfaces' assemblers are deliberately parallel in SHAPE (skip /
 * refuse / ready) with surface-specific refusal wording — a phone's remedy is
 * tapping sessions, a dashboard's is refreshing the extraction. The engine
 * functions they assemble WITH are shared, so the meanings cannot drift.
 */

export interface MobileReflowSources {
  /** seedActualState(...) — the coverage-aware E8 state (fitness-seed.ts). */
  actualState: SeededState;
  /** readTissue(asOf) — the phone's declaration store, absent-vs-unreadable. */
  tissue: TissueRead;
  priorWeights: PlanRequest["priorWeights"];
  zones: Zones;
}

export type MobileReflowAssembly =
  | { kind: "refuse"; reason: string }
  | { kind: "ready"; request: PlanRequest; input: ReplanInput };

export function buildMobileReflowInput(
  stored: { request: PlanRequest; plan: Plan },
  decision: ReconcileDecision,
  fill: DoneMarkFill,
  s: MobileReflowSources
): MobileReflowAssembly {
  // E8, on the phone: a scheduled session with no tap, no import and no
  // coverage is an assumption, not a rest day — and a state built mostly of
  // assumptions is refused with the remedy the athlete can actually perform.
  if (tooSpeculativeToPrescribe(s.actualState)) {
    return {
      kind: "refuse",
      reason: `${s.actualState.zeroLoadDays} scheduled days since ${s.actualState.anchorDate ?? "pairing"} have no tap, no import and no coverage — refusing to re-plan from a fitness estimate that assumes you did nothing. Tap the sessions you completed and the plan will adapt.`,
    };
  }

  // The E9 discipline: caps that cannot be READ are not caps that are absent.
  if (s.tissue.status === "unreadable") {
    return {
      kind: "refuse",
      reason: `tissue-declarations unreadable (${s.tissue.message ?? "parse error"}) — refusing to re-plan without your declared injury limits`,
    };
  }

  const request: PlanRequest = reflowSafeRequest(
    { ...stored.request, priorWeights: s.priorWeights, tissueConstraints: s.tissue.constraints },
    decision.asOf
  );

  return {
    kind: "ready",
    request,
    input: {
      stored: { request, plan: stored.plan },
      actualState: s.actualState,
      // Same window builder as the dashboard; a phone has no pre-plan corpus,
      // so the pre-plan map stays empty (⑤).
      actualTrailingTss: demonstratedTrailingTss(stored.plan.weeks, decision.asOf, fill.executed, fill.partial),
      ledger: buildLedger(stored.plan.weeks, decision.asOf, fill.executed, fill.partial),
      asOf: decision.asOf,
      history: [],
      zones: s.zones,
    },
  };
}
