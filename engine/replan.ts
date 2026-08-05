import { generatePlan, type Plan, type PlanRequest, type PlanWeek } from "./plan.ts";
import { scaleSessionStructure } from "./session-scale.ts";
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
  /**
   * Executed weekly TSS. `null` means UNKNOWN — no source could vouch for the
   * week. A number (including 0) is authoritative evidence. The type carries
   * the distinction so a caller cannot fabricate a zero for a week nobody
   * measured: that fabrication once fed missStreak and recalibrated a
   * season's goal off silence. Beware JS coercion — `null <= x` is true
   * (null coerces to 0), so every consumer must test `!== null` explicitly
   * before comparing.
   */
  actualTss: number | null;
  plannedTss: number; // the stored PlanWeek.targetTss for that week
  rampCapTss?: number; // the +20% anchor ramp ceiling that governed the week
  sessionsMissed: number;
  sessionsPlanned: number;
}

/** The minimum a plan week must carry for ledger construction. */
export interface LedgerWeekInput {
  weekStart: string;
  targetTss: number;
  sessions: Array<{ discipline: string; tss: number; status?: string }>;
}

const LEDGER_DAY = 86400000;
const ledgerAt = (d: string) => Date.parse(d + "T12:00:00Z");

/**
 * Per-week ledger for recomputeRemaining — ONE implementation for both
 * surfaces. Every mobile-lags-dashboard incident in this repo's history
 * lived in duplicated copies of exactly this function.
 *
 * A completed week absent from `executed` becomes `actualTss: null`
 * (unknown), never 0 — an unknown week breaks streaks instead of counting
 * as a total miss. `rampRef` uses `||`, not `??`: an authoritative
 * zero-executed week is real evidence but a useless ramp reference, and
 * coalescing it to 0 disables the forced-recovery rule entirely.
 */
export function buildLedger(
  weeks: LedgerWeekInput[],
  asOf: string,
  executed: Map<string, number>
): WeekActual[] {
  const completed = weeks.filter((w) => ledgerAt(w.weekStart) + 7 * LEDGER_DAY <= ledgerAt(asOf));
  return completed.map((wk, i) => {
    const prev = completed[i - 1];
    const rampRef = prev ? (executed.get(prev.weekStart) || prev.targetTss) : wk.targetTss;
    const known = executed.get(wk.weekStart);
    return {
      weekStart: wk.weekStart,
      actualTss: known === undefined ? null : Math.round(known),
      plannedTss: wk.targetTss,
      rampCapTss: Math.round(rampRef * 1.2),
      sessionsMissed: wk.sessions.filter((s) => s.discipline !== "race" && s.status !== "done").length,
      sessionsPlanned: wk.sessions.length,
    };
  });
}

/**
 * Trailing executed TSS of KNOWN completed weeks only, oldest → newest.
 * Unknown weeks are omitted, not zero-filled — a fabricated zero here
 * depressed the demonstrated-capacity terms that the rebaseline reads,
 * throttling the very lift it was meant to grant.
 */
export function knownTrailingTss(
  weeks: LedgerWeekInput[],
  asOf: string,
  executed: Map<string, number>,
  n = 8
): number[] {
  return weeks
    .filter((w) => ledgerAt(w.weekStart) + 7 * LEDGER_DAY <= ledgerAt(asOf) && executed.has(w.weekStart))
    .slice(-n)
    .map((w) => Math.round(executed.get(w.weekStart)!));
}

export interface ReplanInput {
  stored: StoredPlan;
  actualState: AthleteState; // getStateAt(asOf) — pmc-seeded ctl/atl/tsb
  actualTrailingTss: number[]; // ACTUAL executed weekly TSS, oldest→newest
  ledger: WeekActual[]; // completed weeks only, chronological
  asOf: string; // athlete-local today (rule 16) — the SURFACE supplies the athlete tz
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
    for (let d = 0; d < 7; d++) {
      ctl = ctl + (perDay - ctl) / CTL_TAU;
      atl = atl + (perDay - atl) / ATL_TAU;
    }
    // End-of-week projection. TSB derived from the ROUNDED ctl/atl so the object
    // is exactly self-consistent (projected.tsb === projected.ctl − projected.atl),
    // matching how a freshly generated plan reports the field.
    const rctl = round(ctl * 10) / 10;
    const ratl = round(atl * 10) / 10;
    w.projected = { ctl: rctl, atl: ratl, tsb: round((rctl - ratl) * 10) / 10 };
  }
}

