import type { Plan, PlanRequest } from "@engine/plan.ts";
import type { AthleteState } from "@engine/types.ts";
import { buildLedger, knownTrailingTss, recomputeRemaining } from "@engine/replan.ts";
import { evidenceComplete, reconcileGate, reflowSafeRequest } from "@engine/reconcile.ts";
import { dailyExecutedTss, dedupeActivities, executedByWeek as rollupByWeek, type Coverage, type ImportedActivity } from "@engine/activity.ts";
import { thresholdMpsFromZones } from "@engine/zones.ts";
import { seedStateAt, type DailyPmcPoint } from "@engine/seed.ts";
import { localToday, setPlan, zonesFor, type StoredAthlete, type StoredPlan } from "./store";
import { readSync } from "./sync";
import { healthKitPossible } from "./healthkit";

/**
 * On-device weekly reconcile. Same gate and same engine as the dashboard; the
 * difference is the EVIDENCE SOURCES. The phone holds two: which sessions the
 * athlete marked done, and whatever the sync store imported (HealthKit when a
 * build carries it). Both the gate's executed signal AND the fitness state
 * that seeds a reflow are derived from the SAME merged evidence — the gate
 * firing on imported load while fitness decayed from untapped sessions was
 * exactly the split that cut a compliant athlete's plan ~60% (Mobile-1).
 *
 * Done-marks remain positive-only: they can raise a week but never authorize
 * a zero. A genuinely empty covered week reflows, which is the correct
 * response to real evidence of no training.
 */

const DAY = 86400000;
const at = (d: string) => Date.parse(d + "T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Executed TSS per plan week.
 *
 * Done-marks are POSITIVE-ONLY evidence: they can raise a week, but they can
 * never authorize a zero. An athlete who trained and forgot to tap has not
 * proven they rested — claiming otherwise is the same "absence is not zero"
 * bug the dashboard fixed, and it was live here until imports landed.
 * Imported activities (with real coverage windows) are what make a zero
 * authoritative on the phone.
 */
const deviceLocalDate = (isoInstant: string): string => {
  const d = new Date(isoInstant);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function executedByWeek(
  plan: Plan,
  imported: ImportedActivity[] = [],
  coverage: Coverage[] = [],
  ctx: { runThresholdMps?: number; lthrBpm?: number } = {}
): Map<string, number> {
  const weekStarts = plan.weeks.map((w) => w.weekStart);
  // Plan dates are device-local calendar days — bucket imports on the same
  // clock so a Sunday-evening run stays in its ledger week (E7).
  const out = rollupByWeek(weekStarts, imported, coverage, ctx, undefined, deviceLocalDate);
  for (const w of plan.weeks) {
    if (out.has(w.weekStart)) continue;
    const done = w.sessions.filter((s) => s.status === "done").reduce((a, s) => a + s.tss, 0);
    if (done > 0) out.set(w.weekStart, done);
  }
  return out;
}

/**
 * Daily PMC series from the merged evidence (done marks + imports) between
 * two dates.
 *
 * This is the τ=42/7 recursion (rule 6 — never tuned, deliberately written out
 * rather than abstracted, exactly as in plan.ts / derive.ts / seed.ts /
 * replan.ts). It exists because mobile has no other route to actual fitness:
 * the plan's `projected` is what was PRESCRIBED, not what happened. Feeding
 * the result through the tested seedStateAt keeps the merge + provenance
 * behavior identical to the dashboard's path.
 */
export function executedDailyPmc(
  plan: Plan,
  seedCtl: number,
  seedAtl: number,
  through: string,
  // Imported activities merged per-day (max, never sum — a tapped session and
  // its imported twin are the same workout). Without this the gate saw real
  // imported load while the fitness state decayed as if the athlete did
  // nothing, and the reflow cut the plan from a fiction (Mobile-1).
  imported: ImportedActivity[] = [],
  ctx: { runThresholdMps?: number; lthrBpm?: number } = {}
): DailyPmcPoint[] {
  const doneByDate = new Map<string, number>();
  for (const w of plan.weeks) {
    for (const s of w.sessions) {
      if (s.status !== "done") continue;
      doneByDate.set(s.date, (doneByDate.get(s.date) ?? 0) + s.tss);
    }
  }
  // Plan dates are device-local calendar days; bucket imports the same way so
  // an evening run lands on the day the athlete lived it.
  const tssByDate = dailyExecutedTss(doneByDate, imported, ctx, deviceLocalDate);
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
  const zones = zonesFor(athlete);
  // Imported activities are the authoritative signal when a source could
  // vouch for the week; done-marks remain a positive-only fallback inside
  // executedByWeek. With no importer connected this is empty, which leaves
  // every week exactly as it was.
  const sync = await readSync();
  const stream = dedupeActivities(sync.activities);
  const ctx = {
    runThresholdMps: thresholdMpsFromZones(zones),
    lthrBpm: athlete.thresholds.lthrBpm,
  };
  const executed = executedByWeek(stored.plan, stream, sync.coverage, ctx);
  const decision = reconcileGate({
    weeks: stored.plan.weeks,
    raceDate: stored.request.raceDate,
    lastRecomputed: stored.plan.meta.lastRecomputed,
    today,
    // Same completeness rule as the dashboard: a just-closed week's number is
    // a lower bound until upload lag settles (and, when a remote source like
    // HealthKit is live, until a post-close sync has run). The gate refuses
    // to lock an undershoot verdict on arriving evidence.
    executedTssFor: (ws) => {
      const v = executed.get(ws);
      if (v === undefined) return undefined;
      return {
        tss: v,
        complete: evidenceComplete({
          weekStart: ws,
          today,
          hasRemoteSource: healthKitPossible(),
          lastSyncAt: sync.lastSyncAt,
        }),
      };
    },
  });
  if (!decision.due) return { changed: false, reason: decision.reason, note: null };

  const series = executedDailyPmc(stored.plan, athlete.seed.ctl, athlete.seed.atl, decision.asOf, stream, ctx);
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
      // Known weeks only — a fabricated zero here depressed the very
      // capacity terms the rebaseline reads (E2).
      actualTrailingTss: knownTrailingTss(stored.plan.weeks, decision.asOf, executed),
      ledger: buildLedger(stored.plan.weeks, decision.asOf, executed),
      asOf: decision.asOf,
      history: [],
      zones,
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
