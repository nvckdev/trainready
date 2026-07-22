import { generatePlan, type Plan, type PlanRequest } from "../../engine/plan.ts";
import { recomputeRemaining, type WeekActual } from "../../engine/replan.ts";
import { reconcileGate, reflowSafeRequest, type ReconcileDecision } from "../../engine/reconcile.ts";
import { loadPopulationPrior } from "../../engine/learned.ts";
import { getAthlete, getHistory, getStateAt, getWeekly, localToday } from "@/lib/athlete-data";
import { readPlan, writePlan } from "@/lib/plan-io";
import { loadTissueConstraints } from "@/lib/tissue-constraints";

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

/** Index of the plan week containing `today` (else the next upcoming week). */
export function currentWeekIndex(weeks: Plan["weeks"], today: string): number {
  for (let i = 0; i < weeks.length; i++) {
    const end = weeks[i + 1]?.weekStart ?? "9999-12-31";
    if (today >= weeks[i].weekStart && today < end) return i;
  }
  return weeks.length ? 0 : -1;
}

/**
 * Executed weekly TSS: real logged load from the corpus, falling back to the
 * sum of done-marked sessions when a week has no logged activities. Same
 * precedence the manual re-plan has always used.
 */
export function executedTssByWeek(plan: Plan): Map<string, number> {
  const weekly = getWeekly();
  const logged = new Map(weekly.map((r) => [r.weekStart, r.tss]));
  // How far the extraction pipeline has actually reached. Beyond this the
  // corpus is SILENT, not empty — a week with no row and no done-marks is
  // unknown, and the gate must refuse rather than assume zero training.
  const coveredThrough = weekly.length ? weekly[weekly.length - 1].weekStart : null;
  const out = new Map<string, number>();
  for (const w of plan.weeks) {
    const row = logged.get(w.weekStart);
    if (row !== undefined) {
      out.set(w.weekStart, Math.round(row));
      continue;
    }
    const done = w.sessions.filter((s) => s.status === "done").reduce((a, s) => a + s.tss, 0);
    if (done > 0) {
      out.set(w.weekStart, Math.round(done));
      continue;
    }
    // No logged row, no done-marks. Only trustworthy as a real zero if the
    // corpus demonstrably covers this week; otherwise leave it unknown.
    if (coveredThrough !== null && w.weekStart <= coveredThrough) out.set(w.weekStart, 0);
  }
  return out;
}

/** Per-week ledger for recomputeRemaining, covering completed weeks only. */
export function buildLedger(plan: Plan, today: string, executed: Map<string, number>): WeekActual[] {
  const curIdx = currentWeekIndex(plan.weeks, today);
  const completed = plan.weeks.slice(0, Math.max(0, curIdx));
  return completed.map((wk, i) => {
    const prev = completed[i - 1];
    // `|| targetTss`, not `?? targetTss`: a zero-executed previous week is a
    // real value but a useless ramp reference — coalescing it to 0 makes
    // rampCapTss 0, which disables replan's forced-recovery rule entirely.
    const rampRef = prev ? (executed.get(prev.weekStart) || prev.targetTss) : wk.targetTss;
    return {
      weekStart: wk.weekStart,
      actualTss: executed.get(wk.weekStart) ?? 0,
      plannedTss: wk.targetTss,
      rampCapTss: Math.round(rampRef * 1.2),
      sessionsMissed: wk.sessions.filter((s) => s.discipline !== "race" && s.status !== "done").length,
      sessionsPlanned: wk.sessions.length,
    };
  });
}

/** Copy done/skipped marks from the old plan onto matching sessions in the new
 *  one. Match on (date, discipline) — titles change when durations shift. */
export function carryStatusForward(prev: Plan, next: Plan): void {
  const marks = new Map<string, string>();
  for (const w of prev.weeks) {
    for (const s of w.sessions) {
      if (s.status) marks.set(`${s.date}|${s.discipline}`, s.status);
    }
  }
  for (const w of next.weeks) {
    for (const s of w.sessions) {
      const m = marks.get(`${s.date}|${s.discipline}`);
      if (m === "done" || m === "skipped") s.status = m;
    }
  }
}