/** Scale a week's session TSS/duration to a new weekly target, preserving the
 *  long session's share (the redistribution template lives in plan.ts).
 *
 *  The session's DESCRIPTION scales with it. Until 2026-08-05 this touched only
 *  tss and durationHr, so title, structure and workout.blocks kept describing
 *  the session as first built — "Long run 115" scheduled as 22 minutes, "Easy
 *  60" as 12. One quantity, one ruler: the blocks scale by the same factor and
 *  the text and title are derived from the result. */
function scaleWeek(week: PlanWeek, newTargetTss: number): void {
  const cur = week.sessions.reduce((s, x) => s + x.tss, 0);
  if (cur <= 0) return;
  const factor = newTargetTss / cur;
  for (const s of week.sessions) {
    if (s.discipline === "race") continue;
    s.tss = Math.max(0, round(s.tss * factor));
    s.durationHr = Math.round(s.durationHr * factor * 100) / 100;
    // After durationHr, never before — the title is regenerated from it.
    scaleSessionStructure(s, factor);
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
  const overshootStreak = trailingStreak(ledger, (w) => w.actualTss !== null && w.actualTss > w.plannedTss);
  // Explicit null guard — `null <= x` coerces null to 0 and would count an
  // UNKNOWN week as a total miss, which is the exact fabrication the null
  // exists to prevent. An unknown week breaks the streak.
  const missStreak = trailingStreak(
    ledger,
    (w) => w.actualTss !== null && w.plannedTss > 0 && w.actualTss <= w.plannedTss * (1 - MISS_FRAC)
  );
  const last = ledger[ledger.length - 1];
  const rebaselined = overshootStreak >= OVERSHOOT_STREAK;

  // Forced recovery: the last completed week ran hard over its ramp ceiling.
  let forcedRecovery = false;
  if (last && last.actualTss !== null) {
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
  let aheadHeld = false; // did the ahead-cap actually hold a week back?
  if (ahead) {
    for (const w of remaining) {
      if (w.phase !== "base" && w.phase !== "build") continue;
      const orig = origByWeek.get(w.weekStart);
      if (orig != null && w.targetTss > orig) {
        scaleWeek(w, orig);
        modified = true;
        aheadHeld = true;
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
  } else if (last && last.actualTss !== null && last.plannedTss > 0 && last.actualTss > last.plannedTss) {
    // Overshoot damp: give back exactly the excess, then lower further (down to
    // the weekly-60 rail) until projected end-of-week TSB clears the safe band.
    // (plannedTss > 0 guards the ratio — a 0-target week never damps.)
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
  if (modified) {
    resimulateProjected(remaining, actualState.ctl, actualState.atl);
    // Keep the headline race-day figures consistent with the re-chained
    // trajectory (the last week is the race week).
    const raceWk = remaining[remaining.length - 1];
    plan.meta.projectedRaceCtl = raceWk.projected.ctl;
    plan.meta.projectedRaceTsb = raceWk.projected.tsb;
  }

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
  // forcedRecovery already implies a non-null last.actualTss; the repeated
  // guard is for the type system, not a second behavior branch.
  if (forcedRecovery && last && last.actualTss !== null) {
    note = `last week ran ${fmtPct((last.actualTss / (last.rampCapTss ?? last.plannedTss) - 1) * 100)} over the ramp ceiling → this week held to a recovery load (${round(actualState.ctl * 7)} TSS) before building again`;
  } else if (recalibration) {
    note = `${missStreak} light weeks → goal reprojected ${oldFinish ?? "—"}→${recalibration.revisedFinish}`;
  } else if (rebaselined) {
    const newFinish = plan.meta.goalGap?.realisticFinish;
    note = `${overshootStreak} weeks over target → capacity re-baselined up${oldFinish && newFinish ? `; goal reprojected ${oldFinish}→${newFinish}` : ""}`;
  } else if (overshootPct > 0 && first.targetTss < (origByWeek.get(first.weekStart) ?? Infinity)) {
    note = `last week ${fmtPct(overshootPct)} over target → this week eased to ${first.targetTss} TSS to protect form`;
  } else if (ahead && aheadHeld) {
    note = `ahead of the curve → surplus held as freshness for a sharper taper, not extra base volume`;
  }

  return { plan, note, recalibration, lastRecomputed: asOf, rebaselined, forcedRecoveryWeek };
}
