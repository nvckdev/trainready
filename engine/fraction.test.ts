import { generatePlan, type PlanRequest } from "./plan.ts";
import { deriveZones, thresholdMpsFromZones } from "./zones.ts";
import type { AthleteState } from "./types.ts";
import { easyKmhFor, qualityKmhFor, LONG_FRACTION_MAX } from "./goal.ts";
import { weekRunKm, sessionRunKm } from "./volume.ts";
import { declareTissue } from "./tissue.ts";

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
// Boundary athlete: ~58 km peak-long week, where a 21 km long run IS 36% —
// the rail and the ≥21 km evidence floor genuinely conflict here, and the
// plan must pick the rail and SAY so. (This fixture used to stand in for
// "established, untouched"; it only passed while the rail was computed
// against pre-redistribution km and quietly allowed ~36%.)
const boundarySeed: AthleteState = {
  ctl: 30, atl: 28, tsb: 2,
  last4WeeksTss: [190, 200, 205, 210],
  trailingWeeksTss: [170, 180, 185, 190, 190, 200, 205, 210],
  last4Shares: { swim: 0, bike: 0, run: 1 },
  daysToNextRace: null, weeksSinceStart: 24, breakRatio: 1, daysSinceLastSession: 1,
};
// Genuinely established athlete: ~85 km peak weeks, where 35% is ~30 km —
// comfortably clear of the 21 km floor, so the rail must not bind at all.
const highSeed: AthleteState = {
  ctl: 42, atl: 40, tsb: 2,
  last4WeeksTss: [265, 270, 280, 290],
  trailingWeeksTss: [240, 250, 255, 260, 265, 270, 280, 290],
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

// ——— F4. the rail is enforced against the REAL ruler, per week ————————————
// The rail's final word is measured with sessionRunKm/weekRunKm — the same
// functions the tests, the meta and the UI use — after the sessions exist and
// the intensity shaping has moved load around. A pre-construction model of
// that fraction is a second ruler: it cannot see the shaping, so it either
// over-tightens or (as the matrix caught) lets the realized fraction reach 39%.
{
  const z = zones(3.6);
  const vT = thresholdMpsFromZones(z);
  const easy = easyKmhFor(vT);
  const qual = qualityKmhFor(vT);
  const p = generatePlan({ ...REQ, goalTime: "1:35:00" }, boundarySeed, [], z);
  const rows = p.weeks
    .filter((w) => w.phase === "base" || w.phase === "build" || w.phase === "recovery")
    .map((w) => {
      const long = w.sessions.find((s) => s.discipline === "run" && /long/i.test(s.title));
      return long ? { w, longKm: sessionRunKm(long, easy, qual), weekKm: weekRunKm(w.sessions, easy, qual) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const worst = rows.reduce((a, x) => Math.max(a, x.longKm / x.weekKm), 0);
  chk("F4a", "no week exceeds the rail when measured the way the plan is measured",
    worst <= LONG_FRACTION_MAX + 1e-6, `worst ${(worst * 100).toFixed(1)}%`);
  const vt = p.meta.volumeTargets;
  chk("F4b", "the boundary athlete's long run is held under the 21 km floor by the rail",
    vt?.meetsLongFloor === false, `${vt?.peakLongKmActual} km`);
  chk("F4c", "…and the tradeoff is SURFACED, not silently resolved",
    vt?.longCappedByFraction === true);
}

// ——— F6. DECLARED CAPS GOVERN (the 2026-08-06 denominator decision) ————————
// The completeness critic measured the failure this pins: acute-calf volume
// caps {weeklyKm 24, longRunKm 16}, 4:30/km, CTL 45, run-half. The rail
// re-measured the week against the RUN-RUMP — the substituted days' km had
// left the denominator — and cut the 91-minute long run at its declared
// 16 km ceiling to 33 minutes, in a week whose 24 km cap was never
// approached; prevLongKm then fed 5.9 km into next week's progression.
{
  const zones = deriveZones({ ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: 1000 / 270, swimCssMps: 1.1 });
  const w = 45 * 7;
  const st: AthleteState = {
    ctl: 45, atl: 45, tsb: 0, last4WeeksTss: [w, w, w, w],
    last4Shares: { swim: 0, bike: 0.1, run: 0.9 },
    daysToNextRace: null, weeksSinceStart: 30, breakRatio: 1, daysSinceLastSession: 1,
  };
  const t = declareTissue("calf", "acute", "volume");
  const plan = generatePlan(
    { raceName: "F6", raceDate: "2026-04-12", raceType: "run-half", daysPerWeek: 6, longDay: "sunday", startDate: "2026-01-05", tissueConstraints: [t] },
    st, [], zones
  );
  const vT = thresholdMpsFromZones(zones);
  const easy = easyKmhFor(vT);
  const qual = qualityKmhFor(vT);
  const cap = t.caps.longRunKm!;
  const first = plan.weeks[0];
  const firstLong = first.sessions.find((s) => s.discipline === "run" && /long/i.test(s.title))!;
  chk("F6a", `the 91-minute long run at its declared ${cap} km ceiling SURVIVES at the ceiling`,
    Math.abs(sessionRunKm(firstLong, easy, qual) - cap) < 0.1 && Math.round(firstLong.durationHr * 60) >= 88,
    `${sessionRunKm(firstLong, easy, qual).toFixed(1)} km / ${Math.round(firstLong.durationHr * 60)} min`);
  chk("F6b", "…inside a week that still honours the 24 km weekly cap",
    weekRunKm(first.sessions, easy, qual) <= t.caps.weeklyKm! + 0.05,
    `${weekRunKm(first.sessions, easy, qual).toFixed(1)} km`);

  // (d) the compounding is dead: consecutive capped build weeks HOLD — the
  // progression feeds from the governed value, so the long run never decays
  // week over week under a constant cap.
  let prevKm = -1;
  let sawtooth = "";
  let dropped = 0;
  for (const wk of plan.weeks) {
    dropped += wk.freedTssDropped ?? 0;
    if (wk.phase !== "build") continue;
    const long = wk.sessions.find((s) => s.discipline === "run" && /long/i.test(s.title));
    if (!long) continue;
    const km = sessionRunKm(long, easy, qual);
    if (prevKm > 0 && km < prevKm - 1) sawtooth = `${wk.weekStart} ${prevKm.toFixed(1)}→${km.toFixed(1)}`;
    prevKm = km;
  }
  chk("F6c", "consecutive capped build weeks hold — no week-over-week decay through prevLongKm",
    sawtooth === "", sawtooth);
  chk("F6d", "…and every build long run sits within 1 km of the declared ceiling, not the 5.9 km collapse",
    prevKm > cap - 1.05, `last build long ${prevKm.toFixed(1)} km`);
  chk("F6e", "no freed load was silently discarded anywhere in the plan (the 5692/5692 recipient hole is dead)",
    dropped === 0, `${dropped} TSS dropped`);
}

for (const p of passes) console.log(p);
for (const f of failures) console.error(f);
console.log(`\n${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
