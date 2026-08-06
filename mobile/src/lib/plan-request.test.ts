import { buildGoalRequest } from "./plan-request";
import { decodeDeclarations, encodeDeclarations } from "./health-codec";
import { activeDeclarations, toConstraint } from "../../engine/tissue-declare.ts";
import { generatePlan } from "../../engine/plan.ts";
import { deriveZones, thresholdMpsFromZones } from "../../engine/zones.ts";
import { easyKmhFor, qualityKmhFor } from "../../engine/goal.ts";
import { sessionRunKm, weekRunKm } from "../../engine/volume.ts";
import type { AthleteState } from "../../engine/types.ts";

/**
 * The Goal screen's request wiring — the test the 2026-08-06 verification pass
 * found missing.
 *
 * The engine was never wrong: matrix TC1 proves a threaded constraint binds
 * its caps across 432 athletes. What failed was the REQUEST — goal.tsx's
 * inline literal threaded priorWeights but not tissueConstraints, so a
 * phone-declared injury bound nothing in any plan the Goal tab built, and an
 * unreadable declaration store generated silently where the dashboard throws.
 * An engine test cannot see either; matrix PAR passes tissueConstraints: []
 * on both sides, which only proves absent ≡ explicitly-empty.
 *
 * So this is a WIRING test: phone-stored declaration bytes → the same decode /
 * active-set / constraint pipeline the tissue store runs → buildGoalRequest →
 * generatePlan, asserting the caps the athlete was shown actually bind in the
 * produced plan, measured with the engine's own rulers.
 *
 * Runs under tsx from the repo root; imports resolve through the mobile/engine
 * symlink, like health-codec.test.ts.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const TODAY = "2026-08-06";
const zones = deriveZones({ ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: 1000 / 270, swimCssMps: 1.1 });
const w = 45 * 7;
const seed: AthleteState = {
  ctl: 45,
  atl: 45,
  tsb: 0,
  last4WeeksTss: [w, w, w, w],
  last4Shares: { swim: 0, bike: 0.1, run: 0.9 },
  daysToNextRace: null,
  weeksSinceStart: 30,
  breakRatio: 1,
  daysSinceLastSession: 1,
};

const form = {
  raceName: "Kill test race",
  raceDate: "2026-11-15",
  raceType: "run-half" as const,
  daysPerWeek: 6,
  longDay: "sunday" as const,
  today: TODAY,
  goalTime: "",
  priorWeights: undefined,
};

/** The tissue store's read pipeline, run on raw bytes — the same engine calls
 *  readTissue makes, without AsyncStorage. */
function tissueFromStorage(raw: string | null) {
  const read = decodeDeclarations(raw);
  const active = read.status === "ok" ? activeDeclarations(read.declarations, TODAY) : [];
  return { constraints: active.map(toConstraint), status: read.status, message: read.message };
}

// ——— W1. NEUTRALITY (§12): no declarations ⇒ the request carries [] and the
// plan is byte-identical to one with the field absent ————————————————————————
{
  const req = buildGoalRequest(form, tissueFromStorage(null));
  check("W1a", "an absent store threads an empty constraint list", req.tissueConstraints?.length === 0);
  const stable = (p: object) => JSON.stringify(p).replace(/"generatedAt":"[^"]*"/, '"generatedAt":"-"');
  const a = generatePlan(req, seed, [], zones);
  const b = generatePlan({ ...req, tissueConstraints: undefined }, seed, [], zones);
  check("W1b", "…and the generated plan is byte-identical to a request with the field absent",
    stable(a) === stable(b));
}

