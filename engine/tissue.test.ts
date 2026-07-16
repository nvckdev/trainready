import { generatePlan, type Plan, type PlanRequest } from "./plan.ts";
import { deriveZones } from "./zones.ts";
import type { AthleteState } from "./types.ts";
import {
  activeTissueCaps,
  declareTissue,
  deriveTissueCaps,
  tissueReason,
  tissueReasons,
  type TissueConstraint,
} from "./tissue.ts";
import { peakLongKm } from "./goal.ts";

/**
 * Tissue-constraint tests (feature 4). tsx script; exit code = failure count.
 * No corpus needed — a synthetic seed drives the real generatePlan (mirrors
 * src/components/app/workout-structure.test.ts), so this is deterministic.
 *
 * The linchpin (TT7): a healthy athlete's plan is BYTE-IDENTICAL whether the
 * constraint field is absent, [], or resolves to no caps. Caps apply ONLY when
 * a real constraint is present — never prophylactically (Fokkema: no volume↔injury link).
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

// ——— TT1. derived caps cap only what the provocation justifies ——————————
{
  const calf = deriveTissueCaps("tendinopathy", "rotation");
  check("TT1a", "calf tendinopathy (rotation) caps the long run ~24 km", calf.longRunKm === 24, JSON.stringify(calf));
  check("TT1b", "…and leaves weekly km / intensity / ramp UNCAPPED (targeted, minimal)",
    calf.weeklyKm === undefined && calf.maxSessionIntensity === undefined && calf.rampCeiling === undefined);
  const vol = deriveTissueCaps("tendinopathy", "volume");
  check("TT1c", "a volume-provoked tissue caps weekly km", vol.weeklyKm != null && vol.weeklyKm > 0, JSON.stringify(vol));
  const speed = deriveTissueCaps("acute", "speed");
  check("TT1d", "an acute speed-provoked tissue caps intensity + holds the ramp",
    speed.maxSessionIntensity === "easy" && speed.rampCeiling === 1.05, JSON.stringify(speed));
}

// ——— TT2. resolver returns the tightest of each lever; null when none ————
{
  check("TT2a", "no constraints ⇒ null (the byte-identity linchpin)", activeTissueCaps([]) === null && activeTissueCaps(undefined) === null);
  const merged = activeTissueCaps([
    declareTissue("calf", "tendinopathy", "rotation"), // longRunKm 24
    declareTissue("shin", "acute", "impact"), // longRunKm 14
  ]);
  check("TT2b", "two constraints ⇒ tightest long-run cap wins (min 14)", merged?.longRunKm === 14, JSON.stringify(merged));
}

// ——— TT3. peakLongKm is distance-driven, capped only by a tissue cap ————
{
  check("TT3a", "HM peak long run is distance-driven (~24.3 km) with no cap", Math.abs(peakLongKm("run-half") - 21.1 * 1.15) < 1e-9, String(peakLongKm("run-half")));
  check("TT3b", "a 22 km tissue cap binds the HM long run", peakLongKm("run-half", 22) === 22);
  check("TT3c", "marathon long run frees to distance-driven ~32 km (was blanket-capped at 24)", peakLongKm("run-marathon") > 30, String(peakLongKm("run-marathon")));
}

// ——— TT4. each active constraint publishes a human "why" ————————————————
{
  const why = tissueReason(declareTissue("calf", "tendinopathy", "rotation"));
  check("TT4a", "why names the site, status, provocation and the cap", /calf/i.test(why) && /tendinopathy/i.test(why) && /24 km/.test(why), why);
  check("TT4b", "tissueReasons dedupes and is empty when healthy", tissueReasons([]).length === 0);
}

/* ——— Synthetic athlete (no corpus) — mirrors workout-structure.test.ts ——— */
const zones = deriveZones({ ftpWatts: 250, lthrBpm: 165, runThresholdSpeedMps: 3.8, swimCssMps: 1.4 });
const seed: AthleteState = {
  ctl: 42, atl: 40, tsb: 2,
  last4WeeksTss: [300, 320, 330, 340],
  trailingWeeksTss: [280, 300, 300, 320, 300, 320, 330, 340],
  last4Shares: { swim: 0.15, bike: 0.35, run: 0.5 },
  daysToNextRace: null, weeksSinceStart: 30, breakRatio: 1.05, daysSinceLastSession: 1,
};
const REQ: PlanRequest = {
  raceName: "Synthetic Half", raceDate: "2026-10-18", raceType: "run-half",
  daysPerWeek: 6, longDay: "sunday", startDate: "2026-07-13", goalTime: "1:30:00",
};
// Compare plans ignoring the wall-clock generatedAt stamp.
const stable = (p: Plan) => JSON.stringify({ ...p, meta: { ...p.meta, generatedAt: "" } });

