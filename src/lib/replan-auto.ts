import { generatePlan, type Plan, type PlanRequest } from "../../engine/plan.ts";
import { buildLedger, recomputeRemaining } from "../../engine/replan.ts";
import { evidenceComplete, reconcileGate, reflowSafeRequest, type ReconcileDecision, type WeekEvidence } from "../../engine/reconcile.ts";
import { loadEras, loadPopulationPrior } from "../../engine/learned.ts";
import { loadRaceAnchors } from "../../engine/goal.ts";
import { getAthlete, getHistory, getStateAt, getWeekly, intervalsConfigured, localToday, stravaConfigured } from "@/lib/athlete-data";
import { readPlan, writePlan } from "@/lib/plan-io";
import { loadTissueConstraintsTagged } from "@/lib/tissue-constraints";
import { dedupeActivities, executedByWeek as rollupByWeek, type Coverage, type ImportedActivity } from "../../engine/activity.ts";
import { thresholdMpsFromZones } from "../../engine/zones.ts";
import { corpusWeeklyMeasured } from "@/lib/connectors";
import { readSyncStore } from "@/lib/sync-io";
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

/** Index of the plan week containing `today` (else the next upcoming week). */
export function currentWeekIndex(weeks: Plan["weeks"], today: string): number {
  for (let i = 0; i < weeks.length; i++) {
    const end = weeks[i + 1]?.weekStart ?? "9999-12-31";
    if (today >= weeks[i].weekStart && today < end) return i;
  }
  return weeks.length ? 0 : -1;
}

/**
 * Evidence for the gate's closed-week check: the executed number plus whether
 * it is COMPLETE — settled past upload lag, with a post-close sync when a
 * remote source is configured, or corpus-measured outright. The gate treats
 * an incomplete number as a lower bound and refuses to lock an undershoot
 * verdict on it (evidence-settling).
 */
export function closedWeekEvidence(
  executed: Map<string, number>,
  weekStart: string,
  today: string
): WeekEvidence | undefined {
  const v = executed.get(weekStart);
  if (v === undefined) return undefined;
  return {
    tss: v,
    complete: evidenceComplete({
      weekStart,
      today,
      hasRemoteSource: stravaConfigured() || intervalsConfigured(),
      lastSyncAt: readSyncStore().lastSyncAt,
      measured: corpusWeeklyMeasured().measured.has(weekStart),
    }),
  };
}

export function executedTssByWeek(plan: Plan): Map<string, number> {
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
  // importers never saw, but they can never authorize a zero — an athlete who
  // forgets to tap has not proven they rested.
  const out = new Map(fromImports);
  for (const w of plan.weeks) {
    if (out.has(w.weekStart)) continue;
    const done = w.sessions.filter((s) => s.status === "done").reduce((a, s) => a + s.tss, 0);
    if (done > 0) out.set(w.weekStart, Math.round(done));
  }
  return out;
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
  executed: Map<string, number>
): ReconcileOutcome {
  if (!decision.due) return { decision, stored, commit: null, note: null, error: null };

  const athlete = getAthlete();
  const actualState = getStateAt(decision.asOf);
  if (!athlete || !actualState) return { decision, stored, commit: null, note: null, error: null };

  // The safety file gets the connector layer's absent-vs-unreadable
  // distinction (E9). ABSENT is a real state — no injuries on file, reflow
  // proceeds without caps. UNREADABLE (the file exists but does not parse —
  // one typo in a hand-edited JSON) must REFUSE the reflow: proceeding would
  // silently rewrite the plan without the athlete's declared tissue caps,
  // which is the one degradation with injury stakes rather than accuracy
  // stakes. Applies to the manual path too — this branch is safety, not
  // preference.
  const tissue = loadTissueConstraintsTagged(decision.asOf);
  if (tissue.status === "unreadable") {
    return {
      decision,
      stored,
      commit: null,
      note: null,
      error: `athlete-context.json is unreadable (${tissue.message ?? "parse error"}) — refusing to re-plan without your declared injury constraints. Fix the file and re-plan.`,
    };
  }

  // Refresh tissue constraints (injuries heal, new pain gets logged), thread
  // the population prior, and drop tune-ups that have already happened — the
  // last of which would otherwise make every reflow throw for the rest of the
  // season (engine/reconcile.ts reflowSafeRequest).
  const request: PlanRequest = reflowSafeRequest(
    {
      ...stored.request,
      tissueConstraints: tissue.constraints,
      priorWeights: loadPopulationPrior() ?? undefined,
      // E6: refreshed per reflow like tissue — never read inside the engine.
      eras: loadEras() ?? undefined,
      raceAnchors: loadRaceAnchors(),
    },
    decision.asOf
  );

  let result;
  try {
    result = recomputeRemaining({
      stored: { request, plan: stored.plan },
      actualState,
      actualTrailingTss: getWeekly().slice(-8).map((r) => Math.round(r.tss)),
      ledger: buildLedger(stored.plan.weeks, decision.asOf, executed),
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
    // complete: true — the manual button is the athlete explicitly saying
    // "judge with what you have, now". The settling refusal exists to stop
    // AUTOMATIC verdicts on arriving evidence, not to overrule a person.
    executedTssFor: (ws) => {
      const v = executed.get(ws);
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
  const state = getStateAt(today);
  if (!athlete || !state) throw new Error("no corpus: import training history first");
  const req: PlanRequest = reflowSafeRequest(
    { ...request, startDate: today, eras: loadEras() ?? undefined, raceAnchors: loadRaceAnchors() },
    today
  );
  const plan = generatePlan(req, state, [], athlete.zones);
  writePlan({ request: req, plan });
}