// ——— W2. the kill test: declare calf/acute/impact, generate, the caps bind —
{
  const stored = encodeDeclarations([
    { site: "calf", status: "acute", provocation: "impact", declaredOn: "2026-08-01", resolvedOn: null, note: "sharp on the first km" },
  ]);
  const tissue = tissueFromStorage(stored);
  const req = buildGoalRequest(form, tissue);
  check("W2a", "the phone declaration reaches the request",
    req.tissueConstraints?.length === 1 && req.tissueConstraints[0].site === "calf",
    JSON.stringify(req.tissueConstraints?.map((c) => c.site)));

  const capped = generatePlan(req, seed, [], zones);
  const uncapped = generatePlan({ ...req, tissueConstraints: [] }, seed, [], zones);
  // Fall back to the engine's own derivation when the threading is broken, so
  // a reverted fix FAILS W2b/W2c with a report instead of crashing the file —
  // an uncaught throw exits non-zero too, but says nothing about what broke.
  const declared = req.tissueConstraints?.[0]?.caps ?? toConstraint(activeDeclarations(decodeDeclarations(stored).declarations, TODAY)[0]).caps;
  const declaredLongCap = declared.longRunKm!;
  const declaredRamp = declared.rampCeiling!;
  const vT = thresholdMpsFromZones(zones);
  const easy = easyKmhFor(vT);
  const qual = qualityKmhFor(vT);

  // Long-run cap: every training week's long run under the declared ceiling,
  // measured with the engine's own ruler (sessionRunKm).
  let worstLong = 0;
  for (const wk of capped.weeks) {
    const long = wk.sessions.find((s) => s.discipline === "run" && /long/i.test(s.title));
    if (long) worstLong = Math.max(worstLong, sessionRunKm(long, easy, qual));
  }
  check("W2b", `the long-run cap binds in the produced plan (≤ ${declaredLongCap} km)`,
    worstLong > 0 && worstLong <= declaredLongCap + 0.05, `worst ${worstLong.toFixed(1)} km`);

  // Ramp cap: week-over-week base/build growth held to the declared ceiling
  // (+2 TSS for integer rounding, the matrix TC1 allowance).
  const bb = capped.weeks.filter((x) => x.phase === "base" || x.phase === "build");
  let rampOk = true;
  let worstRamp = "";
  for (let i = 1; i < bb.length; i++) {
    if (bb[i - 1].targetTss >= 60 && bb[i].targetTss > bb[i - 1].targetTss * declaredRamp + 2) {
      rampOk = false;
      worstRamp = `${bb[i - 1].targetTss}→${bb[i].targetTss}`;
    }
  }
  check("W2c", `the ramp cap binds in the produced plan (×${declaredRamp}/wk)`, rampOk, worstRamp);

  // And the plan is genuinely different from the uncapped one — the wiring
  // did something, so W2b/W2c cannot pass vacuously on a plan that never
  // approached its caps.
  const km = (p: typeof capped) =>
    p.weeks.reduce((a, x) => a + weekRunKm(x.sessions, easy, qual), 0);
  check("W2d", "the capped plan carries less running than the uncapped one (not vacuously green)",
    km(capped) < km(uncapped) - 1, `${km(capped).toFixed(0)} vs ${km(uncapped).toFixed(0)} km`);
  check("W2e", "the plan records the constraint for the cap-rationale UI",
    (capped.meta.tissue?.why.length ?? 0) > 0, JSON.stringify(capped.meta.tissue ?? null));
}

// ——— W3. an unreadable store REFUSES generation, matching the dashboard ————
{
  let threw = false;
  let msg = "";
  try {
    buildGoalRequest(form, tissueFromStorage("{not json"));
  } catch (e) {
    threw = true;
    msg = e instanceof Error ? e.message : String(e);
  }
  check("W3a", "an unreadable declaration store throws instead of generating uncapped",
    threw && /could not be read/.test(msg), msg);
  // A resolved declaration is NOT a refusal — the athlete healed.
  const healed = tissueFromStorage(
    encodeDeclarations([{ site: "calf", status: "acute", provocation: "impact", declaredOn: "2026-08-01", resolvedOn: "2026-08-03" }])
  );
  const req = buildGoalRequest(form, healed);
  check("W3b", "a resolved declaration generates uncapped without refusing",
    req.tissueConstraints?.length === 0);
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nplan-request: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
