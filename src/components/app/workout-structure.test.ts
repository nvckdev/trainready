/**
 * workout-structure renderer — totals prop test (`tsx` harness, exit code =
 * failure count, same shape as engine/goal.test.ts).
 *
 * Drives the REAL generator (engine/plan.ts generatePlan) with a synthetic
 * seed + empty history + synthetic zones — no corpus, so it is deterministic
 * on the CI/corpus-less path. For every freshly generated session that carries
 * a `workout` structure, it asserts the totals `computeTotals` derives from the
 * blocks match the session's engine-stored `tss` and `durationHr` within a
 * documented tolerance. This is the contract that lets the renderer show
 * structure-derived numbers next to the engine's without them disagreeing.
 *
 * Also a few unit checks on computeTotals with hand-built structures (graceful
 * degradation, distance inference, time-at-intensity).
 */
import { generatePlan, type PlanRequest } from "../../../engine/plan.ts";
import { deriveZones } from "../../../engine/zones.ts";
import type { AthleteState, WorkoutStructure } from "../../../engine/types.ts";
import { computeTotals, timelineSegments } from "./workout-structure.tsx";
import { addRepToMain, mainRepGroupIndex, trimMainByThird } from "../../lib/week-insights.ts";

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

/* ——— Tolerances (per discipline — see note below) ————————————————
 * RUN templates encode every block's time AND pace numerically, so the
 * structure fully reconstructs the session: duration and the TSS estimate
 * (Σ block-time · zoneIF² · 100) both land within a physiological band of the
 * engine's stored numbers. The band is abs-OR-rel because the engine's stored
 * `durationHr` is MOVING time (tss ÷ IF²) while the structure sums ELAPSED time
 * — short interval sessions (race-week VO2/tempo) carry inter-rep recovery and
 * a 4-rep floor the engine's moving-time estimate never counts, so their
 * derived elapsed time runs a few minutes long (arguably more accurate). The
 * renderer shows the engine's `stored` number regardless; this check only
 * guards the derived value against gross bugs.
 *
 * BIKE templates use FIXED block durations (hardcoded warmups/cooldowns, a
 * fixed rep count) and — for the long ride — emit an OPTIONAL mid-ride tempo
 * surge ("if legs agree") ADDITIVELY, which the engine never prices into stored
 * moving-time/TSS. Structure-derived bike totals are therefore directional and
 * legitimately EXCEED stored (by up to ~the optional surge's ~48 TSS); a wide
 * band only guards against gross bugs. SWIM templates are distance-defined with
 * the pace in prose (`effortNote`), so neither time nor TSS is numerically
 * derivable; the structure yields distance only. For bike/swim the renderer
 * shows the engine's stored numbers (the component's `stored` prop), and the
 * timeline is proportional, so no wrong absolute number is ever displayed. */
const RUN_DUR_TOL_MIN = 8; // minutes, OR…
const RUN_DUR_REL_TOL = 0.2; // …within 20% (short interval sessions run elapsed-long)
const RUN_TSS_ABS_TOL = 14; // TSS, or…
const RUN_TSS_REL_TOL = 0.2; // …within 20%
const BIKE_TOL_REL = 0.8; // bike structure is directional only (optional long-ride surge)

/* ——— Synthetic athlete (no corpus) ————————————————————————————— */
const zones = deriveZones({
  ftpWatts: 250,
  lthrBpm: 165,
  runThresholdSpeedMps: 3.8, // ~4:23/km threshold
  swimCssMps: 1.4,
});

const seed: AthleteState = {
  ctl: 42,
  atl: 40,
  tsb: 2,
  last4WeeksTss: [300, 320, 330, 340],
  trailingWeeksTss: [280, 300, 300, 320, 300, 320, 330, 340],
  last4Shares: { swim: 0.15, bike: 0.35, run: 0.5 },
  daysToNextRace: null,
  weeksSinceStart: 30,
  breakRatio: 1.05,
  daysSinceLastSession: 1,
};

/* A run-goal half plan (exercises run-easy/strides/long/tempo/vo2) and a
 * tri plan (exercises bike + swim templates) to cover every session kind. */
function planFor(req: PlanRequest) {
  return generatePlan(req, seed, [], zones);
}

const RUN_REQ: PlanRequest = {
  raceName: "Synthetic Half",
  raceDate: "2026-10-18",
  raceType: "run-half",
  daysPerWeek: 6,
  longDay: "sunday",
  startDate: "2026-07-13",
  goalTime: "1:30:00",
};

