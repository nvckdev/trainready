import { generatePlan, type Plan, type PlanRequest, type PlanWeek } from "./plan.ts";
import type { AthleteState } from "./types.ts";
import type { Zones } from "./zones.ts";

/**
 * Adaptive re-plan — recompute every REMAINING week of an active plan toward
 * the FIXED race date from the athlete's ACTUAL current CTL/ATL/TSB, applying
 * the overshoot / undershoot / race-anchor rules and emitting an honest
 * plan-adjusted note. See docs/replan.md.
 *
 * Forward plan-generation only: calls the existing generatePlan and never
 * enters the backtested prediction path (backtest.ts imports reference/learned/
 * types, never plan.ts), so the pinned baselines are byte-identical. PMC math
 * (τ=42/7), the rails (+20% ramp, −25 TSB floor, 60 weekly floor), the taper/
 * race protocol lock, anchor-v2, and the corrected finish model are all reused
 * untouched. Every adjustment here only ever TIGHTENS load relative to the
 * rails (forces recovery, damps a hot week, holds volume) — never loosens one.
 */

const HARD_OVERSHOOT_OVER_CAP = 1.25; // rule 2: actual > rampCap × 1.25 ⇒ forced recovery
const OVERSHOOT_STREAK = 3; // rule 3: consecutive overshoots ⇒ re-baseline up
const MISS_FRAC = 0.4; // rule 5: ≥40% of planned TSS missed
const MISS_STREAK = 2; // rule 5: for 2 consecutive weeks
const SAFE_TSB_BAND = -10; // rule 1: damp so projected end-of-week TSB ≥ this
// rule 4: a single-session shortfall is absorbed silently — no explicit
// threshold needed; the note simply never fires unless a whole-week rule trips.

const CTL_TAU = 42;
const ATL_TAU = 7;

export interface StoredPlan {
  request: PlanRequest;
  plan: Plan;
}

export interface WeekActual {
  weekStart: string; // Monday ISO — joins PlanWeek.weekStart
  actualTss: number; // executed weekly TSS
  plannedTss: number; // the stored PlanWeek.targetTss for that week
  rampCapTss?: number; // the +20% anchor ramp ceiling that governed the week
  sessionsMissed: number;
  sessionsPlanned: number;
}

export interface ReplanInput {
  stored: StoredPlan;
  actualState: AthleteState; // getStateAt(asOf) — pmc-seeded ctl/atl/tsb
  actualTrailingTss: number[]; // ACTUAL executed weekly TSS, oldest→newest
  ledger: WeekActual[]; // completed weeks only, chronological
  asOf: string; // localToday() — America/New_York
  history: Array<{ state: AthleteState; actualTss: number; weekStart?: string }>;
  zones: Zones;
}

export interface Recalibration {
  revisedFinish: string;
  reachablePeakCtl: number;
  realisticWeekTss: number;
  message: string;
}

export interface ReplanResult {
  plan: Plan;
  note: string | null;
  recalibration: Recalibration | null;
  lastRecomputed: string;
  rebaselined: boolean;
  forcedRecoveryWeek: string | null;
}

const round = (n: number) => Math.round(n);

/** Consecutive trailing weeks (from the end of the ledger) satisfying `pred`. */
function trailingStreak(ledger: WeekActual[], pred: (w: WeekActual) => boolean): number {
  let n = 0;
  for (let i = ledger.length - 1; i >= 0; i--) {
    if (pred(ledger[i])) n++;
    else break;
  }
  return n;
}

/** Re-simulate each week's end-of-week projected PMC from a seed, spreading the
 *  week's targetTss evenly across 7 days (τ=42/7). Keeps projected internally
 *  consistent after we override a week's target. Never touches the recursion
 *  constants — same math as the corpus pipeline. */
function resimulateProjected(weeks: PlanWeek[], seedCtl: number, seedAtl: number): void {
  let ctl = seedCtl;
  let atl = seedAtl;
  for (const w of weeks) {
    const perDay = w.targetTss / 7;
    let tsb = 0;
    for (let d = 0; d < 7; d++) {
      tsb = ctl - atl; // yesterday's values — TrainingPeaks convention
      ctl = ctl + (perDay - ctl) / CTL_TAU;
      atl = atl + (perDay - atl) / ATL_TAU;
    }
    w.projected = { ctl: round(ctl * 10) / 10, atl: round(atl * 10) / 10, tsb: round(tsb * 10) / 10 };
  }
}

/** Scale a week's session TSS/duration to a new weekly target, preserving the
 *  long session's share (the redistribution template lives in plan.ts). */
