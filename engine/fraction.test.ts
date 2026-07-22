import { generatePlan, type PlanRequest } from "./plan.ts";
import { deriveZones, thresholdMpsFromZones } from "./zones.ts";
import type { AthleteState } from "./types.ts";
import { easyKmhFor, qualityKmhFor, LONG_FRACTION_MAX } from "./goal.ts";
import { weekRunKm, sessionRunKm } from "./volume.ts";

/**
 * Long-run volume-fraction rail (refinement 5). tsx script; exit code =
 * failures. A 21 km long run on a 40 km week is >50% of weekly volume — the
 * exact overuse pattern for a low-volume athlete. The rail caps the long run
 * at ~35% of the week's running km. When it conflicts with the Fokkema
 * ≥21 km floor (observational tier), the plan surfaces the tradeoff honestly
 * in the goal-gap copy — it never silently picks a side, and never fudges
 * meetsLongFloor to true.
 */

const failures: string[] = [];
const passes: string[] = [];
function chk(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const zones = (mps: number) => deriveZones({ ftpWatts: 220, lthrBpm: 165, runThresholdSpeedMps: mps, swimCssMps: 1.1 });
const REQ: PlanRequest = {
  raceName: "Fraction HM", raceDate: "2026-11-08", raceType: "run-half",
  daysPerWeek: 5, longDay: "sunday", startDate: "2026-07-20", goalTime: "1:55:00",
};

// Low-volume athlete: small CTL, small trailing weeks ⇒ weekly km well under
// what a 21 km long run can sit safely inside.
const lowSeed: AthleteState = {
  ctl: 16, atl: 15, tsb: 1,
  last4WeeksTss: [95, 100, 105, 110],
  trailingWeeksTss: [85, 90, 95, 95, 95, 100, 105, 110],
  last4Shares: { swim: 0, bike: 0, run: 1 },
  daysToNextRace: null, weeksSinceStart: 24, breakRatio: 1, daysSinceLastSession: 1,
};
// Established athlete (the polarized fixture): ~60 km weeks — the rail must not bind.
const highSeed: AthleteState = {
  ctl: 30, atl: 28, tsb: 2,
  last4WeeksTss: [190, 200, 205, 210],
  trailingWeeksTss: [170, 180, 185, 190, 190, 200, 205, 210],
  last4Shares: { swim: 0, bike: 0, run: 1 },
  daysToNextRace: null, weeksSinceStart: 24, breakRatio: 1, daysSinceLastSession: 1,
};

// ——— F1. the rail binds per week for the low-volume athlete ————————————————
{
  const z = zones(3.2);
  const vT = thresholdMpsFromZones(z);
  const easy = easyKmhFor(vT);
  const qual = qualityKmhFor(vT);
  const p = generatePlan({ ...REQ, goalTime: "1:35:00" }, lowSeed, [], z);
  const rows = p.weeks
    .filter((w) => w.phase === "base" || w.phase === "build" || w.phase === "recovery")
    .map((w) => {
      const long = w.sessions.find((s) => s.discipline === "run" && /long/i.test(s.title));
      return long ? { w, longKm: sessionRunKm(long, easy, qual), weekKm: weekRunKm(w.sessions, easy, qual) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  chk("F1a", "plan has long-run weeks to assert on", rows.length >= 4, `${rows.length}`);
  const over = rows.filter((x) => x.longKm > LONG_FRACTION_MAX * x.weekKm + 1.5);
  chk("F1b", "every long run ≤ ~35% of that week's running km", over.length === 0,
    over.map((x) => `${x.w.weekStart} ${x.longKm.toFixed(1)}/${x.weekKm.toFixed(1)}`).join(", ") ||
      rows.slice(-3).map((x) => `${((x.longKm / x.weekKm) * 100).toFixed(0)}%`).join("/"));
}

// ——— F2. floor conflict is surfaced, never silently resolved ————————————————
{
  const p = generatePlan(REQ, lowSeed, [], zones(3.2));
  const vt = p.meta.volumeTargets;
  chk("F2a", "low-volume plan misses the 21 km floor (rail binds, no fudge)",
    vt?.meetsLongFloor === false, `${vt?.peakLongKmActual} km`);
  chk("F2b", "volumeTargets flags the fraction rail as the cause", vt?.longCappedByFraction === true);
  const copy = `${p.meta.goalGap?.message ?? ""}`;
  chk("F2c", "the goal-gap copy states the tradeoff (volume can't yet support the floor)",
    /can't yet support|cannot yet support/.test(copy) && /long run/i.test(copy),
    copy.slice(0, 140) || "no goalGap message");
}

// ——— F3. an established athlete is untouched by the rail ————————————————————
{
  const z = zones(3.6);
  const p = generatePlan({ ...REQ, goalTime: "1:35:00" }, highSeed, [], z);
  const vt = p.meta.volumeTargets;
  chk("F3a", "high-volume plan still meets the 21 km long-run floor",
    vt?.meetsLongFloor === true, `${vt?.peakLongKmActual} km of ${vt?.peakWeeklyKmActual}/wk`);
  chk("F3b", "…and is not flagged fraction-capped", vt?.longCappedByFraction !== true);
}

for (const p of passes) console.log(p);
for (const f of failures) console.error(f);
console.log(`\n${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