const TRI_REQ: PlanRequest = {
  raceName: "Synthetic Olympic",
  raceDate: "2026-10-18",
  raceType: "olympic",
  daysPerWeek: 6,
  longDay: "saturday",
  startDate: "2026-07-13",
};

/* ——— Prop test over every generated session with a structure ——————— */
let total = 0;
let runChecked = 0;
let runDurOk = 0;
let runTssOk = 0;
let bikeChecked = 0;
let bikeOk = 0;
let swimChecked = 0;
let swimOk = 0;
const badRunDur: string[] = [];
const badRunTss: string[] = [];
const badBike: string[] = [];
const badSwim: string[] = [];
const kindsSeen = new Set<string>();

for (const req of [RUN_REQ, TRI_REQ]) {
  const plan = planFor(req);
  for (const wk of plan.weeks) {
    for (const s of wk.sessions) {
      if (!s.workout || s.workout.blocks.length === 0) continue;
      if (s.discipline === "race") continue; // prose-only race block: no size/pace
      kindsSeen.add(s.title.replace(/[\d.]+/g, "").trim());
      total++;
      const t = computeTotals(s.workout);
      const storedSec = s.durationHr * 3600;

      if (s.discipline === "run") {
        // Full numeric structure → tight reconstruction of BOTH totals.
        runChecked++;
        const diffMin = t.durationSec == null ? Infinity : Math.abs(t.durationSec - storedSec) / 60;
        const durRel = t.durationSec == null ? Infinity : Math.abs(t.durationSec - storedSec) / Math.max(1, storedSec);
        if (diffMin <= RUN_DUR_TOL_MIN || durRel <= RUN_DUR_REL_TOL) runDurOk++;
        else badRunDur.push(`${s.title}: der ${((t.durationSec ?? 0) / 60).toFixed(0)}m vs ${(storedSec / 60).toFixed(0)}m`);
        const d = Math.abs(t.tss - s.tss);
        if (d <= RUN_TSS_ABS_TOL || d <= RUN_TSS_REL_TOL * s.tss) runTssOk++;
        else badRunTss.push(`${s.title}: der ${t.tss} vs ${s.tss}`);
      } else if (s.discipline === "bike") {
        // Directional only (fixed/additive block durations): wide band.
        bikeChecked++;
        const durRel = t.durationSec == null ? 1 : Math.abs(t.durationSec - storedSec) / storedSec;
        const tssRel = Math.abs(t.tss - s.tss) / Math.max(1, s.tss);
        if (durRel <= BIKE_TOL_REL && tssRel <= BIKE_TOL_REL) bikeOk++;
        else badBike.push(`${s.title}: dur ${(durRel * 100).toFixed(0)}% tss ${(tssRel * 100).toFixed(0)}%`);
      } else if (s.discipline === "swim") {
        // Distance-defined, pace in prose: only distance is derivable.
        swimChecked++;
        if (t.durationSec === null && (t.distanceM ?? 0) > 0) swimOk++;
        else badSwim.push(`${s.title}: dur ${t.durationSec} dist ${t.distanceM}`);
      }
    }
  }
}

check("T1", "generated sessions with a structure were found", total > 0, `${total} sessions, kinds: ${[...kindsSeen].join(", ")}`);
check(
  "T2",
  `RUN derived duration within ±${RUN_DUR_TOL_MIN} min or ${Math.round(RUN_DUR_REL_TOL * 100)}% of stored durationHr`,
  runChecked > 0 && runDurOk === runChecked,
  `${runDurOk}/${runChecked}${badRunDur.length ? " — " + badRunDur.slice(0, 4).join(" | ") : ""}`,
);
check(
  "T3",
  `RUN derived TSS within ±${RUN_TSS_ABS_TOL} or ${Math.round(RUN_TSS_REL_TOL * 100)}% of stored tss`,
  runChecked > 0 && runTssOk === runChecked,
  `${runTssOk}/${runChecked}${badRunTss.length ? " — " + badRunTss.slice(0, 4).join(" | ") : ""}`,
);
check(
  "T4",
  `BIKE derived totals directionally track stored (±${Math.round(BIKE_TOL_REL * 100)}%)`,
  bikeChecked > 0 && bikeOk === bikeChecked,
  `${bikeOk}/${bikeChecked}${badBike.length ? " — " + badBike.slice(0, 4).join(" | ") : ""}`,
);
check(
  "T5",
  "SWIM (distance-defined) yields distance, no spurious duration",
  swimChecked > 0 && swimOk === swimChecked,
  `${swimOk}/${swimChecked}${badSwim.length ? " — " + badSwim.slice(0, 4).join(" | ") : ""}`,
);