function scaleWeek(week: PlanWeek, newTargetTss: number): void {
  const cur = week.sessions.reduce((s, x) => s + x.tss, 0);
  if (cur <= 0) return;
  const factor = newTargetTss / cur;
  for (const s of week.sessions) {
    if (s.discipline === "race") continue;
    s.tss = Math.max(0, round(s.tss * factor));
    s.durationHr = Math.round(s.durationHr * factor * 100) / 100;
  }
  week.targetTss = week.sessions.reduce((s, x) => s + x.tss, 0);
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${round(n)}%`;
}

/**
 * Recompute the remaining plan from actual fitness. Deterministic and
 * side-effect-free; the caller persists via writePlan + carryStatusForward.
 */
export function recomputeRemaining(input: ReplanInput): ReplanResult {
  const { stored, actualState, actualTrailingTss, ledger, asOf, history, zones } = input;
  const req = stored.request;

  // ── Ledger analysis ───────────────────────────────────────────────
  const overshootStreak = trailingStreak(ledger, (w) => w.actualTss > w.plannedTss);
  const missStreak = trailingStreak(
    ledger,
    (w) => w.plannedTss > 0 && w.actualTss <= w.plannedTss * (1 - MISS_FRAC)
  );
  const last = ledger[ledger.length - 1];
  const rebaselined = overshootStreak >= OVERSHOOT_STREAK;

  // Forced recovery: the last completed week ran hard over its ramp ceiling.
  let forcedRecovery = false;
  if (last) {
    const cap = last.rampCapTss ?? last.plannedTss;
    forcedRecovery = cap > 0 && last.actualTss > cap * HARD_OVERSHOOT_OVER_CAP;
  }

  // ── Seed shaping (rule 3): sustained overshoot is demonstrated capacity ──
  const seedState: AthleteState = { ...actualState };
  if (rebaselined && actualTrailingTss.length) {
    // Override the trailing-load features the anchor reads, so rampCapRef and
    // the anchor-v2 peak term rise (learned.ts). Never breaches a rail — the
    // anchor is itself min()-capped at rampCapRef × 1.2 inside anchorV2Ceiling.
    const t = actualTrailingTss;
    seedState.last4WeeksTss = t.slice(-4);
    seedState.trailingWeeksTss = t.slice(-8);
  }

  // ── Reflow: re-run generatePlan from the actual (shaped) seed ──────
  // startDate=asOf makes the loop anchor on this week and count back from the
  // fixed race date; taper/race weeks stay daysToRace-gated protocol.
  const reflowReq: PlanRequest = { ...req, startDate: asOf };
  const plan = generatePlan(reflowReq, seedState, history, zones);

  const oldFinish = stored.plan.meta.goalGap?.realisticFinish;

  // Weeks from this week forward (the reflowed remaining plan).
  const remaining = plan.weeks;
  if (!remaining.length) {
    return { plan, note: null, recalibration: null, lastRecomputed: asOf, rebaselined, forcedRecoveryWeek: null };
  }

  // ── Rule 6 (ahead of trajectory): hold surplus as freshness ────────
  // If actual CTL now exceeds what the ORIGINAL plan projected for this week,
  // cap remaining base/build targets at the original plan's targets — the only
  // sanctioned way to raise volume is rule 3's demonstrated re-baseline.
  const origByWeek = new Map(stored.plan.weeks.map((w) => [w.weekStart, w.targetTss]));
  // "Ahead" = actual fitness NOW exceeds what the original plan expected the
  // athlete to have at the START of this week (= the previous plan week's
  // end-of-week projection, or the plan's seed CTL for the very first week).
  const remIdx = stored.plan.weeks.findIndex((w) => w.weekStart === remaining[0].weekStart);
  const expectedNowCtl = remIdx > 0 ? stored.plan.weeks[remIdx - 1].projected.ctl : stored.plan.meta.startCtl;
  const ahead = !rebaselined && actualState.ctl > expectedNowCtl + 0.5;
  // Track whether we override any target — only then must we re-derive the
  // projected chain (otherwise generatePlan's session-accurate projected stands).
  let modified = false;
  if (ahead) {
    for (const w of remaining) {
      if (w.phase !== "base" && w.phase !== "build") continue;
      const orig = origByWeek.get(w.weekStart);
      if (orig != null && w.targetTss > orig) {
        scaleWeek(w, orig);
        modified = true;
      }
    }
  }

  // ── Rule 1/2: shape the FIRST remaining week ───────────────────────
  const first = remaining[0];
  let overshootPct = 0;
  let forcedRecoveryWeek: string | null = null;
  if (forcedRecovery) {
    // Hard recovery: ≤ maintenance (CTL×7), phase recovery. Strictly more
    // conservative than any rail ⇒ no sign-off.
    const maint = round(actualState.ctl * 7);
    if (first.targetTss > maint) scaleWeek(first, maint);
    first.phase = "recovery";
    forcedRecoveryWeek = first.weekStart;
    modified = true;
  } else if (last && last.actualTss > last.plannedTss) {
    // Overshoot damp: give back exactly the excess, then lower further (down to
    // the weekly-60 rail) until projected end-of-week TSB clears the safe band.
    const overshootRatio = last.actualTss / last.plannedTss;
    overshootPct = (overshootRatio - 1) * 100;
    const plannedThisWeek = origByWeek.get(first.weekStart) ?? first.targetTss;
    let cap = plannedThisWeek / overshootRatio;
    for (let iter = 0; iter < 24; iter++) {
      const test = remaining.map((w) => ({ ...w }));
      test[0] = { ...test[0], targetTss: Math.max(60, round(cap)) };
      resimulateProjected(test, actualState.ctl, actualState.atl);
      if (test[0].projected.tsb >= SAFE_TSB_BAND || cap <= 60) break;
      cap *= 0.95;
    }
    if (Math.max(60, round(cap)) < first.targetTss) {
      scaleWeek(first, Math.max(60, round(cap)));
      modified = true;
    }
  }

  // Re-derive the projected chain ONLY when we overrode a target — otherwise
  // generatePlan's session-accurate projected (incl. the race week) stands.
  // meta.projectedRaceCtl/Tsb remain authoritative from generatePlan either way.
  if (modified) resimulateProjected(remaining, actualState.ctl, actualState.atl);

  // ── Rule 6 (behind): assert the 2-week taper was never compressed ──
  const tail = remaining.slice(-2);
  const taperProtected = remaining.length < 2 || tail.every((w) => w.phase === "taper" || w.phase === "race");
  if (!taperProtected) {
    throw new Error(
      `replan invariant: fewer than 2 taper/race weeks before race day (got ${tail.map((w) => w.phase).join(",")})`
    );
  }

  // ── Rule 5: recalibration card on sustained big miss ───────────────
  let recalibration: Recalibration | null = null;
  if (missStreak >= MISS_STREAK) {
    const gg = plan.meta.goalGap;
    const buildWeeks = remaining.filter((w) => w.phase === "base" || w.phase === "build").map((w) => w.targetTss).sort((a, b) => a - b);
    const median = buildWeeks.length ? buildWeeks[Math.floor(buildWeeks.length / 2)] : round(actualState.ctl * 7);
    const revisedFinish = gg?.realisticFinish ?? "—";
    const reach = gg?.reachablePeakCtl ?? actualState.ctl;
    recalibration = {
      revisedFinish,
      reachablePeakCtl: reach,
      realisticWeekTss: median,
      message:
        `The last ${missStreak} weeks landed well under plan, so fitness is lower than the original curve assumed. ` +
        `From your current reachable CTL ~${round(reach)}, an honest finish here is ~${revisedFinish}. ` +
        `A realistic week now is about ${median} TSS across your ${req.daysPerWeek} days — rebuild from there; ` +
        `the race date hasn't moved and the 2-week taper is protected.`,
    };
  }

  // ── Note (priority: forced > recalibration > rebaseline > damp > ahead) ──
  let note: string | null = null;
  if (forcedRecovery) {
    note = `last week ran ${fmtPct((last!.actualTss / (last!.rampCapTss ?? last!.plannedTss) - 1) * 100)} over the ramp ceiling → this week held to a recovery load (${round(actualState.ctl * 7)} TSS) before building again`;
  } else if (recalibration) {
    note = `${missStreak} light weeks → goal reprojected ${oldFinish ?? "—"}→${recalibration.revisedFinish}`;
  } else if (rebaselined) {
    const newFinish = plan.meta.goalGap?.realisticFinish;
    note = `${overshootStreak} weeks over target → capacity re-baselined up${oldFinish && newFinish ? `; goal reprojected ${oldFinish}→${newFinish}` : ""}`;
  } else if (overshootPct > 0 && first.targetTss < (origByWeek.get(first.weekStart) ?? Infinity)) {
    note = `last week ${fmtPct(overshootPct)} over target → this week eased to ${first.targetTss} TSS to protect form`;
  } else if (ahead) {
    note = `ahead of the curve → surplus held as freshness for a sharper taper, not extra base volume`;
  }

  return { plan, note, recalibration, lastRecomputed: asOf, rebaselined, forcedRecoveryWeek };
}
