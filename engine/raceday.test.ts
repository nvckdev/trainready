import {
  capabilityProfile,
  heatPenaltyFrac,
  raceDayPlan,
  fmtHMS,
  fmtPace,
} from "./raceday.ts";
import type { RaceAnchor } from "./goal.ts";

/**
 * Race-day execution + capability acceptance tests (tsx script; exit code =
 * failure count, same harness as goal.test.ts). Pure presentation over the
 * corrected finish model — no PMC math, never in the backtest path.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const HALF = 21.0975;
// Athlete's real anchors (mirrors athlete-context.json): 1:31 @ CTL 17.6, 1:17 PR @ 67.3.
const ANCHORS: RaceAnchor[] = [
  { date: "2026-05-03", distanceKm: 21.29, timeSec: 5502.47, ctlAtRace: 17.6 },
  { date: "2023-11-05", distanceKm: 21.07, timeSec: 4635.81, ctlAtRace: 67.3 },
];
const ASOF = "2026-07-13";

// ——— R1. Target = honest finish; splits sum to it exactly ———————————
{
  const p = raceDayPlan({ distanceKm: HALF, projectedRaceCtl: 20, anchors: ANCHORS, asOf: ASOF });
  check("R1a", "avg pace = target / distance", near(p.avgPaceSecPerKm, p.targetSec / HALF, 0.01),
    `${fmtPace(p.avgPaceSecPerKm)} of ${fmtHMS(p.targetSec)}`);
  const last = p.splits[p.splits.length - 1];
  check("R1b", "final split cumulative == target (splits reconcile)",
    near(last.cumulativeSec, p.targetSec, 0.5), `${fmtHMS(last.cumulativeSec)} vs ${fmtHMS(p.targetSec)}`);
  check("R1c", "reachable-CTL 20 target is not slower than the real 1:31 (honesty inherited)",
    p.targetSec <= 5502.47 + 1, fmtHMS(p.targetSec));
}

// ——— R2. Negative split: last third faster than first ———————————————
{
  const p = raceDayPlan({ distanceKm: HALF, projectedRaceCtl: 20, anchors: ANCHORS, asOf: ASOF });
  check("R2", "negative split — final third pace < opening third pace",
    p.splits[2].paceSecPerKm < p.splits[0].paceSecPerKm,
    `${fmtPace(p.splits[0].paceSecPerKm)} → ${fmtPace(p.splits[2].paceSecPerKm)}`);
}

// ——— R3. Heat slows the target and flags it ————————————————————————
{
  const cool = raceDayPlan({ distanceKm: HALF, projectedRaceCtl: 20, anchors: ANCHORS, asOf: ASOF, tempC: 12 });
  const hot = raceDayPlan({ distanceKm: HALF, projectedRaceCtl: 20, anchors: ANCHORS, asOf: ASOF, tempC: 30 });
  check("R3a", "≤15°C ⇒ no penalty", heatPenaltyFrac(12) === 0 && !cool.weatherAdjusted);
  check("R3b", "30°C ⇒ slower target + weatherAdjusted flag",
    hot.targetSec > cool.targetSec && hot.weatherAdjusted,
    `+${((hot.targetSec / cool.targetSec - 1) * 100).toFixed(1)}%`);
  check("R3c", "heat penalty capped at 8%", heatPenaltyFrac(100) <= 0.08 + 1e-9);
}

// ——— R4. Fuelling scales with duration ————————————————————————————
{
  const shortRace = raceDayPlan({ distanceKm: 5, projectedRaceCtl: 30, anchors: ANCHORS, asOf: ASOF });
  const longRace = raceDayPlan({ distanceKm: 42.195, projectedRaceCtl: 20, anchors: ANCHORS, asOf: ASOF });
  check("R4a", "short (<75min) prescribes no gels", shortRace.fuel.length === 0);
  check("R4b", "marathon prescribes carbs 60–90 g/hr and timed fuel",
    longRace.carbsPerHourG[1] === 90 && longRace.fuel.length > 0,
    `${longRace.fuel.length} cues, ${longRace.carbsPerHourG.join("–")} g/hr`);
  check("R4c", "first fuel cue is early (≤ ~20 min in)",
    longRace.fuel[0].atMin <= 20, `${longRace.fuel[0].atMin} min`);
}

// ——— C1. Capability: PR-equivalents monotone in distance ———————————
{
  const cap = capabilityProfile(20, ANCHORS, ASOF);
  const times = cap.distances.map((d) => d.finishSec);
  const monotone = times.every((t, i) => i === 0 || t > times[i - 1]);
  check("C1a", "finish time strictly increases 5K < 10K < Half < Marathon", monotone,
    cap.distances.map((d) => `${d.label} ${fmtHMS(d.finishSec)}`).join(", "));
  check("C1b", "pace slows with distance (5K faster than marathon)",
    cap.distances[0].paceSecPerKm < cap.distances[3].paceSecPerKm);
}

// ——— C2. % toward peak-era ceiling is in (0,1] and rises with CTL ————
{
  const low = capabilityProfile(18, ANCHORS, ASOF);
  const high = capabilityProfile(40, ANCHORS, ASOF);
  check("C2a", "pctOfPeak in (0,1]",
    low.pctOfPeak != null && low.pctOfPeak > 0 && low.pctOfPeak <= 1, `${((low.pctOfPeak ?? 0) * 100).toFixed(0)}%`);
  check("C2b", "higher CTL ⇒ closer to peak", (high.pctOfPeak ?? 0) >= (low.pctOfPeak ?? 0),
    `${((low.pctOfPeak ?? 0) * 100).toFixed(0)}% → ${((high.pctOfPeak ?? 0) * 100).toFixed(0)}%`);
  check("C2c", "vdotPeak reflects the 1:17 PR anchor (~60)", (high.vdotPeak ?? 0) > 55);
}

// ——— C3. No anchors ⇒ still produces a sane profile (generic fallback) —
{
  const cap = capabilityProfile(30, [], ASOF);
  check("C3", "no race anchors ⇒ pctOfPeak null, finishes still finite/monotone",
    cap.pctOfPeak === null && cap.distances.every((d) => Number.isFinite(d.finishSec)) &&
      cap.distances[0].finishSec < cap.distances[3].finishSec);
}

// ——— report ———————————————————————————————————————————————————————
for (const p of passes) console.log("  " + p);
for (const f of failures) console.log("  " + f);
console.log(`\nraceday: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
