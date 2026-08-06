import { generatePlan, type Plan, type PlanRequest } from "../../engine/plan.ts";
import { recomputeRemaining } from "../../engine/replan.ts";
import { buildReflowInput } from "@/lib/reflow-input";
import {
  type DoneMarkFill,
  carryStatusForward,
  describeChange,
  planShape,
  preserveCompletedWeeks,
  withDoneMarkFallback,
} from "../../engine/plan-ops.ts";
import { evidenceComplete, reconcileGate, reflowSafeRequest, type ReconcileDecision, type WeekEvidence } from "../../engine/reconcile.ts";
import { loadEras, loadPopulationPrior } from "../../engine/learned.ts";
import { loadRaceAnchors } from "../../engine/goal.ts";
import { getAthlete, getHistory, getStateAt, intervalsConfigured, localToday, stravaConfigured } from "@/lib/athlete-data";
import { readPlan, writePlan } from "@/lib/plan-io";
import { loadTissueConstraintsTagged } from "@/lib/tissue-constraints";
import { dedupeActivities, executedByWeek as rollupByWeek, type Coverage, type ImportedActivity } from "../../engine/activity.ts";
import { thresholdMpsFromZones } from "../../engine/zones.ts";
import { corpusWeeklyMeasured } from "@/lib/connectors";
import { readSyncStore } from "@/lib/sync-io";
import { gapEvidence } from "@/lib/fitness-evidence";
import { nyDate } from "@/lib/imports-io";

/**
 * The reconcile runner (rule 12 gateway): all corpus I/O for the adaptive
 * re-plan lives here, the engine stays pure.
 *
 * This module is deliberately NOT "use server". src/app/app/actions.ts is, so
 * every export there becomes a server action and cannot be called from a
 * render — which the automatic trigger must do (it computes during render so
 * the visit that triggers it shows the NEW plan, and persists in after()).
 */

export interface StoredPlanShape {
  request: PlanRequest;
  plan: Plan;
}

/**
 * Evidence for the gate's closed-week check: the executed number plus whether
 * it is COMPLETE — settled past upload lag, with a post-close sync when a
 * remote source is configured, or corpus-measured outright. The gate treats
 * an incomplete number as a lower bound and refuses to lock an undershoot
 * verdict on it (evidence-settling).
 */
export function closedWeekEvidence(
  fill: DoneMarkFill,
  weekStart: string,
  today: string
): WeekEvidence | undefined {
  const v = fill.executed.get(weekStart);
  if (v === undefined) return undefined;
  return {
    tss: v,
    // Two independent reasons a number can be a lower bound, EITHER of which
    // forbids locking an undershoot on it: evidence still settling past the
    // week's close, or a partially tapped week whose untapped sessions are
    // unknowns — tap discipline is not training.
    complete:
      !fill.partial.has(weekStart) &&
      evidenceComplete({
        weekStart,
        today,
        hasRemoteSource: stravaConfigured() || intervalsConfigured(),
        lastSyncAt: readSyncStore().lastSyncAt,
        measured: corpusWeeklyMeasured().measured.has(weekStart),
      }),
  };
}

export function executedTssByWeek(plan: Plan): DoneMarkFill {
  const weekStarts = plan.weeks.map((w) => w.weekStart);
  const athlete = getAthlete();
  const ctx = athlete
    ? { runThresholdMps: thresholdMpsFromZones(athlete.zones), lthrBpm: athlete.thresholds.lthrBpm }
    : {};

  // Imported activities are the primary signal — what the athlete actually
  // trained, deduped across sources so a run pushed to three platforms counts
  // once. The corpus enters separately as measured WEEKLY load (it is a
  // rollup, not a session stream; summing the two would double-count).
  const sync = readSyncStore();
  const corpus = corpusWeeklyMeasured();
  const stream: ImportedActivity[] = dedupeActivities(sync.activities);
  const coverage: Coverage[] = [...corpus.coverage, ...sync.coverage];
  // Bucket by the athlete's calendar (America/New_York — the same clock the
  // plan's dates live in), not UTC: an 8:30 pm Sunday run is Monday UTC and
  // would migrate into the next ledger week (E7).
  const fromImports = rollupByWeek(weekStarts, stream, coverage, ctx, corpus.measured, (iso) => nyDate(new Date(iso)));

  // Done-marks remain a LAST-RESORT positive signal: they can raise a week the
  // importers never saw, but they can never authorize a zero (engine plan-ops,
  // shared with mobile so the precedence cannot drift between surfaces).
  return withDoneMarkFallback(plan.weeks, fromImports);
}

export interface ReconcileOutcome {
  decision: ReconcileDecision;
  /** The plan to render. When the gate did not fire this is the stored plan. */
  stored: StoredPlanShape | null;
  /** Set when a reflow actually changed the plan — call it to persist. */
  commit: (() => void) | null;
  /** The engine's own note, when the reflow produced one. */
  note: string | null;
  /** Populated when the reflow threw; the stored plan is left untouched. */
  error: string | null;
}

/**
 * Decide, and if due, reflow — WITHOUT persisting. The caller renders the
 * returned plan and invokes `commit()` from `after()`, so nothing mutates
 * during render and the athlete never sees a one-visit-stale plan.
 *
 * Returns `commit: null` whenever the result is byte-identical to what is
 * already stored, so an on-plan week is a true no-op: no write, no note, no
 * "Re-planned" stamp.
 */
