import type { PlanRequest, PlanWeek } from "./plan.ts";

/**
 * Weekly-reconcile GATE — the decision layer in front of the (already built,
 * already tested) engine/replan.ts recomputeRemaining.
 *
 * recomputeRemaining reflows a plan from actual fitness; it does not decide
 * WHEN that should happen, and it is not defensive about being called at a
 * bad moment. This module is that decision, kept pure and surface-agnostic so
 * the dashboard (real logged activities) and mobile (done-marks) can share one
 * definition of "a training week closed and the athlete's execution diverged
 * enough to be worth reflowing".
 *
 * Backtest-neutral by construction: engine/backtest.ts imports only
 * reference/learned/types, never plan/replan/reconcile (pinned by RC1).
 *
 * The gate is also a SAFETY boundary. recomputeRemaining + generatePlan throw
 * or misfire in four documented situations, all of which an unconditional
 * daily trigger would hit:
 *   1. asOf > raceDate            → generatePlan throws "race date is in the past"
 *   2. a tune-up now in the past  → generatePlan throws "outside the plan window"
 *   3. exactly 2 remaining weeks  → replan's own taper invariant throws
 *   4. exactly 1 remaining week   → SILENT misfire: forced recovery relabels the
 *                                   RACE week "recovery" (the invariant
 *                                   short-circuits at length < 2)
 * The taper lock (§ never reconcile inside 21 days of the race) subsumes 1, 3
 * and 4 — at ≥21 days out there are always ≥4 remaining weeks. Case 2 is
 * handled by reflowSafeRequest, which sanitizes the CALLER's request rather
 * than touching generatePlan.
 */

/** Executed-vs-planned band inside which a closed week is "as planned" and the
 *  reconcile is a no-op. Wider than the engine's own overshoot damp (which
 *  fires on any excess) precisely so ordinary week-to-week noise does not
 *  churn the plan; only a real divergence reflows. */
export const RECONCILE_TOLERANCE = 0.1;
/** Never reconcile inside this many days of the race — the taper is protocol. */
export const TAPER_LOCK_DAYS = 21;
/** Belt-and-braces: never reflow a plan this short (see cases 3/4 above). */
export const MIN_REMAINING_WEEKS = 3;

