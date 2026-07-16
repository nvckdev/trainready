import { existsSync, readFileSync } from "node:fs";
import { generatePlan, type PlanRequest } from "./plan.ts";
import { deriveZones } from "./zones.ts";
import { TaperV1 } from "./learned.ts";
import { seedStateAt, type DailyPmcPoint } from "./seed.ts";
import type { AthleteState } from "./types.ts";
import { EVIDENCE_FLOOR, peakLongKm, peakWeeklyKm, weeklyKmToTss, CVOL } from "./goal.ts";
import { declareTissue } from "./tissue.ts";

/**
 * Volume & long-run direct-target tests (feature 2). tsx harness; exit = fails.
 * Fokkema 2020 floors (HM ≥32 km/wk, ≥21 km long) are derived from distance and
 * TSS follows the km — not the other way round. No corpus (synthetic seed).
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

// ——— V1. evidence floors + km→TSS bridge ————————————————————————————
{
  check("V1a", "HM evidence floor is 32 km/wk & 21 km long (Fokkema 2020)",
    EVIDENCE_FLOOR["run-half"].weeklyKm === 32 && EVIDENCE_FLOOR["run-half"].longRunKm === 21);
  check("V1b", "weeklyKmToTss(32) = 32 × CVOL", Math.abs(weeklyKmToTss(32) - 32 * CVOL) < 1e-9, `${weeklyKmToTss(32)}`);
  check("V1c", "peakWeeklyKm(run-half) with no goal = the 32 km floor", peakWeeklyKm("run-half") === 32);
}

// ——— V2. targets scale UP toward the goal, DOWN under a tissue cap ————
{
  const bigGoalWeeklyTss = 400; // ~81.6 km/wk
  check("V2a", "a demanding goal scales the weekly target above the floor",
    peakWeeklyKm("run-half", bigGoalWeeklyTss) > 32, `${peakWeeklyKm("run-half", bigGoalWeeklyTss).toFixed(1)}`);
  check("V2b", "a tissue weekly cap pulls the target below the floor (shortfall)",
    peakWeeklyKm("run-half", bigGoalWeeklyTss, 25) === 25);
  check("V2c", "long run is distance-driven and ≥ the 21 km floor",
    peakLongKm("run-half") >= 21 && Math.abs(peakLongKm("run-half") - 21.1 * 1.15) < 1e-9);
}

/* ——— Synthetic athletes (no corpus) ——— */
const zones = deriveZones({ ftpWatts: 250, lthrBpm: 165, runThresholdSpeedMps: 3.8, swimCssMps: 1.4 });
const fit: AthleteState = {
  ctl: 42, atl: 40, tsb: 2,
  last4WeeksTss: [300, 320, 330, 340], trailingWeeksTss: [280, 300, 300, 320, 300, 320, 330, 340],
  last4Shares: { swim: 0, bike: 0, run: 1 }, daysToNextRace: null, weeksSinceStart: 30, breakRatio: 1.05, daysSinceLastSession: 1,
};
const REQ: PlanRequest = {
  raceName: "Synthetic Half", raceDate: "2026-10-18", raceType: "run-half",
  daysPerWeek: 6, longDay: "sunday", startDate: "2026-07-13", goalTime: "1:30:00",
};

// ——— V3. a goal-backed HM plan reaches the evidence floor —————————————
{
  const plan = generatePlan(REQ, fit, [], zones);
  const vt = plan.meta.volumeTargets;
  check("V3a", "run-race plan carries volumeTargets", vt != null);
  check("V3b", "peak weekly volume meets the 32 km floor (no tissue cap)", !!vt?.meetsWeeklyFloor, `${vt?.peakWeeklyKmActual} km`);
  check("V3c", "peak long run meets the 21 km floor", !!vt?.meetsLongFloor, `${vt?.peakLongKmActual} km`);
  check("V3d", "targets are distance-derived, not tissue-limited here", vt?.tissueActive === false);
}

