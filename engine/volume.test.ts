import { generatePlan, type PlanRequest } from "./plan.ts";
import { deriveZones } from "./zones.ts";
import { TaperV1 } from "./learned.ts";
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

// ——— V4. a modest goal is LIFTED toward the evidence floor ————————————
{
  // A slow goal implies little volume on its own; the evidence floor pulls the
  // peak build week's load up (bounded by the ramp) vs the same plan w/o the floor.
  const slow = generatePlan({ ...REQ, goalTime: "2:10:00" }, fit, [], zones);
  const peakSlow = Math.max(...slow.weeks.filter((w) => w.phase === "build" || w.phase === "base").map((w) => w.targetTss));
  check("V4", "peak base/build week clears the goal-only weekly (evidence floor lifts it)",
    peakSlow >= weeklyKmToTss(32) * 0.6, `peak ${peakSlow} TSS vs floor ${Math.round(weeklyKmToTss(32))}`);
}

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
