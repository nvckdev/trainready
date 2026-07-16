import { generatePlan, type Plan, type PlanRequest } from "./plan.ts";
import { deriveZones } from "./zones.ts";
import type { AthleteState } from "./types.ts";
import { crossTrainSplit, crossKindFor } from "./crosstrain.ts";
import { declareTissue } from "./tissue.ts";

/**
 * Cross-training volume-substitution tests (feature 5). tsx harness; exit=fails.
 * When a tissue cap holds weekly RUNNING below the aerobic target, non-impact
 * bike/pool closes the gap — and running-specific CTL is tracked SEPARATELY from
 * total CTL (only running load predicts running performance).
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

// ——— X1. the split is pure and inert without a cap —————————————————————
{
  const s = crossTrainSplit(200, 120);
  check("X1a", "cap below target ⇒ run to the cap, cross fills the rest", s.runTss === 120 && s.crossTss === 80 && s.active);
  check("X1b", "no cap (Infinity) ⇒ all running, inactive", !crossTrainSplit(200, Infinity).active && crossTrainSplit(200, Infinity).crossTss === 0);
  check("X1c", "modality: big gap ⇒ bike, small gap ⇒ pool", crossKindFor(60) === "bike-z2" && crossKindFor(20) === "swim-endurance");
}

/* ——— Synthetic athlete (no corpus) ——— */
const zones = deriveZones({ ftpWatts: 250, lthrBpm: 165, runThresholdSpeedMps: 3.8, swimCssMps: 1.4 });
const seed: AthleteState = {
  ctl: 30, atl: 28, tsb: 2,
  last4WeeksTss: [200, 210, 210, 220], trailingWeeksTss: [180, 190, 200, 200, 210, 210, 210, 220],
  last4Shares: { swim: 0, bike: 0, run: 1 }, daysToNextRace: null, weeksSinceStart: 30, breakRatio: 1, daysSinceLastSession: 1,
};
const REQ: PlanRequest = {
  raceName: "XT Half", raceDate: "2026-10-18", raceType: "run-half",
  daysPerWeek: 6, longDay: "sunday", startDate: "2026-07-13", goalTime: "1:30:00",
};
// An acute volume-provoked shin injury caps weekly running to ~24 km (< the 32 km floor).
const capped = generatePlan({ ...REQ, tissueConstraints: [declareTissue("shin", "acute", "volume")] }, seed, [], zones);
const healthy = generatePlan(REQ, seed, [], zones);
const runKm = (s: { discipline: string; durationHr: number }) => (s.discipline === "run" ? s.durationHr * 11.6 : 0);

// ——— X2. the capped athlete gets cross-training substitutions ——————————
{
  const subs = capped.weeks.flatMap((w) => w.sessions).filter((s) => s.substituted);
  check("X2a", "a weekly-capped plan adds substituted (cross-train) sessions", subs.length > 0, `${subs.length} sessions`);
  check("X2b", "substitutions are non-impact (bike or swim), never run", subs.every((s) => s.discipline === "bike" || s.discipline === "swim"));
  check("X2c", "a healthy plan adds NONE (never prophylactic)", healthy.weeks.flatMap((w) => w.sessions).every((s) => !s.substituted));
}

// ——— X3. running is held DOWN by the cap while total aerobic is filled ————
{
  const peak = (p: Plan) => Math.max(...p.weeks.filter((w) => w.phase === "base" || w.phase === "build").map((w) => w.sessions.reduce((a, s) => a + runKm(s), 0)));
  // The km cap converts to a TSS budget (× CVOL); with feature-1's easy-heavy
  // weeks that budget buys somewhat more km than nominal, but running is still
  // sharply reduced vs the uncapped plan — the impact-reduction intent holds.
  check("X3a", "the tissue cap sharply reduces peak weekly running vs the healthy plan",
    peak(capped) < peak(healthy) * 0.75, `capped ${peak(capped).toFixed(0)} km vs healthy ${peak(healthy).toFixed(0)} km`);
  // A week with substitution: total TSS (run + cross) exceeds the running-only TSS.
  const wWithSub = capped.weeks.find((w) => w.sessions.some((s) => s.substituted))!;
  const runTss = wWithSub.sessions.filter((s) => !s.substituted).reduce((a, s) => a + s.tss, 0);
  check("X3b", "total aerobic load exceeds running-only (the gap is filled)", wWithSub.targetTss > runTss, `${wWithSub.targetTss} vs run ${runTss}`);
}

// ——— X4. running-CTL and total-CTL are tracked separately, never conflated —
{
  const diverged = capped.weeks.find((w) => w.projected.runCtl !== undefined);
  check("X4a", "some week carries a separate run-CTL below total CTL", !!diverged && diverged.projected.runCtl! < diverged.projected.ctl,
    diverged ? `run ${diverged.projected.runCtl} vs total ${diverged.projected.ctl}` : "none");
  check("X4b", "meta surfaces a running race-day CTL below the total", capped.meta.projectedRaceRunCtl !== undefined && capped.meta.projectedRaceRunCtl < capped.meta.projectedRaceCtl,
    `run ${capped.meta.projectedRaceRunCtl} vs total ${capped.meta.projectedRaceCtl}`);
  check("X4c", "a healthy plan conflates nothing (no run-CTL fields at all)",
    healthy.meta.projectedRaceRunCtl === undefined && healthy.weeks.every((w) => w.projected.runCtl === undefined));
}

// ——— X5. the finish honestly reads RUNNING fitness, not the inflated total —
{
  // The goal-gap reachable CTL is the running race-day CTL, so cross-training
  // never fakes a faster finish than the legs earned.
  const reach = capped.meta.goalGap?.reachablePeakCtl;
  check("X5", "goal-gap reachable CTL matches the running (not total) race-day CTL",
    reach !== undefined && Math.abs(reach - (capped.meta.projectedRaceRunCtl ?? 0)) < 0.2,
    `reach ${reach} vs runCtl ${capped.meta.projectedRaceRunCtl}`);
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.log("  " + f);
console.log(`\ncrosstrain: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
