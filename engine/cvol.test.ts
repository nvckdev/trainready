import { generatePlan, type PlanRequest } from "./plan.ts";
import { deriveZones, thresholdMpsFromZones } from "./zones.ts";
import type { AthleteState } from "./types.ts";
import { CVOL, cvolFor, weeklyKmToTss } from "./goal.ts";

/**
 * Pace-derived km↔TSS conversion (refinement 3). tsx script; exit code =
 * failures. TSS-per-km is pace-dependent: at the same relative intensity a
 * slower athlete spends more time (more TSS) per km. One global CVOL=4.9
 * systematically understated volume-floor TSS for slower athletes and
 * overstated it for faster ones. cvolFor derives the bridge from threshold
 * speed at the easy-mix intensity; 4.9 stays as the zone-less fallback.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const FAST = 1000 / (4 * 60 + 5); // 4:05/km threshold ≈ 4.082 m/s
const SLOW = 1000 / (6 * 60); // 6:00/km threshold ≈ 2.778 m/s

// ——— C1. the bridge is pace-dependent, monotone, and falls back ——————————
{
  const fast = cvolFor(FAST);
  const slow = cvolFor(SLOW);
  check("C1a", "slower athlete pays more TSS per km", slow > fast + 1, `${slow.toFixed(2)} vs ${fast.toFixed(2)}`);
  check("C1b", "fallback: absent/invalid threshold ⇒ the legacy 4.9",
    cvolFor(undefined) === CVOL && cvolFor(0) === CVOL && cvolFor(NaN) === CVOL);
  check("C1c", "bridge clamps to a sane band [3.5, 9]",
    cvolFor(10) >= 3.5 && cvolFor(0.5) <= 9, `${cvolFor(10).toFixed(2)} / ${cvolFor(0.5).toFixed(2)}`);
  check("C1d", "weeklyKmToTss respects the athlete bridge",
    weeklyKmToTss(32, SLOW) > weeklyKmToTss(32, FAST) && weeklyKmToTss(32) === 32 * CVOL,
    `${weeklyKmToTss(32, SLOW).toFixed(0)} vs ${weeklyKmToTss(32, FAST).toFixed(0)}`);
}

// ——— C2. thresholdMpsFromZones inverts deriveZones ————————————————————————
{
  const z = deriveZones({ ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: FAST, swimCssMps: 1.2 });
  const back = thresholdMpsFromZones(z);
  check("C2a", "threshold speed recovered from zones within 1.5%",
    Math.abs(back - FAST) / FAST < 0.015, `${back.toFixed(3)} vs ${FAST.toFixed(3)}`);
}

// ——— C3. the volume floor differs correctly between athletes ——————————————
{
  const seed: AthleteState = {
    ctl: 30, atl: 28, tsb: 2,
    last4WeeksTss: [190, 200, 205, 210],
    trailingWeeksTss: [170, 180, 185, 190, 190, 200, 205, 210],
    last4Shares: { swim: 0, bike: 0, run: 1 },
    daysToNextRace: null, weeksSinceStart: 24, breakRatio: 1, daysSinceLastSession: 1,
  };
  const REQ: PlanRequest = {
    raceName: "CVOL HM", raceDate: "2026-11-08", raceType: "run-half",
    daysPerWeek: 5, longDay: "sunday", startDate: "2026-07-20", goalTime: "2:00:00",
  };
  const zFast = deriveZones({ ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: FAST, swimCssMps: 1.2 });
  const zSlow = deriveZones({ ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: SLOW, swimCssMps: 1.2 });
  const pFast = generatePlan(REQ, seed, [], zFast);
  const pSlow = generatePlan(REQ, seed, [], zSlow);
  // Same modest goal, same seed: the 32 km evidence floor costs the slower
  // athlete more TSS, so their build weeks are lifted at least as high — and
  // strictly higher at the peak (both still under the ramp rails).
  const peak = (p: typeof pFast) => Math.max(...p.weeks.filter((w) => w.phase !== "race").map((w) => w.targetTss));
  check("C3a", "peak week TSS: slower athlete ≥ faster (32 km costs them more)",
    peak(pSlow) >= peak(pFast), `${peak(pSlow)} vs ${peak(pFast)}`);
  check("C3b", "both plans still meet the km floor in km terms",
    pFast.meta.volumeTargets?.meetsWeeklyFloor === true && pSlow.meta.volumeTargets?.meetsWeeklyFloor === true,
    `${pFast.meta.volumeTargets?.peakWeeklyKmActual} / ${pSlow.meta.volumeTargets?.peakWeeklyKmActual} km`);
}

for (const p of passes) console.log(p);
for (const f of failures) console.error(f);
console.log(`\n${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
