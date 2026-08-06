import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BIKE_BANDS } from "../../engine/zones.ts";

/**
 * The TrainingPeaks export's watch targets against the ENGINE's own bands —
 * the first test to exercise .claude/skills/taper-watch-export at all.
 *
 * The 2026-08-06 verification pass found the script's private zone table had
 * drifted from engine/zones.ts: a bike-z2 block exported at 72–85% FTP
 * against the engine's 62–75%, so a Zone 2 ride reached the watch ~15% too
 * hard while the same payload's description printed the correct watts. The
 * table is deleted; the script now reads engine BIKE_BANDS/RUN_BANDS, and
 * this test uses those same exports as the oracle so the two cannot drift
 * again without failing here.
 *
 * Runs the script as a subprocess against a synthetic plan (TAPER_PLAN_PATH /
 * TAPER_ATHLETE_PATH) — the wiring is what failed, so the wiring is what is
 * tested.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const dir = mkdtempSync(join(tmpdir(), "taper-export-"));
const FTP = 269;
writeFileSync(join(dir, "athlete.json"), JSON.stringify({
  thresholds: { ftpWatts: FTP, lthrBpm: 170, runThresholdSpeedMps: 1000 / 270, swimCssMps: 1.1 },
}));
writeFileSync(join(dir, "plan.json"), JSON.stringify({
  plan: {
    weeks: [{
      weekStart: "2099-01-04",
      phase: "build",
      targetTss: 300,
      sessions: [
        {
          date: "2099-01-05", weekday: "Tue", discipline: "bike", title: "Zone 2 ride 60",
          durationHr: 1, tss: 42, structure: "", why: "",
          workout: { blocks: [
            { kind: "warmup", zone: "easy", durationSec: 600 },
            { kind: "main", zone: "easy", durationSec: 2700 },
            { kind: "cooldown", zone: "recovery", durationSec: 300 },
          ] },
        },
        {
          date: "2099-01-06", weekday: "Wed", discipline: "swim", title: "CSS swim set",
          durationHr: 0.5, tss: 30, structure: "", why: "",
          workout: { blocks: [
            { kind: "warmup", zone: "easy", distanceM: 400 },
            { kind: "main", zone: "cv", reps: 10, distanceM: 100, recoverySec: 20 },
          ] },
        },
      ],
    }],
  },
}));

const raw = execFileSync("npx", ["tsx", ".claude/skills/taper-watch-export/build-payload.ts", "2099-01-04", "2099-01-10"], {
  env: { ...process.env, TAPER_PLAN_PATH: join(dir, "plan.json"), TAPER_ATHLETE_PATH: join(dir, "athlete.json") },
  encoding: "utf8",
});
const out = JSON.parse(raw) as { sessions: Array<{ sport: string; pushable: boolean; reason?: string;
  structured_workout: { primaryIntensityMetric: string; structure: Array<{ steps: Array<{ name: string; targets: Array<{ minValue: number; maxValue: number }> }> }> } }> };

// ——— X1. bike targets are the ENGINE's bands, not a transcription —————————
{
  const bike = out.sessions.find((s) => s.sport === "Bike")!;
  check("X1a", "the bike session exports", bike?.pushable === true, bike?.reason ?? "missing");
  const steps = bike.structured_workout.structure.flatMap((g) => g.steps);
  const main = steps.find((s) => !/Warm up|Cool down/.test(s.name))!;
  const [lo, hi] = [main.targets[0].minValue, main.targets[0].maxValue];
  check("X1b", "a bike-z2 MAIN block carries the engine's z2 band (62–75% FTP), not the old 72–85",
    lo === BIKE_BANDS.z2[0] * 100 && hi === BIKE_BANDS.z2[1] * 100, `${lo}–${hi}%`);
  check("X1c", "…which at FTP 269 is the watts the plan's own description states",
    Math.round((lo / 100) * FTP) === Math.round(BIKE_BANDS.z2[0] * FTP) &&
    Math.round((hi / 100) * FTP) === Math.round(BIKE_BANDS.z2[1] * FTP),
    `${Math.round((lo / 100) * FTP)}–${Math.round((hi / 100) * FTP)}W`);
  check("X1d", "bikes export as percentOfFtp",
    bike.structured_workout.primaryIntensityMetric === "percentOfFtp");
  const cool = steps.find((s) => /Cool down/.test(s.name))!;
  check("X1e", "a recovery spin is bounded ABOVE by the engine's z2 floor — it can never prescribe work",
    cool.targets[0].maxValue === BIKE_BANDS.z2[0] * 100, `max ${cool.targets[0].maxValue}%`);
}

// ——— X2. swims are refused EXPLICITLY, with the reason stated —————————————
{
  const swim = out.sessions.find((s) => s.sport === "Swim")!;
  check("X2a", "a swim is not exported", swim?.pushable === false);
  check("X2b", "…and says exactly why, rather than a generic no-blocks shrug",
    /distance-defined/.test(swim?.reason ?? ""), swim?.reason ?? "");
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nwatch-export: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