export function reconcileIfDue(today = localToday()): ReconcileOutcome {
  const stored = readPlan();
  if (!stored) {
    return {
      decision: { due: false, reason: "no-plan", closedWeekStart: null, plannedTss: 0, executedTss: 0, deltaPct: 0, asOf: today },
      stored: null,
      commit: null,
      note: null,
      error: null,
    };
  }
  const executed = executedTssByWeek(stored.plan);
  const decision = reconcileGate({
    weeks: stored.plan.weeks,
    raceDate: stored.request.raceDate,
    lastRecomputed: stored.plan.meta.lastRecomputed,
    today,
    executedTssFor: (ws) => closedWeekEvidence(executed, ws, today),
  });
  return runReconcile(stored, decision, executed);
}

/** The shared reflow body. Both the automatic and manual paths reach it with
 *  an already-made decision, so the manual override cannot be re-gated by the
 *  tolerance/idempotence branches it deliberately opened. */
function runReconcile(
  stored: StoredPlanShape,
  decision: ReconcileDecision,
  fill: DoneMarkFill
): ReconcileOutcome {
  if (!decision.due) return { decision, stored, commit: null, note: null, error: null };

  const athlete = getAthlete();
  // All reads gathered HERE; the assembly itself is pure (reflow-input.ts) so
  // the field-by-field wiring is snapshot-tested. E8: the state that seeds
  // this reflow must see the evidence the gate just judged on — same merged
  // daily stream, same recursion (fitness-evidence).
  const assembly = buildReflowInput(stored, decision, fill, {
    actualState: getStateAt(decision.asOf, gapEvidence(stored.plan)),
    tissue: loadTissueConstraintsTagged(decision.asOf),
    priorWeights: loadPopulationPrior() ?? undefined,
    eras: loadEras() ?? undefined,
    raceAnchors: loadRaceAnchors(),
    history: getHistory().map((h) => ({ state: h.state, actualTss: h.actualTss, weekStart: h.weekStart })),
    zones: athlete?.zones ?? null,
    prePlanMeasured: corpusWeeklyMeasured().measured,
  });
  if (assembly.kind === "skip") return { decision, stored, commit: null, note: null, error: null };
  if (assembly.kind === "refuse") {
    return { decision, stored, commit: null, note: null, error: assembly.error };
  }
  const { request, input } = assembly;

  let result;
  try {
    result = recomputeRemaining(input);
  } catch (e) {
    // The gate is the primary defence; this exists so an unforeseen invariant
    // can never leave the athlete without a plan. Leave the stored plan alone.
    return { decision, stored, commit: null, note: null, error: e instanceof Error ? e.message : String(e) };
  }

  const plan = result.plan;
  preserveCompletedWeeks(stored.plan, plan);
  plan.meta.lastRecomputed = result.lastRecomputed;
  // The plan is about to change under the athlete. If the engine's rules did
  // not produce a note, say what happened anyway — a silent rewrite is the
  // one outcome this feature must never have.
  if (result.note) plan.meta.replanNote = result.note;
  else plan.meta.replanNote = describeChange(decision);
  if (result.recalibration) plan.meta.recalibration = result.recalibration;
  else delete plan.meta.recalibration;
  carryStatusForward(stored.plan, plan);

  // True no-op check: if the reflow reproduced the stored plan, don't write.
  if (planShape(plan) === planShape(stored.plan)) {
    return { decision, stored, commit: null, note: null, error: null };
  }

  const next: StoredPlanShape = { request, plan };
  return {
    decision,
    stored: next,
    commit: () => writePlan(next),
    note: result.note,
    error: null,
  };
}

/**
 * The manual override, reused by the "Re-plan from today" button. Same
 * machinery, but it ignores the gate's tolerance/idempotence branches — the
 * athlete asked for it explicitly. The taper lock and the throw-guards still
 * apply: those are safety, not preference.
 */
export function reconcileNow(today = localToday()): ReconcileOutcome {
  const stored = readPlan();
  if (!stored) {
    return {
      decision: { due: false, reason: "no-plan", closedWeekStart: null, plannedTss: 0, executedTss: 0, deltaPct: 0, asOf: today },
      stored: null,
      commit: null,
      note: null,
      error: null,
    };
  }
  // Open the two PREFERENCE branches — tolerance (negative ⇒ nothing is "close
  // enough") and idempotence (no stamp passed) — while every SAFETY branch
  // (race passed, taper lock, too few weeks, no closed week) still evaluates.
  const executed = executedTssByWeek(stored.plan);
  const decision = reconcileGate({
    weeks: stored.plan.weeks,
    raceDate: stored.request.raceDate,
    today,
    // complete: true — the manual button is the athlete explicitly saying
    // "judge with what you have, now". The settling refusal exists to stop
    // AUTOMATIC verdicts on arriving evidence, not to overrule a person.
    // complete: true even for a partially tapped week — unlike the automatic
    // gate, which now treats partial as a lower bound. The manual button must
    // stay usable by the athlete who genuinely skipped sessions and cannot
    // honestly tap them; the LEDGER inside runReconcile still refuses to let
    // those weeks feed missStreak or demonstrated capacity.
    executedTssFor: (ws) => {
      const v = executed.executed.get(ws);
      return v === undefined ? undefined : { tss: v, complete: true };
    },
    tolerance: -1,
  });
  return runReconcile(stored, decision, executed);
}

/** Fallback used when there is no corpus to reconcile against. */
export function regenerateFromToday(request: PlanRequest): void {
  const athlete = getAthlete();
  const today = localToday();
  // Same evidence as the reflow: generation and reconcile must never disagree
  // about who the athlete is (the mobile M5 lesson, applied on the dashboard).
  const state = getStateAt(today, gapEvidence(readPlan()?.plan ?? null));
  if (!athlete || !state) throw new Error("no corpus: import training history first");
  const req: PlanRequest = reflowSafeRequest(
    { ...request, startDate: today, eras: loadEras() ?? undefined, raceAnchors: loadRaceAnchors() },
    today
  );
  const plan = generatePlan(req, state, [], athlete.zones);
  writePlan({ request: req, plan });
}