/* ——— Unit checks on computeTotals ————————————————————————————— */
// Run tempo-ish: warmup easy + 3×5min tempo (2min rec) + cooldown easy.
const tempo: WorkoutStructure = {
  blocks: [
    { kind: "warmup", zone: "easy", durationSec: 600, paceMinSecPerKm: 300, paceMaxSecPerKm: 320 },
    { kind: "main", zone: "tempo", reps: 3, durationSec: 300, paceMinSecPerKm: 250, paceMaxSecPerKm: 260, recoverySec: 120, recoveryNote: "easy" },
    { kind: "cooldown", zone: "easy", durationSec: 300, paceMinSecPerKm: 300, paceMaxSecPerKm: 320 },
  ],
};
{
  const t = computeTotals(tempo);
  // work 600 + 3*300 + 300 = 1800; recovery 2*120 = 240 → 2040s
  check("U1", "duration = work + between-rep recovery", t.durationSec === 2040, `${t.durationSec}`);
  // time-at-intensity = only the tempo work = 900s
  check("U2", "time-at-intensity = non-easy work only", t.timeAtIntensitySec === 900, `${t.timeAtIntensitySec}`);
  // distance inferred from pace → estimated flag set, positive
  check("U3", "distance inferred from pace (estimated)", t.distanceEstimated && (t.distanceM ?? 0) > 0, `${t.distanceM}`);
}

// Bike watts: sized but no pace, no distanceM → distance indeterminate → null.
const bike: WorkoutStructure = {
  blocks: [
    { kind: "warmup", zone: "easy", durationSec: 600, effortNote: "ramp" },
    { kind: "main", zone: "threshold", reps: 3, durationSec: 720, recoverySec: 300, recoveryNote: "easy", effortNote: "@ 240W" },
    { kind: "cooldown", zone: "recovery", durationSec: 480, effortNote: "spin" },
  ],
};
{
  const t = computeTotals(bike);
  check("U4", "bike (watts, no pace) → distance null, duration present", t.distanceM === null && t.durationSec === 600 + 3 * 720 + 2 * 300 + 480, `${t.distanceM}/${t.durationSec}`);
}

// Swim: distance-defined, no durationSec → duration null, distance explicit (not estimated).
const swim: WorkoutStructure = {
  blocks: [
    { kind: "warmup", zone: "easy", distanceM: 400 },
    { kind: "main", zone: "cv", reps: 10, distanceM: 100, recoverySec: 20, recoveryNote: "rest" },
    { kind: "cooldown", zone: "recovery", distanceM: 200 },
  ],
};
{
  const t = computeTotals(swim);
  check("U5", "swim → duration null, distance = 400+1000+200 explicit", t.durationSec === null && t.distanceM === 1600 && !t.distanceEstimated, `${t.durationSec}/${t.distanceM}`);
}

// Graceful degradation: empty / missing structure never throws.
{
  const t = computeTotals({ blocks: [] });
  check("U6", "empty structure → all-zero/null, no throw", t.durationSec === null && t.distanceM === null && t.tss === 0, "");
  const t2 = computeTotals(undefined);
  check("U7", "undefined structure → safe zero", t2.tss === 0 && t2.timeAtIntensitySec === 0, "");
}

// A block missing every optional field still counts structurally (no NaN).
{
  const t = computeTotals({ blocks: [{ kind: "main", zone: "easy" }] });
  check("U8", "block with no size → no NaN, zero totals", t.tss === 0 && t.durationSec === null && !Number.isNaN(t.tss), "");
}

// Strides run regression: an undistanceable strides sub-block (durationSec, no
// pace/distance) must NOT erase the pace-derived distance of the easy segment.
// Before the fix this whole session's distance rendered as nothing.
const strides: WorkoutStructure = {
  blocks: [
    { kind: "segment", zone: "easy", durationSec: 45 * 60, paceMinSecPerKm: 300, paceMaxSecPerKm: 330 },
    { kind: "strides", zone: "vo2", reps: 5, durationSec: 20, recoveryNote: "full recovery" },
  ],
};
{
  const t = computeTotals(strides);
  check(
    "U9",
    "strides sub-block (no pace/dist) does not erase the easy segment's distance",
    (t.distanceM ?? 0) > 0 && t.distanceEstimated,
    `dist ${t.distanceM} est ${t.distanceEstimated}`,
  );
}

