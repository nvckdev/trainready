import type { Plan, PlanRequest } from "@engine/plan.ts";
import type { AthleteState } from "@engine/types.ts";
import { recomputeRemaining, type WeekActual } from "@engine/replan.ts";
import { reconcileGate, reflowSafeRequest } from "@engine/reconcile.ts";
import { seedStateAt, type DailyPmcPoint } from "@engine/seed.ts";
import { localToday, setPlan, zonesFor, type StoredAthlete, type StoredPlan } from "./store";

/**
 * On-device weekly reconcile. Same gate and same engine as the dashboard; the
 * difference is the EXECUTION SIGNAL. The phone has no activity import and no
 * daily PMC series — the only truth it holds is which sessions the athlete
 * marked done. So executed load is the sum of done-marked sessions, and
 * current fitness is derived by running the plan's own dates through the PMC
 * recursion with actual (done) load instead of prescribed load.
 *
 * That is honest but weaker than the dashboard's logged-activity signal: an
 * athlete who trains and never taps MARK DONE looks like an athlete who did
 * nothing. The gate's tolerance band absorbs small gaps; a genuinely empty
 * week reflows, which is the correct response to "no evidence of training".
 */

const DAY = 86400000;
const at = (d: string) => Date.parse(d + "T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Executed TSS per plan week, from done marks. */
export function executedByWeek(plan: Plan): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of plan.weeks) {
    out.set(w.weekStart, w.sessions.filter((s) => s.status === "done").reduce((a, s) => a + s.tss, 0));
  }
  return out;
}

/**
 * Daily PMC series from DONE sessions between two dates.
 *
 * This is the τ=42/7 recursion (rule 6 — never tuned, deliberately written out
 * rather than abstracted, exactly as in plan.ts / derive.ts / seed.ts /
 * replan.ts). It exists because mobile has no other route to actual fitness:
 * the plan's `projected` is what was PRESCRIBED, not what happened. Feeding
 * the result through the tested seedStateAt keeps the merge + provenance
 * behavior identical to the dashboard's path.
 */
export function executedDailyPmc(plan: Plan, seedCtl: number, seedAtl: number, through: string): DailyPmcPoint[] {
  const tssByDate = new Map<string, number>();
  for (const w of plan.weeks) {
    for (const s of w.sessions) {
      if (s.status !== "done") continue;
      tssByDate.set(s.date, (tssByDate.get(s.date) ?? 0) + s.tss);
    }
  }
  const start = plan.weeks[0]?.weekStart;
  if (!start || at(start) > at(through)) return [];
  let ctl = seedCtl;
  let atl = seedAtl;
  const series: DailyPmcPoint[] = [];
  for (let t = at(start); t <= at(through); t += DAY) {
    const date = iso(t);
    const tss = tssByDate.get(date) ?? 0;
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
    series.push({ date, ctl, atl });
  }
  return series;
}

function buildLedger(plan: Plan, asOf: string, executed: Map<string, number>): WeekActual[] {
  const completed = plan.weeks.filter((w) => at(w.weekStart) + 7 * DAY <= at(asOf));
  return completed.map((wk, i) => {
    const prev = completed[i - 1];
    const rampRef = prev ? (executed.get(prev.weekStart) ?? prev.targetTss) : wk.targetTss;
    return {
      weekStart: wk.weekStart,
      actualTss: Math.round(executed.get(wk.weekStart) ?? 0),
      plannedTss: wk.targetTss,
      rampCapTss: Math.round(rampRef * 1.2),
      sessionsMissed: wk.sessions.filter((s) => s.discipline !== "race" && s.status !== "done").length,
      sessionsPlanned: wk.sessions.length,
    };
  });
}