const DAY = 86400000;
const at = (d: string) => Date.parse(d + "T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The Monday on or before `date` (noon-UTC anchored, DST-safe). */
export function mondayOnOrBefore(date: string): string {
  const t = at(date);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // 0 = Monday
  return iso(t - dow * DAY);
}

export type ReconcileReason =
  | "due"
  | "no-plan"
  | "race-passed"
  | "taper-lock"
  | "no-closed-week"
  | "already-reconciled"
  | "too-few-weeks"
  | "no-execution-data"
  | "evidence-settling"
  | "within-tolerance";

export interface ReconcileDecision {
  /** True ⇒ the caller should build a ledger and call recomputeRemaining. */
  due: boolean;
  reason: ReconcileReason;
  /** The most recently CLOSED plan week (its last day has passed). */
  closedWeekStart: string | null;
  plannedTss: number;
  executedTss: number;
  /** (executed − planned) / planned, 0 when planned is 0. */
  deltaPct: number;
  /** The Monday to reflow from. Always a Monday: generatePlan anchors on
   *  mondayOnOrAfter(startDate), so passing a mid-week date would start the
   *  new plan NEXT Monday and silently delete the current week's sessions. */
  asOf: string;
}

export interface ReconcileGateInput {
  weeks: Pick<PlanWeek, "weekStart" | "targetTss">[];
  raceDate: string;
  /** meta.lastRecomputed — the stamp that makes the gate idempotent. */
  lastRecomputed?: string;
  /** Athlete-local today (rule 16). */
  today: string;
  /**
   * Executed TSS for a plan week — and the distinction that matters most:
   *
   *   a number (including 0) ⇒ AUTHORITATIVE. 0 means "we know they trained
   *                            nothing", which is worth reflowing.
   *   undefined              ⇒ NO EVIDENCE EITHER WAY. The dashboard returns
   *                            this when the extraction pipeline has not
   *                            reached that week yet; mobile never does,
   *                            because done-marks are its whole truth.
   *
   * Treating `undefined` as zero is what made an automatic trigger unsafe: a
   * corpus lagging the plan (the ordinary state between syncs) fabricated a
   * fully-missed week and rewrote the season. The gate now refuses instead.
   */
  executedTssFor: (weekStart: string) => WeekEvidence | undefined;
  tolerance?: number;
}

/**
 * Evidence for a closed week. `tss` is a LOWER BOUND until `complete` is
 * true: activities reach the store only after watches upload and athletes
 * tap, so a Monday-morning reading of a Sunday-closed week is structurally
 * missing whatever hasn't arrived yet. An overshoot beyond tolerance is
 * provable from a lower bound; an undershoot is not — and the idempotence
 * stamp makes a wrong verdict permanent, which is why the incomplete case
 * gets its own refusal instead of a guess.
 */
export interface WeekEvidence {
  tss: number;
  complete: boolean;
}

/** Days after a week closes before its evidence is considered settled —
 *  device-upload lag plus the athlete tapping yesterday's session. */
export const EVIDENCE_SETTLE_DAYS = 2;

/**
 * The ONE completeness rule, shared by both surfaces.
 *
 *  - a corpus-measured week was measured after the fact ⇒ complete now;
 *  - otherwise wait EVIDENCE_SETTLE_DAYS past the week's end;
 *  - and when a remote source (upload-lag-prone: Strava, HealthKit) is
 *    configured, additionally require a sync ATTEMPT after the week closed —
 *    attempts stamp lastSyncAt even when the source fails, so a broken
 *    source degrades to the settle rule instead of blocking forever.
 */
export function evidenceComplete(opts: {
  weekStart: string;
  /** Athlete-local today. */
  today: string;
  hasRemoteSource: boolean;
  /** ISO datetime of the last sync attempt, when any remote source exists. */
  lastSyncAt?: string;
  /** True when this week's number is a post-hoc measurement (corpus). */
  measured?: boolean;
}): boolean {
  if (opts.measured) return true;
  const end = iso(at(opts.weekStart) + 7 * DAY);
  const settled = iso(at(opts.weekStart) + (7 + EVIDENCE_SETTLE_DAYS) * DAY);
  if (opts.today < settled) return false;
  if (opts.hasRemoteSource) {
    if (!opts.lastSyncAt || opts.lastSyncAt.slice(0, 10) < end) return false;
  }
  return true;
}

/**
 * Should a weekly reconcile fire right now? Pure; every branch is a documented
 * reason so callers can surface (or log) exactly why nothing happened.
 */
export function reconcileGate(input: ReconcileGateInput): ReconcileDecision {
  const { weeks, raceDate, lastRecomputed, today, executedTssFor } = input;
  const tolerance = input.tolerance ?? RECONCILE_TOLERANCE;
  const asOf = mondayOnOrBefore(today);
  const base: Omit<ReconcileDecision, "due" | "reason"> = {
    closedWeekStart: null,
    plannedTss: 0,
    executedTss: 0,
    deltaPct: 0,
    asOf,
  };

  if (!weeks.length) return { ...base, due: false, reason: "no-plan" };
  // generatePlan throws once the race is behind us; nothing to reflow anyway.
  if (today > raceDate) return { ...base, due: false, reason: "race-passed" };
  // The taper is protocol, not preference (taper-rules rule 2). Inside the
  // lock the plan is pure schedule — there is nothing adaptive left to do,
  // and reflowing here is exactly where replan throws/misfires.
  if (at(raceDate) - at(today) <= TAPER_LOCK_DAYS * DAY) {
    return { ...base, due: false, reason: "taper-lock" };
  }

  // The most recent week whose last day has passed (weekStart + 7d ≤ today).
  let closed: (typeof weeks)[number] | null = null;
  for (const w of weeks) {
    if (at(w.weekStart) + 7 * DAY <= at(today)) closed = w;
    else break;
  }
  if (!closed) return { ...base, due: false, reason: "no-closed-week" };

  const closedEnd = iso(at(closed.weekStart) + 7 * DAY);
  const withClosed = { ...base, closedWeekStart: closed.weekStart, plannedTss: closed.targetTss };
  // Idempotence: one reconcile per closed week, however often the app is opened.
  if (lastRecomputed && lastRecomputed >= closedEnd) {
    return { ...withClosed, due: false, reason: "already-reconciled" };
  }

  const remaining = weeks.filter((w) => at(w.weekStart) >= at(asOf)).length;
  if (remaining < MIN_REMAINING_WEEKS) {
    return { ...withClosed, due: false, reason: "too-few-weeks" };
  }

  const raw = executedTssFor(closed.weekStart);
  if (raw === undefined) {
    // No evidence the week was or wasn't trained. Silence is not a missed
    // week — never reflow on an absence of data.
    return { ...withClosed, due: false, reason: "no-execution-data" };
  }
  const executed = Math.round(raw.tss);
  const planned = closed.targetTss;
  const deltaPct = planned > 0 ? (executed - planned) / planned : 0;
  const full = { ...withClosed, executedTss: executed, deltaPct };
  // Incomplete evidence is a lower bound. It can PROVE an overshoot (already
  // past the band with more possibly arriving) but never an undershoot or an
  // on-plan week — and a verdict here would be locked by the idempotence
  // stamp, so the gate waits instead. No stamp is written on this branch:
  // the next visit re-evaluates with whatever has arrived since.
  if (!raw.complete && deltaPct <= tolerance) {
    return { ...full, due: false, reason: "evidence-settling" };
  }
  // The week landed on plan — byte-identical no-op, no reflow, no note.
  if (planned > 0 && Math.abs(deltaPct) <= tolerance) {
    return { ...full, due: false, reason: "within-tolerance" };
  }
  return { ...full, due: true, reason: "due" };
}

/**
 * Sanitize a stored request for reflow. generatePlan validates tune-ups
 * against the plan window, so a B-race that has already happened makes EVERY
 * subsequent recompute throw ("tune-up <date> is before the plan starts") —
 * permanently, for the rest of the season. Dropping past tune-ups here fixes
 * that for the automatic trigger AND the existing manual button without
 * touching generatePlan or recomputeRemaining: a race already run is not part
 * of the remaining plan by definition.
 */
export function reflowSafeRequest(req: PlanRequest, asOf: string): PlanRequest {
  if (!req.tuneups?.length) return req;
  const future = req.tuneups.filter((t) => t.date >= asOf);
  if (future.length === req.tuneups.length) return req;
  return { ...req, tuneups: future };
}
