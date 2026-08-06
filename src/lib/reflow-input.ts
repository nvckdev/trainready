import type { Plan, PlanRequest } from "../../engine/plan.ts";
import type { DoneMarkFill } from "../../engine/plan-ops.ts";
import { buildLedger, demonstratedTrailingTss, type ReplanInput } from "../../engine/replan.ts";
import { reflowSafeRequest, type ReconcileDecision } from "../../engine/reconcile.ts";
import { tooSpeculativeToPrescribe, type SeededState } from "../../engine/seed.ts";
import type { Zones } from "../../engine/zones.ts";
import type { TissueConstraintsRead } from "./tissue-constraints";

/**
 * The dashboard's reflow-input assembly — PURE, all reads passed in.
 *
 * This is the seam behind three of the 2026-08-06 verification findings
 * (②③⑤): every engine primitive it calls was pinned, but the ASSEMBLY — which
 * source feeds which field — lived inline in runReconcile where no test could
 * reach it, so a field silently re-sourced (actualTrailingTss from the raw
 * corpus rollup) or silently dropped (mobile's tissueConstraints) failed
 * nothing. The assembly is now a pure function of (stored, decision, fill,
 * sources), and reflow-input.test.ts snapshots the FULL assembled input
 * against fixed synthetic sources — any dropped or re-sourced field changes
 * the snapshot.
 *
 * runReconcile keeps the reads (getStateAt, loadTissueConstraintsTagged,
 * corpusWeeklyMeasured, …) and hands their results here. If a future field
 * cannot be passed in — if assembling it requires an in-function read — that
 * is a finding to report, not a reason to reach around this seam.
 */

export interface ReflowSources {
  /** getStateAt(asOf, gapEvidence(plan)) — the E8-seeded fitness state. */
  actualState: SeededState | null;
  /** loadTissueConstraintsTagged(asOf) — the E9 absent-vs-unreadable read. */
  tissue: TissueConstraintsRead;
  priorWeights: PlanRequest["priorWeights"] | undefined;
  eras: PlanRequest["eras"] | undefined;
  raceAnchors: PlanRequest["raceAnchors"];
  history: ReplanInput["history"];
  zones: Zones | null;
  /** corpusWeeklyMeasured().measured — E3-filtered pre-plan weekly load (⑤). */
  prePlanMeasured: Map<string, number>;
}

export type ReflowAssembly =
  /** Missing athlete or state — leave the stored plan alone, no error. */
  | { kind: "skip" }
  /** A safety refusal with the athlete-facing sentence. */
  | { kind: "refuse"; error: string }
  | { kind: "ready"; request: PlanRequest; input: ReplanInput };

export function buildReflowInput(
  stored: { request: PlanRequest; plan: Plan },
  decision: ReconcileDecision,
  fill: DoneMarkFill,
  s: ReflowSources
): ReflowAssembly {
  if (!s.zones || !s.actualState) return { kind: "skip" };

  // An assumed-zero day is not a measurement (E8). Unknown days can only ever
  // have ADDED load, so the state is a lower bound and the risk is
  // one-directional — but past a few days the understatement is large enough
  // to damp a season, so the reflow declines rather than acting on a state it
  // mostly assumed.
  if (tooSpeculativeToPrescribe(s.actualState)) {
    const since = s.actualState.anchorDate ?? "the last extraction";
    return {
      kind: "refuse",
      error: `${s.actualState.zeroLoadDays} days since ${since} have no training data from any source — refusing to re-plan from a fitness estimate that assumes you did nothing. Connect a source or refresh the extraction, and the plan will adapt.`,
    };
  }

  // The safety file's absent-vs-unreadable distinction (E9). ABSENT is a real
  // state; UNREADABLE must refuse — proceeding would silently rewrite the
  // plan without the athlete's declared tissue caps.
  if (s.tissue.status === "unreadable") {
    return {
      kind: "refuse",
      error: `athlete-context.json is unreadable (${s.tissue.message ?? "parse error"}) — refusing to re-plan without your declared injury constraints. Fix the file and re-plan.`,
    };
  }

  const request: PlanRequest = reflowSafeRequest(
    {
      ...stored.request,
      tissueConstraints: s.tissue.constraints,
      priorWeights: s.priorWeights,
      // E6: refreshed per reflow like tissue — never read inside the engine.
      eras: s.eras,
      raceAnchors: s.raceAnchors,
    },
    decision.asOf
  );

  return {
    kind: "ready",
    request,
    input: {
      stored: { request, plan: stored.plan },
      actualState: s.actualState,
      // ⑤: the SAME merged, E3-filtered evidence the gate and ledger use.
      actualTrailingTss: demonstratedTrailingTss(
        stored.plan.weeks,
        decision.asOf,
        fill.executed,
        fill.partial,
        s.prePlanMeasured
      ),
      ledger: buildLedger(stored.plan.weeks, decision.asOf, fill.executed, fill.partial),
      asOf: decision.asOf,
      history: s.history,
      zones: s.zones,
    },
  };
}