/** Copy done/skipped marks onto the reflowed plan, keyed (date, discipline). */
function carryStatusForward(prev: Plan, next: Plan): void {
  const marks = new Map<string, "done" | "skipped">();
  for (const w of prev.weeks) {
    for (const s of w.sessions) if (s.status) marks.set(`${s.date}|${s.discipline}`, s.status);
  }
  for (const w of next.weeks) {
    for (const s of w.sessions) {
      const m = marks.get(`${s.date}|${s.discipline}`);
      if (m) s.status = m;
    }
  }
}

export interface MobileReconcileResult {
  changed: boolean;
  reason: string;
  note: string | null;
}

/**
 * Reconcile if a week closed and execution diverged. Persists through the
 * store (so every screen updates) only when the plan actually changed —
 * an on-plan week is a true no-op: no write, no note, no stamp.
 */
export async function reconcileIfDue(
  stored: StoredPlan,
  athlete: StoredAthlete,
  today = localToday()
): Promise<MobileReconcileResult> {
  const executed = executedByWeek(stored.plan);
  const decision = reconcileGate({
    weeks: stored.plan.weeks,
    raceDate: stored.request.raceDate,
    lastRecomputed: stored.plan.meta.lastRecomputed,
    today,
    executedTssFor: (ws) => executed.get(ws),
  });
  if (!decision.due) return { changed: false, reason: decision.reason, note: null };

  const series = executedDailyPmc(stored.plan, athlete.seed.ctl, athlete.seed.atl, decision.asOf);
  const actualState: AthleteState = seedStateAt(athlete.seed, series, decision.asOf);
  const request: PlanRequest = reflowSafeRequest(
    { ...stored.request, priorWeights: athlete.priorWeights },
    decision.asOf
  );

  let result;
  try {
    result = recomputeRemaining({
      stored: { request, plan: stored.plan },
      actualState,
      actualTrailingTss: stored.plan.weeks
        .filter((w) => at(w.weekStart) < at(decision.asOf))
        .slice(-8)
        .map((w) => Math.round(executed.get(w.weekStart) ?? 0)),
      ledger: buildLedger(stored.plan, decision.asOf, executed),
      asOf: decision.asOf,
      history: [],
      zones: zonesFor(athlete),
    });
  } catch (e) {
    // The gate is the primary defence; this guarantees a failed reflow can
    // never leave the athlete without a plan.
    return { changed: false, reason: `error: ${e instanceof Error ? e.message : String(e)}`, note: null };
  }

  const plan = result.plan;
  // Re-attach the completed weeks. On mobile this is not a nicety: the plan is
  // the ONLY training log the phone has, and executedDailyPmc anchors its
  // recursion on plan.weeks[0] — truncating would both destroy the athlete's
  // history and re-seed fitness from the pairing-era state every single week.
  const firstNew = plan.weeks[0]?.weekStart;
  if (firstNew) {
    const past = stored.plan.weeks.filter((w) => w.weekStart < firstNew);
    if (past.length) plan.weeks = [...past, ...plan.weeks];
  }
  plan.meta.lastRecomputed = result.lastRecomputed;
  // Never rewrite the plan silently: if no engine rule fired, say what was
  // observed and what it caused.
  if (result.note) plan.meta.replanNote = result.note;
  else {
    const pct = Math.round(Math.abs(decision.deltaPct) * 100);
    plan.meta.replanNote = `last week came in ${pct}% ${decision.deltaPct < 0 ? "under" : "over"} plan (${decision.executedTss} vs ${decision.plannedTss} TSS) → the remaining weeks were recalculated from your current fitness`;
  }
  if (result.recalibration) plan.meta.recalibration = result.recalibration;
  else delete plan.meta.recalibration;
  carryStatusForward(stored.plan, plan);

  const shape = (p: Plan) => JSON.stringify({ weeks: p.weeks, note: p.meta.replanNote ?? null });
  if (shape(plan) === shape(stored.plan)) return { changed: false, reason: "no-change", note: null };

  await setPlan({ request, plan });
  return { changed: true, reason: "reconciled", note: result.note };
}