// Distance-defined hard session (swim CSS: CV + VO2 sets) → durationSec is null.
// This is the gate the renderer keys on: it must OMIT the "At intensity" total
// (never show a false "0s") precisely because time-at-intensity is 0 here even
// though the session is full of hard work. Asserting the gate condition guards
// the displayed value the earlier tests never checked.
const cssSwim: WorkoutStructure = {
  blocks: [
    { kind: "warmup", zone: "easy", distanceM: 400 },
    { kind: "main", zone: "cv", reps: 10, distanceM: 100, recoverySec: 20, recoveryNote: "rest" },
    { kind: "main", zone: "vo2", reps: 4, distanceM: 50, recoverySec: 30 },
    { kind: "cooldown", zone: "recovery", distanceM: 200 },
  ],
};
{
  const t = computeTotals(cssSwim);
  check(
    "U10",
    "distance-defined hard swim → durationSec null (renderer omits At-intensity, no false 0s)",
    t.durationSec === null && t.timeAtIntensitySec === 0 && (t.distanceM ?? 0) === 1800,
    `dur ${t.durationSec} atI ${t.timeAtIntensitySec} dist ${t.distanceM}`,
  );
}

// Race / prose-only block (no duration, no distance) still gets a proportional
// timeline presence: a single full-width zone-colored bar rather than nothing.
{
  const raceSegs = timelineSegments([{ kind: "segment", zone: "race", effortNote: "Race day." }]);
  check(
    "U11",
    "prose-only race block yields one full-width race timeline segment",
    raceSegs.segs.length === 1 && raceSegs.segs[0].zone === "race" && raceSegs.segs[0].weight > 0,
    `${raceSegs.segs.length} segs`,
  );
  // And a sized session is unaffected — no spurious unit bars.
  const sized = timelineSegments(strides.blocks);
  check("U12", "sized session timeline unaffected by the sizeless fallback", sized.segs.length >= 2, `${sized.segs.length} segs`);
}

/* ——— Adjustment sync: block-level "trim by a third" ———————————————
 * The feeling-based adjustments (add a rep / trim by a third / convert to easy)
 * must mutate the STRUCTURED workout, not the text, so the visual renderer
 * updates to match. Here: trimming a real threshold-reps session (pulled from
 * the actual generator) drops the main rep count, and add-a-rep grows it — both
 * immutably (the source structure is untouched). */
{
  const triPlan = planFor(TRI_REQ);
  const thr = triPlan.weeks
    .flatMap((w) => w.sessions)
    .find(
      (s) =>
        s.title === "Threshold intervals" &&
        !!s.workout &&
        mainRepGroupIndex(s.workout) !== null &&
        (s.workout.blocks[mainRepGroupIndex(s.workout)!].reps ?? 1) > 1,
    );
  check("A0", "a generated threshold-reps session with a main rep group exists", !!thr, thr ? thr.title : "none found");
  if (thr && thr.workout) {
    const idx = mainRepGroupIndex(thr.workout)!;
    const before = thr.workout.blocks[idx].reps ?? 1;
    const trimmed = trimMainByThird(thr.workout);
    const after = trimmed.blocks[idx].reps ?? 1;
    const expected = Math.max(1, Math.round(before * (2 / 3)));
    check(
      "A1",
      "trim by a third reduces the main rep count",
      after === expected && after < before,
      `${before} → ${after} (expected ${expected})`,
    );
    check(
      "A2",
      "trim is immutable — the source structure is untouched",
      (thr.workout.blocks[idx].reps ?? 1) === before,
      `source still ${thr.workout.blocks[idx].reps}`,
    );
    const grown = addRepToMain(thr.workout);
    check(
      "A3",
      "add a rep grows the main rep count by one",
      (grown.blocks[idx].reps ?? 1) === before + 1,
      `${before} → ${grown.blocks[idx].reps}`,
    );
  }
}

/* ——— Report ————————————————————————————————————————————————— */
for (const p of passes) console.log("  " + p);
for (const f of failures) console.log("  " + f);
console.log(`\nworkout-structure: ${passes.length} passed, ${failures.length} failed (${total} sessions swept)`);
process.exit(failures.length);
