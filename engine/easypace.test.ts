import { generatePlan, type PlanRequest } from "./plan.ts";
import { deriveZones } from "./zones.ts";
import type { AthleteState } from "./types.ts";
import { easyKmhFor, qualityKmhFor, LONG_EASY_KMH } from "./goal.ts";
import { sessionRunKm } from "./volume.ts";

/**
 * Athlete easy-pace duration bridge (refinement 4). tsx script; exit code =
 * failures. duration = km / 11.6 was a population constant standing in for a
 * per-athlete quantity: the same 21 km long run takes a 6:00/km-threshold
 * athlete far longer than a 4:05 one. easyKmhFor/qualityKmhFor derive the
 * speeds from threshold pace (the same zone fractions deriveZones uses);
 * 11.6 / 12.4 remain the zone-less fallbacks; the ≤2.6 h clamp stands.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const FAST = 1000 / (4 * 60 + 5);
const SLOW = 1000 / (6 * 60);

// ——— E1. units + fallbacks ————————————————————————————————————————————————
{
  check("E1a", "easyKmhFor = mid of the easy zone (0.80·vT)",
    Math.abs(easyKmhFor(FAST) - 0.8 * FAST * 3.6) < 1e-9, easyKmhFor(FAST).toFixed(2));
  check("E1b", "fallbacks: absent threshold ⇒ legacy 11.6 / 12.4",
    easyKmhFor(undefined) === LONG_EASY_KMH && qualityKmhFor(undefined) === 12.4);
  check("E1c", "slower athlete covers fewer km per easy hour",
    easyKmhFor(SLOW) < easyKmhFor(FAST) - 2, `${easyKmhFor(SLOW).toFixed(1)} vs ${easyKmhFor(FAST).toFixed(1)}`);
  check("E1d", "sessionRunKm without pace params keeps the legacy constant",
    Math.abs(
      sessionRunKm({ discipline: "run", title: "Long run 90", durationHr: 1.5 } as never) - 1.5 * LONG_EASY_KMH
    ) < 1e-9);
}

// ——— E2. the long run takes the athlete THEIR time ————————————————————————
{
  const seed: AthleteState = {
    ctl: 40, atl: 38, tsb: 2,
    last4WeeksTss: [260, 270, 275, 280],
    trailingWeeksTss: [240, 250, 255, 260, 260, 270, 275, 280],
    last4Shares: { swim: 0, bike: 0, run: 1 },
    daysToNextRace: null, weeksSinceStart: 24, breakRatio: 1, daysSinceLastSession: 1,
  };
  const REQ: PlanRequest = {
    raceName: "Pace HM", raceDate: "2026-11-08", raceType: "run-half",
    daysPerWeek: 5, longDay: "sunday", startDate: "2026-07-20", goalTime: "2:00:00",
  };
  const gen = (mps: number) =>
    generatePlan(REQ, seed, [], deriveZones({ ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: mps, swimCssMps: 1.2 }));
  const pFast = gen(FAST);
  const pSlow = gen(SLOW);
  const peakLongHr = (p: ReturnType<typeof gen>) =>
    Math.max(...p.weeks.flatMap((w) => w.sessions).filter((s) => /long/i.test(s.title)).map((s) => s.durationHr));
  const fastHr = peakLongHr(pFast);
  const slowHr = peakLongHr(pSlow);
  // The slower athlete takes longer for the same km — until the 2.6 h session
  // clamp binds, which for a 6:00/km threshold it does at almost exactly the
  // 21 km floor (8 km/h × 2.6 h = 20.8 km). The clamp winning IS the contract.
  check("E2a", "same km target takes the slower athlete longer, up to the 2.6 h clamp",
    slowHr > fastHr && slowHr >= 2.6 - 1e-9, `${slowHr.toFixed(2)}h vs ${fastHr.toFixed(2)}h`);
  check("E2b", "the 2.6 h clamp still stands for both",
    fastHr <= 2.6 + 1e-9 && slowHr <= 2.6 + 1e-9);
  check("E2c", "both plans' long-run ACTUALS are measured at the athlete's pace (km floors met)",
    pFast.meta.volumeTargets?.meetsLongFloor === true && pSlow.meta.volumeTargets?.meetsLongFloor === true,
    `${pFast.meta.volumeTargets?.peakLongKmActual} / ${pSlow.meta.volumeTargets?.peakLongKmActual} km`);
}

for (const p of passes) console.log(p);
for (const f of failures) console.error(f);
console.log(`\n${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