// ——— TT5. healthy plan reports NO tissue meta ————————————————————————————
{
  const healthy = generatePlan(REQ, seed, [], zones);
  check("TT5", "no constraints ⇒ meta carries no tissue block", healthy.meta.tissue === undefined);
}

// ——— TT6. the calf constraint actually caps the long run in the plan ——————
{
  const calf = declareTissue("calf", "tendinopathy", "rotation", "active lower-calf tendon constraint (rotation-provoked)");
  const constrained = generatePlan({ ...REQ, tissueConstraints: [calf] }, seed, [], zones);
  const healthy = generatePlan(REQ, seed, [], zones);
  const longKm = (p: Plan) => Math.max(...p.weeks.flatMap((w) => w.sessions.filter((s) => /long/i.test(s.title)).map((s) => s.durationHr * 11.6)));
  check("TT6a", "constrained peak long run ≤ 24 km (the cap binds)", longKm(constrained) <= 24 + 0.3, longKm(constrained).toFixed(1));
  check("TT6b", "healthy peak long run is NOT held to the old blanket 24 km cap", longKm(healthy) >= longKm(constrained) - 1e-9);
  check("TT6c", "meta.tissue surfaces the cap + why", constrained.meta.tissue?.caps.longRunKm === 24 && (constrained.meta.tissue?.why[0] ?? "").length > 10);
}

// ——— TT8. a speed cap actually REMOVES over-cap intensity from the plan ————
{
  const speed = declareTissue("achilles", "tendinopathy", "speed"); // maxSessionIntensity = threshold
  check("TT8a", "speed provocation caps intensity at threshold", speed.caps.maxSessionIntensity === "threshold");
  const p = generatePlan({ ...REQ, tissueConstraints: [speed] }, seed, [], zones);
  const aboveCap = p.weeks
    .flatMap((w) => w.sessions)
    .filter((s) => s.discipline === "run")
    .flatMap((s) => s.workout?.blocks ?? [])
    .filter((b) => b.zone === "vo2" || b.zone === "cv"); // above the threshold cap
  check("TT8b", "no run block exceeds the threshold cap (vo2/cv sessions downgraded)", aboveCap.length === 0, `${aboveCap.length} over-cap blocks`);
  const healthyAbove = generatePlan(REQ, seed, [], zones).weeks
    .flatMap((w) => w.sessions).filter((s) => s.discipline === "run").flatMap((s) => s.workout?.blocks ?? [])
    .filter((b) => b.zone === "vo2" || b.zone === "cv");
  check("TT8c", "…and the healthy plan DID carry over-cap intensity (the cap is doing work)", healthyAbove.length > 0, `healthy ${healthyAbove.length}`);
}

// ——— TT7. LINCHPIN — byte-identical when the constraint system is inert ————
{
  const absent = generatePlan(REQ, seed, [], zones);
  const empty = generatePlan({ ...REQ, tissueConstraints: [] }, seed, [], zones);
  check("TT7a", "absent field === empty [] (byte-identical)", stable(absent) === stable(empty));
  // A constraint whose caps are all empty (a niggle with no matching lever) is
  // also inert — resolver yields no active caps ⇒ same plan.
  const inert: TissueConstraint = { site: "knee", status: "niggle", provocation: "speed", caps: {} };
  const withInert = generatePlan({ ...REQ, tissueConstraints: [inert] }, seed, [], zones);
  check("TT7b", "a constraint whose caps are all empty is inert ⇒ byte-identical",
    stable(withInert) === stable(absent) && withInert.meta.tissue === undefined);
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.log("  " + f);
console.log(`\ntissue: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
