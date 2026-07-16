import { existsSync, readFileSync } from "node:fs";
import { generatePlan, type Plan, type PlanRequest, type PlannedSessionOut } from "./plan.ts";
import { seedStateAt, type DailyPmcPoint } from "./seed.ts";
import { deriveZones } from "./zones.ts";
import type { AthleteState } from "./types.ts";
import {
  ZONE3,
  Z1_FLOOR,
  sessionZoneSeconds,
  weekDistribution,
  targetDistribution,
} from "./intensity.ts";

/**
 * Intensity-distribution tests (feature 1). tsx script; exit code = failure
 * count. Two layers:
 *   • pure-model unit tests (I1–I4) — no corpus needed;
 *   • real-plan invariants (I5–I8) — generate the calibration athlete's plan
 *     and assert the distribution floor/targets hold week by week. Skips
 *     gracefully when the corpus is absent.
 *
 * The hard invariant the request asked for: NO generated week may fall below
 * 80% Z1 by time. Base/recovery land in the elite 88–92% band; build carries
 * more quality but still clears the floor; the race week's distribution is
 * measured over its run TRAINING sessions (the race event itself is excluded).
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

// ——— I1. ZONE3 maps efforts to the right physiological zone ——————————
{
  check("I1a", "easy/recovery ⇒ Z1", ZONE3.easy === "z1" && ZONE3.recovery === "z1");
  check("I1b", "tempo ⇒ Z2 (the LT1–LT2 band)", ZONE3.tempo === "z2");
  check("I1c", "threshold/cv/vo2/race ⇒ Z3 (at/above LT2)",
    ZONE3.threshold === "z3" && ZONE3.cv === "z3" && ZONE3.vo2 === "z3" && ZONE3.race === "z3");
}

// ——— I2. sessionZoneSeconds sums time-in-zone (reps + recovery→Z1) ————
{
  // 10min easy warmup + 5×3min threshold (60s jog between) + 5min easy cooldown.
  const w = {
    blocks: [
      { kind: "warmup" as const, zone: "easy" as const, durationSec: 600 },
      { kind: "main" as const, zone: "threshold" as const, reps: 5, durationSec: 180, recoverySec: 60 },
      { kind: "cooldown" as const, zone: "recovery" as const, durationSec: 300 },
    ],
  };
  const zs = sessionZoneSeconds(w);
  // z1 = 600 warmup + 300 cooldown + 4×60 recovery jogs = 1140; z3 = 5×180 = 900.
  check("I2a", "Z1 = warmup + cooldown + between-rep recoveries", zs.z1 === 1140, `${zs.z1}`);
  check("I2b", "Z3 = reps × per-rep work (threshold)", zs.z3 === 900, `${zs.z3}`);
  check("I2c", "no Z2 in this session", zs.z2 === 0, `${zs.z2}`);
}

// ——— I3. weekDistribution counts only run TRAINING sessions ——————————
{
  const run = (zone: "easy" | "vo2", sec: number): PlannedSessionOut => ({
    date: "2026-07-14", weekday: "Tue", discipline: "run", title: "x",
    durationHr: sec / 3600, tss: 50, structure: "",
    workout: { blocks: [{ kind: "main", zone, durationSec: sec }] }, why: "",
  });
  const bike: PlannedSessionOut = {
    date: "2026-07-15", weekday: "Wed", discipline: "bike", title: "ride",
    durationHr: 1, tss: 50, structure: "",
    workout: { blocks: [{ kind: "main", zone: "vo2", durationSec: 3600 }] }, why: "",
  };
  const race: PlannedSessionOut = {
    date: "2026-07-19", weekday: "Sun", discipline: "race", title: "Half",
    durationHr: 1.5, tss: 130, structure: "",
    workout: { blocks: [{ kind: "segment", zone: "race", durationSec: 5400 }] }, why: "",
  };
  const d = weekDistribution([run("easy", 3000), run("vo2", 1000), bike, race]);
  // Only the two RUN sessions count: 3000 z1 + 1000 z3 = 4000 total.
  check("I3a", "excludes bike + race event; totals only run time", d.totalSec === 4000, `${d.totalSec}`);
  check("I3b", "z1Pct reflects run-only easy share (3000/4000)", Math.abs(d.z1Pct - 0.75) < 1e-9, d.z1Pct.toFixed(3));
  check("I3c", "distribution percentages sum to 1", Math.abs(d.z1Pct + d.z2Pct + d.z3Pct - 1) < 1e-9);
}

// ——— I4. targetDistribution encodes the elite band, never below floor ——
{
  const base = targetDistribution("base");
  const build = targetDistribution("build");
  check("I4a", "base target ≥ 88% Z1 (elite band, not folk 80/20)", base.z1 >= 0.88, `${base.z1}`);
  check("I4b", "build target ≥ 88% Z1", build.z1 >= 0.88, `${build.z1}`);
  check("I4c", "every phase target ≥ the 80% hard floor",
    (["base", "build", "taper", "race", "recovery", "offseason"] as const).every((p) => targetDistribution(p).z1 >= Z1_FLOOR));
  check("I4d", "each phase target sums to 1", (["base", "build", "taper", "race", "recovery", "offseason"] as const)
    .every((p) => { const t = targetDistribution(p); return Math.abs(t.z1 + t.z2 + t.z3 - 1) < 1e-9; }));
}

// ——— Corpus fixture (mirrors goal.test.ts / replan.test.ts) ——————————

function loadPlanFixture(): { seed: AthleteState; history: Array<{ state: AthleteState; actualTss: number; weekStart?: string }>; zones: ReturnType<typeof deriveZones> } | null {
  if (!existsSync("data/datasets/weekly-examples.jsonl") || !existsSync("data/derived/pmc.csv")) return null;
  const a = JSON.parse(readFileSync("data/raw/athlete.json", "utf8"));
  const lines = readFileSync("data/datasets/weekly-examples.jsonl", "utf8").split("\n").filter(Boolean);
  const history = lines.map((l) => {
    const ex = JSON.parse(l);
    return { state: ex.features as AthleteState, actualTss: ex.targets.weekTss as number, weekStart: ex.weekStart as string };
  });
  const base = history[history.length - 1].state;
  const [, ...pl] = readFileSync("data/derived/pmc.csv", "utf8").trim().split("\n");
  const series: DailyPmcPoint[] = pl.map((l) => {
    const [date, , ctl, atl] = l.split(",");
    return { date, ctl: +ctl, atl: +atl };
  });
  const seed = seedStateAt(base, series, "2026-07-13");
  const zones = deriveZones({
    ftpWatts: a.thresholds.ftpWatts,
    lthrBpm: a.thresholds.lthrBpm,
    runThresholdSpeedMps: a.thresholds.runThresholdSpeedMpsAlt ?? a.thresholds.runThresholdSpeedMps,
    swimCssMps: a.thresholds.swimCssMps,
  });
  return { seed, history, zones };
}

const ATHLETE_REQ: PlanRequest = {
  raceName: "Toronto Waterfront Half",
  raceDate: "2026-10-18",
  raceType: "run-half",
  daysPerWeek: 6,
  longDay: "sunday",
  startDate: "2026-07-13",
  goalTime: "1:24:00",
};

const fx = loadPlanFixture();
if (!fx) {
  console.log("  I5–I8 SKIP — corpus absent (plan distribution needs a real seed)");
} else {
  const plan: Plan = generatePlan(ATHLETE_REQ, fx.seed, fx.history, fx.zones);
  const dist = plan.weeks.map((w) => ({ phase: w.phase, d: weekDistribution(w.sessions) }))
    .filter((x) => x.d.totalSec > 0);

  // ——— I5. THE HARD FLOOR — no week below 80% Z1 by time ———————————————
  {
    const bad = dist.filter((x) => x.d.z1Pct < Z1_FLOOR - 1e-9);
    check("I5", "no generated week falls below 80% Z1 (the hard floor)", bad.length === 0,
      bad.length ? bad.map((x) => `${x.phase} ${(x.d.z1Pct * 100).toFixed(0)}%`).join(", ")
        : `min ${(Math.min(...dist.map((x) => x.d.z1Pct)) * 100).toFixed(0)}% Z1`);
  }

  // ——— I6. base & recovery weeks sit in the elite band (≥88% Z1) ————————
  {
    const acc = dist.filter((x) => x.phase === "base" || x.phase === "recovery");
    const low = acc.filter((x) => x.d.z1Pct < 0.88 - 1e-9);
    check("I6", "base/recovery weeks hold ≥88% Z1 (aerobic volume, not quality)", low.length === 0,
      low.length ? low.map((x) => `${x.phase} ${(x.d.z1Pct * 100).toFixed(0)}%`).join(", ")
        : `${acc.length} accumulation weeks, all ≥88%`);
  }

  // ——— I7. every week's percentages are a valid distribution ————————————
  {
    const bad = dist.filter((x) => Math.abs(x.d.z1Pct + x.d.z2Pct + x.d.z3Pct - 1) > 1e-6);
    check("I7", "every week's Z1+Z2+Z3 sums to 1", bad.length === 0, `${bad.length} malformed`);
  }

  // ——— I8. build weeks carry MORE hard time than accumulation weeks ————————
  {
    // Fold base + recovery into one "accumulation" cohort so the comparison
    // isn't resting on a single base week (m3); require both cohorts non-empty and
    // a real margin, not just >.
    const hard = (x: { d: { z2Pct: number; z3Pct: number } }) => x.d.z2Pct + x.d.z3Pct;
    const accum = dist.filter((x) => x.phase === "base" || x.phase === "recovery").map(hard);
    const build = dist.filter((x) => x.phase === "build").map(hard);
    const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
    check("I8", "build weeks carry meaningfully more Z2+Z3 than base/recovery weeks",
      accum.length >= 2 && build.length >= 2 && mean(build) > mean(accum) + 0.02,
      `accum n=${accum.length} ${(mean(accum) * 100).toFixed(0)}% vs build n=${build.length} ${(mean(build) * 100).toFixed(0)}% hard`);
  }
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.log("  " + f);
console.log(`\nintensity: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
