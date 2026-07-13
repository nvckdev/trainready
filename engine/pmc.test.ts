import { existsSync, readFileSync } from "node:fs";
import { generatePlan, type Plan, type PlanRequest } from "./plan.ts";
import { deriveZones } from "./zones.ts";
import type { AthleteState } from "./types.ts";

/**
 * PMC recursion + plan-projection acceptance tests (`npm run engine:tests`).
 *
 * Same pattern as engine/invariants.ts: a tsx script whose exit code is the
 * number of failures. The recursion vectors are hand-verified against the
 * closed form of the TrainingPeaks convention this repo is validated on
 * (CTL τ=42, ATL τ=7, same-day impulse, TSB = yesterday's CTL−ATL — see
 * taper-rules rule 6; the constants are physiology, never tuned).
 *
 * Closed form used as the independent reference: holding daily load L for
 * n days from x₀ with time constant τ gives
 *   xₙ = L + (x₀ − L)·k^n,  k = (τ−1)/τ
 * which is exactly the fixed point of x' = x + (L − x)/τ.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const kCtl = 41 / 42;
const kAtl = 6 / 7;
const closed = (x0: number, load: number, days: number, k: number) =>
  load + (x0 - load) * Math.pow(k, days);

/** The exact day-step recursion plan.ts and pipeline/lib/derive.ts use. */
function stepWeek(ctl: number, atl: number, dailyTss: number[]): { ctl: number; atl: number } {
  for (const tss of dailyTss) {
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
  }
  return { ctl, atl };
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ——— T1: steady week at maintenance load (7 × 21.43 from CTL 21 / ATL 21) ———
{
  const { ctl, atl } = stepWeek(21, 21, Array(7).fill(21.43));
  const ctlRef = closed(21, 21.43, 7, kCtl); // 21.067
  const atlRef = closed(21, 21.43, 7, kAtl); // 21.284
  const tsb = ctl - atl; // next-morning TSB: yesterday's CTL−ATL ≈ −0.22
  check("T1a", "steady week: recursion matches closed form (CTL)", near(ctl, ctlRef, 1e-9), `ctl ${ctl.toFixed(4)}`);
  check("T1b", "steady week: recursion matches closed form (ATL)", near(atl, atlRef, 1e-9), `atl ${atl.toFixed(4)}`);
  check("T1c", "steady week: CTL ≈ 21.0, ATL ≈ 21.2, TSB ≈ −0.2 (±0.5)",
    near(ctl, 21.0, 0.5) && near(atl, 21.2, 0.5) && near(tsb, -0.2, 0.5),
    `ctl ${ctl.toFixed(2)} atl ${atl.toFixed(2)} tsb ${tsb.toFixed(2)}`);
}

// ——— T2: single 150-TSS day then six zeros ———
{
  const dayOne = stepWeek(21, 21, [150]);
  check("T2a", "150-TSS day: CTL impulse = 21 + 129/42", near(dayOne.ctl, 21 + 129 / 42, 1e-9), `ctl ${dayOne.ctl.toFixed(4)}`);
  check("T2b", "150-TSS day: ATL impulse = 21 + 129/7", near(dayOne.atl, 21 + 129 / 7, 1e-9), `atl ${dayOne.atl.toFixed(4)}`);
  const { ctl, atl } = stepWeek(21, 21, [150, 0, 0, 0, 0, 0, 0]);
  const ctlRef = closed(dayOne.ctl, 0, 6, kCtl); // 20.831
  const atlRef = closed(dayOne.atl, 0, 6, kAtl); // 15.636
  check("T2c", "then 6 zeros: end values match closed-form decay",
    near(ctl, ctlRef, 1e-9) && near(atl, atlRef, 1e-9),
    `ctl ${ctl.toFixed(3)} atl ${atl.toFixed(3)}`);
  check("T2d", "fatigue sheds faster than fitness (ATL below CTL by week's end)", atl < ctl,
    `tsb ${(ctl - atl).toFixed(2)}`);
}

// ——— T3: zero-load week decay ———
// NOTE: the work order quoted CTL 21→18.4 / ATL 21→7.6 (±0.3); those constants
// are unattainable under τ=42/7 with ANY day-step or exponential convention
// (they back out to τ≈53 and τ≈6.6). Rule 6 pins the taus as physiology, so
// this vector asserts the true values of the validated recursion instead:
// CTL 21·(41/42)⁷ = 17.740, ATL 21·(6/7)⁷ = 7.138.
{
  const { ctl, atl } = stepWeek(21, 21, Array(7).fill(0));
  check("T3a", "zero week: CTL decays 21 → 17.74 (±0.3)", near(ctl, 21 * Math.pow(kCtl, 7), 1e-9) && near(ctl, 17.74, 0.3), `ctl ${ctl.toFixed(3)}`);
  check("T3b", "zero week: ATL decays 21 → 7.14 (±0.3)", near(atl, 21 * Math.pow(kAtl, 7), 1e-9) && near(atl, 7.14, 0.3), `atl ${atl.toFixed(3)}`);
}

// ——— T4: plan.ts weeks[].projected is the END-of-week state ———
// Uses the real corpus (state + full history → learned layer live, week 1
// target 150) when present, otherwise a synthetic athlete mirroring the
// audited case. Either way: replay the emitted sessions through the same
// recursion and demand each week's stored projection equals the simulated
// end-of-week state — NOT the untouched start-of-week snapshot.

function loadFixture(): {
  state: AthleteState;
  history: Array<{ state: AthleteState; actualTss: number; weekStart?: string }>;
  zones: ReturnType<typeof deriveZones>;
  corpus: boolean;
} {
  if (existsSync("data/datasets/weekly-examples.jsonl")) {
    const a = JSON.parse(readFileSync("data/raw/athlete.json", "utf8"));
    const lines = readFileSync("data/datasets/weekly-examples.jsonl", "utf8").split("\n").filter(Boolean);
    const history = lines.map((l) => {
      const ex = JSON.parse(l);
      return { state: ex.features as AthleteState, actualTss: ex.targets.weekTss as number, weekStart: ex.weekStart as string };
    });
    return {
      state: history[history.length - 1].state,
      history,
      zones: deriveZones({
        ftpWatts: a.thresholds.ftpWatts,
        lthrBpm: a.thresholds.lthrBpm,
        runThresholdSpeedMps: a.thresholds.runThresholdSpeedMpsAlt ?? a.thresholds.runThresholdSpeedMps,
        swimCssMps: a.thresholds.swimCssMps,
      }),
      corpus: true,
    };
  }
  return {
    state: {
      ctl: 22.12, atl: 32.55, tsb: -10.43,
      last4WeeksTss: [44.93, 44.7, 74.86, 334.29],
      last4Shares: { swim: 0.05, bike: 0.25, run: 0.7 },
      daysToNextRace: null, weeksSinceStart: 180, breakRatio: 1.64, daysSinceLastSession: 1,
    },
    history: [],
    zones: deriveZones({ ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: 4.0, swimCssMps: 1.1 }),
    corpus: false,
  };
}

const REQ: PlanRequest = {
  raceName: "Projection test race",
  raceDate: "2026-10-18",
  raceType: "run-half",
  daysPerWeek: 6,
  longDay: "sunday",
  startDate: "2026-07-13", // a Monday: every simulated session is emitted
};

const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const r1 = (n: number) => Math.round(n * 10) / 10;

{
  const { state, history, zones, corpus } = loadFixture();
  let plan: Plan | null = null;
  try {
    plan = generatePlan(REQ, state, history, zones);
  } catch (e) {
    check("T4", "projection plan generates", false, (e as Error).message);
  }
  if (plan) {
    // Independent replay: same recursion, same session TSS, week by week.
    let ctl = state.ctl;
    let atl = state.atl;
    let allMatch = true;
    let firstMiss = "";
    for (const w of plan.weeks) {
      const tssByDate = new Map(w.sessions.map((s) => [s.date, s.tss] as [string, number]));
      const wStart = Date.parse(w.weekStart + "T12:00:00Z");
      for (let d = 0; d < 7; d++) {
        const tss = tssByDate.get(iso(wStart + d * DAY)) ?? 0;
        ctl = ctl + (tss - ctl) / 42;
        atl = atl + (tss - atl) / 7;
      }
      const ok =
        near(w.projected.ctl, r1(ctl), 0.05) &&
        near(w.projected.atl, r1(atl), 0.05) &&
        near(w.projected.tsb, r1(ctl - atl), 0.05);
      if (!ok && allMatch) {
        allMatch = false;
        firstMiss = `${w.weekStart}: stored ${w.projected.ctl}/${w.projected.atl}/${w.projected.tsb}, simulated end-of-week ${r1(ctl)}/${r1(atl)}/${r1(ctl - atl)}`;
      }
    }
    check("T4a", "every weeks[].projected equals the simulated END-of-week PMC state", allMatch, firstMiss);

    const w1 = plan.weeks[0];
    const seedTsb = r1(state.ctl - state.atl); // corpus: 22.12−32.55 → −10.4
    check(
      "T4b",
      `week 1 (target ${w1.targetTss}${corpus ? ", corpus" : ", synthetic"}) does not echo the untouched seed TSB ${seedTsb}`,
      w1.targetTss > 0 && w1.projected.tsb !== seedTsb,
      `projected tsb ${w1.projected.tsb}`
    );
    if (corpus) {
      check("T4c", "corpus week-1 fed target 150 must NOT output tsb −10.4",
        !(w1.targetTss === 150 && w1.projected.tsb === -10.4),
        `target ${w1.targetTss}, tsb ${w1.projected.tsb}`);
    }
    check("T4d", "race-morning TSB capture unaffected (fresh band [0, +20])",
      plan.meta.projectedRaceTsb >= 0 && plan.meta.projectedRaceTsb <= 20,
      `TSB ${plan.meta.projectedRaceTsb}`);
  }
}

// ——— T5: maxSessions caps training sessions and redistributes volume ———
{
  const { state, history, zones } = loadFixture();
  const stripGeneratedAt = (p: Plan) =>
    JSON.stringify({ ...p, meta: { ...p.meta, generatedAt: "-" } });
  try {
    const dflt = generatePlan(REQ, state, history, zones);
    const four = generatePlan({ ...REQ, maxSessions: 4 }, state, history, zones);
    const training = (w: Plan["weeks"][number]) => w.sessions.filter((s) => s.discipline !== "race");
    check("T5a", "default maxSessions=5: no week exceeds 5 training sessions (race exempt)",
      dflt.weeks.every((w) => training(w).length <= 5),
      `worst ${Math.max(...dflt.weeks.map((w) => training(w).length))}`);
    check("T5b", "maxSessions=4: no week exceeds 4 training sessions",
      four.weeks.every((w) => training(w).length <= 4),
      `worst ${Math.max(...four.weeks.map((w) => training(w).length))}`);
    // Dropped-slot volume redistributes: the weekly total survives the cap
    // (within per-session rounding). Only week 1 is compared — both plans
    // prescribe it from the identical seed state; later weeks legitimately
    // diverge because different daily load distributions evolve slightly
    // different simulated CTL/ATL, which feed back into the learned layer.
    const drift = Math.abs(dflt.weeks[0].targetTss - four.weeks[0].targetTss);
    check("T5c", "week-1 volume survives the session cap (±3 rounding)", drift <= 3, `${dflt.weeks[0].targetTss} vs ${four.weeks[0].targetTss}`);
    const fullWeeks = four.weeks.slice(0, -1).filter((w) => w.phase !== "taper" && w.phase !== "race");
    check("T5d", "long session still carries the largest share under the cap",
      fullWeeks.every((w) => {
        const t = training(w);
        const long = t.filter((s) => s.title.toLowerCase().includes("long"));
        return long.length === 0 || long.some((s) => s.tss === Math.max(...t.map((x) => x.tss)));
      }));
    const keys = four.weeks.flatMap((w) => w.sessions).map((s) => s.date + "␟" + s.title);
    check("T5e", "(date,title) unique under maxSessions", new Set(keys).size === keys.length);

    // ——— T6: anchor-v2 flag ———
    const offExplicit = generatePlan({ ...REQ, anchorV2: false }, state, history, zones);
    check("T6a", "anchorV2:false is byte-identical to the flag left unset",
      stripGeneratedAt(dflt) === stripGeneratedAt(offExplicit));
    const on = generatePlan({ ...REQ, anchorV2: true }, state, history, zones);
    // Rule 2 (protocol lock): with the flag ON the taper still tapers off the
    // (possibly different) upstream load and race morning still lands fresh.
    // Absolute taper TSS may differ — it is a fraction of trailing load, and
    // anchor-v2 changes the load the taper trails.
    const onPeak = Math.max(...on.weeks.filter((w) => w.phase !== "taper" && w.phase !== "race").map((w) => w.targetTss));
    check("T6b", "anchorV2:true keeps the taper protocol (taper weeks below peak, race TSB fresh)",
      on.weeks.filter((w) => w.phase === "taper").every((w) => w.targetTss < onPeak) &&
        on.meta.projectedRaceTsb >= 0 && on.meta.projectedRaceTsb <= 20,
      `race TSB ${on.meta.projectedRaceTsb}`);
    check("T6c", "anchorV2:true respects the weekly floor 60 on full weeks",
      on.weeks.slice(0, -1).every((w) => w.targetTss >= 60),
      `min ${Math.min(...on.weeks.slice(0, -1).map((w) => w.targetTss))}`);
    // Ceiling: week 1 target may not exceed the anchor (max of maintenance
    // CTL×7 and decayed recent peak, capped at +20% over the previous
    // non-zero week), up to per-session rounding.
    const weeks4 = state.last4WeeksTss;
    const peak = Math.max(...weeks4.map((v, i) => v * Math.pow(0.95, weeks4.length - 1 - i)));
    const prevNonZero = [...weeks4].reverse().find((v) => v > 0) ?? 0;
    const anchor = Math.min(Math.max(state.ctl * 7, peak), prevNonZero * 1.2);
    check("T6d", "anchorV2:true week-1 target ≤ anchor ceiling (+rounding)",
      on.weeks[0].targetTss <= Math.max(60, anchor) + 3,
      `target ${on.weeks[0].targetTss}, anchor ${anchor.toFixed(1)}`);
  } catch (e) {
    check("T5/T6", "flagged-path plans generate", false, (e as Error).message);
  }
}

console.log(`\nPMC + projection tests (${existsSync("data") ? "real corpus" : "synthetic"})\n`);
for (const l of [...passes, ...failures].sort()) console.log("  " + l);
console.log(`\n${passes.length} pass, ${failures.length} fail`);
process.exit(failures.length);
