import { generatePlan, type PlanRequest } from "./plan.ts";
import { deriveZones } from "./zones.ts";
import type { AthleteState } from "./types.ts";
import { declareTissue } from "./tissue.ts";
import { targetDistribution, weekDistribution, z1FloorFor, Z1_FLOOR } from "./intensity.ts";

/**
 * Feature-1 refinement tests: intensity distribution as a CONSTRUCTION target.
 * tsx script; exit code = failure count.
 *
 * Base/build run weeks must be BUILT to land within ±3% of the phase Z1
 * target (Muñoz 2014, rct tier: polarized beat threshold-emphasis at equal
 * load), with the floor raised to 0.85 for those phases as the safety catch.
 * Weeks that cannot hold a quality touch (tissue intensity caps) resolve to
 * MORE easy volume, never to a failed build.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const seed: AthleteState = {
  ctl: 30,
  atl: 28,
  tsb: 2,
  last4WeeksTss: [190, 200, 205, 210],
  trailingWeeksTss: [170, 180, 185, 190, 190, 200, 205, 210],
  last4Shares: { swim: 0, bike: 0, run: 1 },
  daysToNextRace: null,
  weeksSinceStart: 24,
  breakRatio: 1,
  daysSinceLastSession: 1,
};
const zones = deriveZones({ ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: 3.6, swimCssMps: 1.2 });
const REQ: PlanRequest = {
  raceName: "Polarized HM",
  raceDate: "2026-11-08",
  raceType: "run-half",
  daysPerWeek: 5,
  longDay: "sunday",
  startDate: "2026-07-20",
  goalTime: "1:35:00",
};

// ——— P1. floors ————————————————————————————————————————————————————————
{
  check("P1a", "base/build floor raised to 0.85", z1FloorFor("base") === 0.85 && z1FloorFor("build") === 0.85);
  check("P1b", "other phases keep the 0.80 floor",
    z1FloorFor("taper") === Z1_FLOOR && z1FloorFor("race") === Z1_FLOOR && z1FloorFor("recovery") === Z1_FLOOR);
}

// ——— P2. built base/build weeks land ON target, not merely above floor ——
{
  const plan = generatePlan(REQ, seed, [], zones);
  const rows = plan.weeks
    .filter((w) => w.phase === "base" || w.phase === "build")
    .map((w) => ({ w, d: weekDistribution(w.sessions), t: targetDistribution(w.phase).z1 }))
    .filter((x) => x.d.totalSec > 0);
  check("P2a", "plan has base/build weeks to assert on", rows.length >= 6, `${rows.length}`);
  const off = rows.filter((x) => Math.abs(x.d.z1Pct - x.t) > 0.03);
  check("P2b", "every base/build week within ±3% of the phase Z1 target", off.length === 0,
    off.map((x) => `${x.w.weekStart} ${x.w.phase} ${(x.d.z1Pct * 100).toFixed(1)}% vs ${x.t * 100}%`).join(", ") ||
      rows.map((x) => (x.d.z1Pct * 100).toFixed(0)).join("/"));
  const under = rows.filter((x) => x.d.z1Pct < 0.85 - 1e-9);
  check("P2c", "…and above the raised 0.85 floor", under.length === 0,
    under.map((x) => `${x.w.weekStart} ${(x.d.z1Pct * 100).toFixed(1)}%`).join(", "));
  const noQuality = rows.filter((x) => x.d.z2Sec + x.d.z3Sec <= 0);
  check("P2d", "shaping reduces quality, never annihilates it", noQuality.length === 0,
    noQuality.map((x) => x.w.weekStart).join(", "));
}

// ——— P3. shaping conserves the week and stays humane ————————————————————
{
  const plan = generatePlan(REQ, seed, [], zones);
  const all = plan.weeks.flatMap((w) => w.sessions).filter((s) => s.discipline !== "race");
  check("P3a", "every session ≥ 24 min and ≤ 2.6 h after shaping",
    all.every((s) => s.durationHr >= 0.4 - 1e-9 && s.durationHr <= 2.6 + 1e-9));
  check("P3b", "weekly target equals the sum of its sessions (accounting stays honest)",
    plan.weeks.every((w) => Math.abs(w.targetTss - w.sessions.reduce((a, s) => a + s.tss, 0)) < 0.5));
}

// ——— P4. an intensity-capped week resolves easy, never fails ————————————
{
  const capped = generatePlan(
    { ...REQ, tissueConstraints: [declareTissue("achilles", "acute", "speed")] },
    seed,
    [],
    zones
  );
  check("P4a", "an intensity-capped plan still builds", capped.weeks.length > 4);
  const rows = capped.weeks
    .filter((w) => w.phase === "base" || w.phase === "build")
    .map((w) => weekDistribution(w.sessions))
    .filter((d) => d.totalSec > 0);
  check("P4b", "capped weeks resolve to MORE easy (≥ target), never below floor",
    rows.every((d) => d.z1Pct >= 0.85 - 1e-9), rows.map((d) => (d.z1Pct * 100).toFixed(0)).join("/"));
}

for (const p of passes) console.log(p);
for (const f of failures) console.error(f);
console.log(`\n${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
