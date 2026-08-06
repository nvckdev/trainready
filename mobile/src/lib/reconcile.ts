import type { Plan } from "@engine/plan.ts";
import { readTissue } from "./tissue-store";
import type { AthleteState } from "@engine/types.ts";
import { recomputeRemaining } from "@engine/replan.ts";
import {
  type DoneMarkFill,
  carryStatusForward,
  describeChange,
  planShape,
  preserveCompletedWeeks,
  withDoneMarkFallback,
} from "@engine/plan-ops.ts";
import { evidenceComplete, reconcileGate } from "@engine/reconcile.ts";
import { dedupeActivities, executedByWeek as rollupByWeek, type Coverage, type ImportedActivity } from "@engine/activity.ts";
import { thresholdMpsFromZones } from "@engine/zones.ts";
import { localToday, setPlan, zonesFor, type StoredAthlete, type StoredPlan } from "./store";
import { seedActualState } from "./fitness-seed";
import { buildMobileReflowInput } from "./reflow-input";
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
/** ISO instant → the athlete's calendar day: their paired tz when known
 *  (same clock as localToday/M3 — otherwise "today" and activity bucketing
 *  split inside one device), else the device clock. */
const athleteLocalDate = (tz?: string) => (isoInstant: string): string => {
  const d = new Date(isoInstant);
  if (tz) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
    } catch {
      /* unknown tz — device clock below */
    }
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function executedByWeek(
  plan: Plan,
  imported: ImportedActivity[] = [],
  coverage: Coverage[] = [],
  ctx: { runThresholdMps?: number; lthrBpm?: number } = {},
  tz?: string
): DoneMarkFill {
  const weekStarts = plan.weeks.map((w) => w.weekStart);
  // Bucket imports on the athlete's clock — the same one localToday and the
  // plan dates use (E7 + M3, unified after review).
  const out = rollupByWeek(weekStarts, imported, coverage, ctx, undefined, athleteLocalDate(tz));
  // Done-marks fill only what the importers never saw, positive-only — the
  // shared engine precedence, so it cannot drift from the dashboard's.
  return withDoneMarkFallback(plan.weeks, out);
}

/**
 * The athlete's CURRENT fitness from everything this device knows — the seed,
 * rolled forward through engine/seed.ts's own pinned gap loop over the merged
 * evidence (done-marks + imports + coverage + the plan's own rest days). Built
 * for new-plan generation: the review caught goal.tsx seeding from pure
 * zero-load decay, which turned eight weeks of tapped training into a
 * near-beginner CTL (the mirror image of the Mobile-1 fiction).
 *
 * Mobile used to carry two PRIVATE PMC replays here (executedDailyPmc and an
 * inline loop in this function) that filled every day `?? 0` and consulted no
 * coverage — so zeroLoadDays was 0 by construction and E8's refusal could
 * never fire on this surface. Both are deleted; the recursion and the
 * provenance accounting now live in exactly one place (engine/seed.ts,
 * reached through fitness-seed.ts), and mobile no longer carries a PMC copy
 * at all. They also disagreed with each other by one day (this function
 * rolled THROUGH `through`; seedStateAt stops at its morning) — ~12 TSB on a
 * hard training day. The morning convention wins: it is the engine's, and a
 * state that already contains today is a state the day has not finished
 * earning.
 */
export function evidenceSeedState(
  athlete: StoredAthlete,
  stored: StoredPlan | null,
  through: string,
  imported: ImportedActivity[] = [],
  coverage: Coverage[] = []
): AthleteState {
  if (!athlete.anchor) return athlete.seed;
  const zones = zonesFor(athlete);
  const ctx = {
    runThresholdMps: thresholdMpsFromZones(zones),
    lthrBpm: athlete.thresholds.lthrBpm,
  };
  // Generation does not refuse on provenance — a speculative state is a LOWER
  // bound, and a conservative first plan is the safe answer for someone who
  // has evidence gaps; the weekly reconcile is where prescribing from
  // assumption is refused (tooSpeculativeToPrescribe below).
  return seedActualState(athlete.seed, athlete.anchor, stored?.plan, through, imported, coverage, ctx, athleteLocalDate(athlete.tz));
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
  const executed = executedByWeek(stored.plan, stream, sync.coverage, ctx, athlete.tz);
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
      const v = executed.executed.get(ws);
      if (v === undefined) return undefined;
      return {
        tss: v,
        // Either lower-bound condition forbids locking an undershoot: still
        // settling past the close, or a partially tapped week whose untapped
        // sessions are unknowns — 2 taps in a 5-session week is not "60%
        // under plan", it is 40% accounted for.
        complete:
          !executed.partial.has(ws) &&
          evidenceComplete({
            weekStart: ws,
            today,
            hasRemoteSource: healthKitPossible(),
            lastSyncAt: sync.lastSyncAt,
          }),
      };
    },
  });
  if (!decision.due) return { changed: false, reason: decision.reason, note: null };

  // All reads gathered here; the field-by-field assembly is pure
  // (reflow-input.ts) and snapshot-tested. E8: the state rolls through the
  // engine's own gap loop, which COUNTS every day nothing vouched for; the
  // tissue store is re-read per reflow (injuries heal, new ones get
  // declared).
  const assembly = buildMobileReflowInput(stored, decision, executed, {
    actualState: seedActualState(
      athlete.seed, athlete.anchor, stored.plan, decision.asOf, stream, sync.coverage, ctx, athleteLocalDate(athlete.tz)
    ),
    tissue: await readTissue(decision.asOf),
    priorWeights: athlete.priorWeights,
    zones,
  });
  if (assembly.kind === "refuse") return { changed: false, reason: assembly.reason, note: null };
  const { request, input } = assembly;

  let result;
  try {
    result = recomputeRemaining(input);
  } catch (e) {
    // The gate is the primary defence; this guarantees a failed reflow can
    // never leave the athlete without a plan.
    return { changed: false, reason: `error: ${e instanceof Error ? e.message : String(e)}`, note: null };
  }

  const plan = result.plan;
  // Re-attach the completed weeks (shared engine op). On mobile this is not a
  // nicety: the plan is the ONLY training log the phone has, and
  // executedDailyPmc anchors its recursion on plan.weeks[0].
  preserveCompletedWeeks(stored.plan, plan);
  plan.meta.lastRecomputed = result.lastRecomputed;
  // Never rewrite the plan silently: if no engine rule fired, say what was
  // observed and what it caused.
  if (result.note) plan.meta.replanNote = result.note;
  else plan.meta.replanNote = describeChange(decision);
  if (result.recalibration) plan.meta.recalibration = result.recalibration;
  else delete plan.meta.recalibration;
  carryStatusForward(stored.plan, plan);

  if (planShape(plan) === planShape(stored.plan)) return { changed: false, reason: "no-change", note: null };

  await setPlan({ request, plan });
  return { changed: true, reason: "reconciled", note: result.note };
}