/**
 * The reflow starts at `asOf`, so generatePlan returns ONLY the remaining
 * weeks. Re-attaching the completed ones is what keeps this safe to run every
 * week: the athlete's training log survives, buildLedger keeps seeing the full
 * history (so the engine's multi-week rules — 3-overshoot re-baseline,
 * 2-undershoot recalibration — stay reachable instead of collapsing to one
 * row), and mobile's fitness derivation keeps its original anchor.
 */
export function preserveCompletedWeeks(previous: Plan, reflowed: Plan): void {
  const firstNew = reflowed.weeks[0]?.weekStart;
  if (!firstNew) return;
  const past = previous.weeks.filter((w) => w.weekStart < firstNew);
  if (past.length) reflowed.weeks = [...past, ...reflowed.weeks];
}

/** Honest fallback copy when the reflow changed the plan but no engine rule
 *  fired — states the observation and the consequence, nothing stronger. */
function describeChange(d: ReconcileDecision): string {
  const pct = Math.round(Math.abs(d.deltaPct) * 100);
  const dir = d.deltaPct < 0 ? "under" : "over";
  return `last week came in ${pct}% ${dir} plan (${d.executedTss} vs ${d.plannedTss} TSS) → the remaining weeks were recalculated from your current fitness`;
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
    executedTssFor: (ws) => executed.get(ws),
  });
  return runReconcile(stored, decision, executed);
}

/** The shared reflow body. Both the automatic and manual paths reach it with
 *  an already-made decision, so the manual override cannot be re-gated by the
 *  tolerance/idempotence branches it deliberately opened. */
function runReconcile(
  stored: StoredPlanShape,
  decision: ReconcileDecision,
  executed: Map<string, number>
): ReconcileOutcome {
  if (!decision.due) return { decision, stored, commit: null, note: null, error: null };

  const athlete = getAthlete();
  const actualState = getStateAt(decision.asOf);
  if (!athlete || !actualState) return { decision, stored, commit: null, note: null, error: null };

  // Refresh tissue constraints (injuries heal, new pain gets logged), thread
  // the population prior, and drop tune-ups that have already happened — the
  // last of which would otherwise make every reflow throw for the rest of the
  // season (engine/reconcile.ts reflowSafeRequest).
  const request: PlanRequest = reflowSafeRequest(
    {
      ...stored.request,
      tissueConstraints: loadTissueConstraints(decision.asOf),
      priorWeights: loadPopulationPrior() ?? undefined,
    },
    decision.asOf
  );

  let result;
  try {
    result = recomputeRemaining({
      stored: { request, plan: stored.plan },
      actualState,
      actualTrailingTss: getWeekly().slice(-8).map((r) => Math.round(r.tss)),
      ledger: buildLedger(stored.plan, decision.asOf, executed),
      asOf: decision.asOf,
      history: getHistory().map((h) => ({ state: h.state, actualTss: h.actualTss, weekStart: h.weekStart })),
      zones: athlete.zones,
    });
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
  const shape = (p: Plan) => JSON.stringify({ weeks: p.weeks, note: p.meta.replanNote ?? null });
  if (shape(plan) === shape(stored.plan)) {
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
    executedTssFor: (ws) => executed.get(ws),
    tolerance: -1,
  });
  return runReconcile(stored, decision, executed);
}

/** Fallback used when there is no corpus to reconcile against. */
export function regenerateFromToday(request: PlanRequest): void {
  const athlete = getAthlete();
  const today = localToday();
  const state = getStateAt(today);
  if (!athlete || !state) throw new Error("no corpus: import training history first");
  const req: PlanRequest = reflowSafeRequest({ ...request, startDate: today }, today);
  const plan = generatePlan(req, state, [], athlete.zones);
  writePlan({ request: req, plan });
}