// ——— V4. DIFFERENTIAL — the evidence floor lifts a modest-goal HM ————————
// The learned floor only runs on a TRAINED engine (≥24 wk), so this needs the
// corpus. A modest 2:10 goal implies tiny volume (goalPeakCtl≈7), so the peak
// build week is driven by the 32 km EVIDENCE floor, not the goal — vs a goal-less
// plan (no floor at all), whose peak is pure anchor/ramp.
(() => {
  if (!existsSync("data/datasets/weekly-examples.jsonl") || !existsSync("data/derived/pmc.csv")) {
    console.log("  V4 SKIP — corpus absent (the learned floor needs a trained engine)");
    return;
  }
  const a = JSON.parse(readFileSync("data/raw/athlete.json", "utf8"));
  const lines = readFileSync("data/datasets/weekly-examples.jsonl", "utf8").split("\n").filter(Boolean);
  const history = lines.map((l) => {
    const ex = JSON.parse(l);
    return { state: ex.features as AthleteState, actualTss: ex.targets.weekTss as number, weekStart: ex.weekStart as string };
  });
  const [, ...pl] = readFileSync("data/derived/pmc.csv", "utf8").trim().split("\n");
  const series: DailyPmcPoint[] = pl.map((l) => { const [date, , ctl, atl] = l.split(","); return { date, ctl: +ctl, atl: +atl }; });
  const seed = seedStateAt(history[history.length - 1].state, series, "2026-07-13");
  const zones = deriveZones({ ftpWatts: a.thresholds.ftpWatts, lthrBpm: a.thresholds.lthrBpm, runThresholdSpeedMps: a.thresholds.runThresholdSpeedMpsAlt ?? a.thresholds.runThresholdSpeedMps, swimCssMps: a.thresholds.swimCssMps });
  const req: PlanRequest = { raceName: "HM", raceDate: "2026-10-18", raceType: "run-half", daysPerWeek: 6, longDay: "sunday", startDate: "2026-07-13" };
  const peakBuild = (gt?: string) => {
    const plan = generatePlan({ ...req, goalTime: gt }, seed, history, zones);
    const bw = plan.weeks.filter((w) => w.phase === "base" || w.phase === "build");
    return bw.length ? Math.max(...bw.map((w) => w.targetTss)) : 0;
  };
  const modest = peakBuild("2:10:00"); // evidence floor drives it
  const noGoal = peakBuild(undefined); // no floor at all
  check("V4", "a modest-goal HM peaks higher than goal-less (the 32 km evidence floor lifts it)",
    modest > noGoal + 5, `modest-goal ${modest} vs goal-less ${noGoal} TSS`);
})();

// ——— V5. a tissue weekly cap below the floor ⇒ goal-gap SAYS SO ————————
{
  // A volume-provoked shin injury caps weekly km; the plan can't reach 32 km,
  // and the goal-gap must state the shortfall rather than drop the target silently.
  const capped = generatePlan(
    { ...REQ, goalTime: "1:24:00", tissueConstraints: [declareTissue("shin", "acute", "volume")] },
    fit, [], zones
  );
  const vt = capped.meta.volumeTargets;
  check("V5a", "a weekly-km tissue cap flags tissueActive", vt?.tissueActive === true);
  check("V5b", "when a floor is missed under a cap, the goal-gap explains it",
    !vt?.meetsWeeklyFloor ? /evidence floor/.test(capped.meta.goalGap?.message ?? "") : true,
    capped.meta.goalGap?.message?.slice(-90));
}

// ——— V6. NEUTRALITY — the floor is invisible to a backtest-shape prescribe —
{
  const eng = new TaperV1({ anchorV2: true });
  const base: AthleteState = { ...fit, goalPeakCtl: 30 };
  // Dataset rows never carry peakWeeklyTssFloor; setting it to the goal weekly
  // (goalPeakCtl·7, which the goal floor already targets) must not move the value.
  const a = eng.prescribeWeek({ ...base }).weekTss;
  const b = eng.prescribeWeek({ ...base, peakWeeklyTssFloor: 30 * 7 }).weekTss;
  check("V6", "peakWeeklyTssFloor = goalPeakCtl·7 leaves prescribeWeek byte-identical", a === b, `${a} vs ${b}`);
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.log("  " + f);
console.log(`\nvolume: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
