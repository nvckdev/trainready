import { existsSync, readFileSync } from "node:fs";
import { TaperV1 } from "./learned.ts";
import { generatePlan, type Plan, type PlanRequest, type PlanWeek } from "./plan.ts";
import { seedStateAt, type DailyPmcPoint } from "./seed.ts";
import { deriveZones } from "./zones.ts";
import type { AthleteState } from "./types.ts";
import { briefForWeek, loadCopyBranch } from "../src/lib/week-insights.ts";

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

// ——— T7: plan seed == header state (single source of truth) ———
// The Today header shows CTL/ATL/TSB from the DAILY pmc series
// (data/derived/pmc.csv). generatePlan must be seeded from that same series
// rolled forward to the plan's startDate — NOT from the last WEEKLY example,
// whose features freeze at that week's Monday (observed staleness: plan
// seeded CTL 22.1 / ATL 32.6 / TSB −10.4 while the header read ≈21/21/+2.5).
//
// Closed-form reference for the roll-forward — the exact decay the athlete's
// spreadsheet got wrong. Holding daily load L for n days from CTL_0:
//   CTL_n = L + (CTL_0 − L)·(1 − 1/42)^n      (ATL identical with τ = 7)
// so across unlogged (zero-load) days, L = 0:
//   CTL_n = CTL_0·(41/42)^n,   ATL_n = ATL_0·(6/7)^n.
// The spreadsheet's week-of-rest constants (CTL 21→18.4, ATL 21→7.6) back
// out to τ ≈ 53 and τ ≈ 6.6 — wrong under the pinned physiology τ = 42/7
// (taper-rules rule 6); the true zero-week decay is 21→17.74 / 21→7.14 (T3).
// TSB keeps the TrainingPeaks convention: the form you wake into on
// startDate is end-of-(startDate−1) CTL − ATL, so the seed's ctl/atl are the
// end-of-previous-day values and seed.tsb = seed.ctl − seed.atl.

function loadPmcSeries(): DailyPmcPoint[] | null {
  if (!existsSync("data/derived/pmc.csv")) return null;
  const [, ...lines] = readFileSync("data/derived/pmc.csv", "utf8").trim().split("\n");
  return lines.map((l) => {
    const [date, , ctl, atl] = l.split(",");
    return { date, ctl: +ctl, atl: +atl };
  });
}

/** Independent reference: what the header's daily series implies for the
 * morning of `date` — last row strictly before `date`, then closed-form
 * zero-load decay across the unlogged gap up to end-of-(date−1). */
function headerStateAt(series: DailyPmcPoint[], date: string): { ctl: number; atl: number; tsb: number } | null {
  let last: DailyPmcPoint | null = null;
  for (const r of series) {
    if (r.date >= date) break;
    last = r;
  }
  if (!last) return null;
  const gap = Math.round((Date.parse(date + "T12:00:00Z") - Date.parse(last.date + "T12:00:00Z")) / DAY) - 1;
  const ctl = closed(last.ctl, 0, gap, kCtl);
  const atl = closed(last.atl, 0, gap, kAtl);
  return { ctl, atl, tsb: ctl - atl };
}

{
  const series = loadPmcSeries();
  const { state: base, history, zones, corpus } = loadFixture();
  if (!series || !corpus) {
    console.log("  T7 SKIP — corpus absent (data/derived/pmc.csv), seed-vs-header tests need real data");
  } else {
    // Several dates: inside the series, the day right after its last row,
    // the audited plan start (2026-07-13), and a far-future start.
    const dates = ["2026-07-01", "2026-07-05", "2026-07-13", "2026-08-01"];
    for (const d of dates) {
      const want = headerStateAt(series, d)!;
      const got = seedStateAt(base, series, d);
      check(
        `T7a[${d}]`,
        `planSeed(${d}) === headerState(${d}) (±0.1)`,
        near(got.ctl, want.ctl, 0.1) && near(got.atl, want.atl, 0.1) && near(got.tsb, want.tsb, 0.1),
        `seed ${got.ctl.toFixed(2)}/${got.atl.toFixed(2)}/${got.tsb.toFixed(2)} vs header ${want.ctl.toFixed(2)}/${want.atl.toFixed(2)}/${want.tsb.toFixed(2)}`
      );
    }
    const seeded = seedStateAt(base, series, "2026-07-13");
    check(
      "T7b",
      "seed keeps the non-PMC features from the weekly example (learned-layer inputs)",
      JSON.stringify(seeded.last4WeeksTss) === JSON.stringify(base.last4WeeksTss) &&
        seeded.weeksSinceStart === base.weeksSinceStart &&
        JSON.stringify(seeded.last4Shares) === JSON.stringify(base.last4Shares)
    );
    try {
      const plan = generatePlan(REQ, seeded, history, zones);
      const want = headerStateAt(series, "2026-07-13")!;
      check(
        "T7c",
        "plan generated from the seeded state carries the header CTL as startCtl (±0.1)",
        near(plan.meta.startCtl, want.ctl, 0.1),
        `startCtl ${plan.meta.startCtl} vs header ${want.ctl.toFixed(2)}`
      );
    } catch (e) {
      check("T7c", "seeded plan generates", false, (e as Error).message);
    }
  }
}

// ——— T8: maintenance property — daily load == starting CTL keeps TSB ~0 ———
// From a (near-)steady start, holding the daily load at exactly the starting
// CTL for a week must land end-of-week TSB within ±1 of 0: fitness is
// maintained, no phantom freshness or fatigue. Closed form agrees: CTL is a
// fixed point (CTL_n = L when CTL_0 = L), and any ATL offset shrinks by
// (6/7)^7 ≈ 0.34 across the week.
{
  let lcg = 20260713; // deterministic pseudo-random sweep
  const rand = () => ((lcg = (lcg * 48271) % 2147483647) / 2147483647);
  const ctls = [5, 10, 21, 34, 55, 89, ...Array.from({ length: 20 }, () => 5 + rand() * 115)];
  let worst = 0;
  let ctlDrift = 0;
  for (const c of ctls) {
    for (const off of [-2, 0, 2]) {
      const { ctl, atl } = stepWeek(c, c + off, Array(7).fill(c));
      worst = Math.max(worst, Math.abs(ctl - atl));
      ctlDrift = Math.max(ctlDrift, Math.abs(ctl - closed(c, c, 7, kCtl)));
    }
  }
  check("T8a", "PROPERTY: 7 days @ load == starting CTL → end-week TSB within ±1 of 0 (78 cases)", worst <= 1, `worst |TSB| ${worst.toFixed(3)}`);
  check("T8b", "PROPERTY: CTL is the recursion's fixed point (matches closed form)", ctlDrift <= 1e-9, `drift ${ctlDrift.toExponential(1)}`);
}

// ——— T9: anchor-v2 outlier smoothing — no week-over-week target cliffs ———
// A synthetic athlete shaped like the audited one: ~25 weeks around 70 TSS,
// then the observed tail 45, 90, 334 (outlier), 40, 90 right before the plan
// starts. Under anchor-v2 the outlier must not whipsaw the plan: when the
// 334 leaves the 4-week lookback its influence has to DECAY (ramp-cap
// reference max(previous non-zero week, 0.7 × best week in trailing 6))
// rather than vanish. Acceptance: consecutive pre-taper weekly targets never
// jump more than +20% or fall more than −35% (±3 TSS per-session rounding
// allowance, same as T5c/T6d — targetTss sums rounded sessions). Observed
// pre-fix cliff on this exact fixture: 75 → 129 (+72%) → 71 (−45%).
{
  let lcg = 20260713;
  const rand = () => ((lcg = (lcg * 48271) % 2147483647) / 2147483647);
  const weekly: number[] = [];
  for (let i = 0; i < 25; i++) weekly.push(Math.round(70 * (0.7 + 0.6 * rand())));
  weekly.push(45, 90, 334, 40, 90); // the audited athlete's recent shape

  // Walk the synthetic history through the real recursion (load spread over
  // 6 days/week) so states are self-consistent with the executed weeks.
  let ctl = 10;
  let atl = 10;
  const synthHistory: Array<{ state: AthleteState; actualTss: number }> = [];
  const last8: number[] = [];
  const mkState = (i: number): AthleteState => ({
    ctl,
    atl,
    tsb: ctl - atl,
    last4WeeksTss: last8.length >= 4 ? last8.slice(-4) : [70, 70, 70, 70],
    last4Shares: { swim: 0.1, bike: 0.3, run: 0.6 },
    daysToNextRace: null,
    weeksSinceStart: i,
    breakRatio: 1,
    daysSinceLastSession: 1,
  });
  for (let i = 0; i < weekly.length; i++) {
    synthHistory.push({ state: mkState(i), actualTss: weekly[i] });
    for (let d = 0; d < 7; d++) {
      const tss = d < 6 ? weekly[i] / 6 : 0;
      ctl = ctl + (tss - ctl) / 42;
      atl = atl + (tss - atl) / 7;
    }
    last8.push(weekly[i]);
    if (last8.length > 8) last8.shift();
  }
  const synthSeed = mkState(weekly.length); // last4 = [90, 334, 40, 90]
  const synthZones = deriveZones({ ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: 4.0, swimCssMps: 1.1 });

  try {
    const plan = generatePlan({ ...REQ, anchorV2: true }, synthSeed, synthHistory, synthZones);
    const pre = plan.weeks.filter((w) => w.phase !== "taper" && w.phase !== "race");
    let worstUp = 0;
    let worstDown = 0;
    let firstBad = "";
    for (let i = 1; i < pre.length; i++) {
      const [a, b] = [pre[i - 1].targetTss, pre[i].targetTss];
      const d = (b - a) / a;
      worstUp = Math.max(worstUp, d);
      worstDown = Math.min(worstDown, d);
      if ((b > a * 1.2 + 3 || b < a * 0.65 - 3) && !firstBad) {
        firstBad = `${pre[i - 1].weekStart}→${pre[i].weekStart}: ${a}→${b} (${(d * 100).toFixed(1)}%)`;
      }
    }
    check(
      "T9a",
      "anchor-v2 + outlier history: consecutive weekly targets within [+20%, −35%]",
      firstBad === "",
      firstBad || `worst +${(worstUp * 100).toFixed(1)}% / ${(worstDown * 100).toFixed(1)}%, targets ${pre.map((w) => w.targetTss).join(",")}`
    );
    check(
      "T9b",
      "anchor-v2 + outlier history: targets stay inside physiology rails (60 ≤ full weeks, ≤ outlier)",
      pre.every((w) => w.targetTss >= 60 && w.targetTss <= 334),
      `range ${Math.min(...pre.map((w) => w.targetTss))}–${Math.max(...pre.map((w) => w.targetTss))}`
    );
  } catch (e) {
    check("T9", "anchor-v2 outlier plan generates", false, (e as Error).message);
  }
}

// ——— T10: week-insights copy is truthful about maintenance vs building ———
// Post-seed-fix a week-1 target ≈ CTL×7 merely HOLDS fitness; the card must
// not claim "hard enough to adapt" for it. Contract: targetTss ≤ 1.05 ×
// (start-of-week CTL × 7) → maintenance/consolidation language; building
// language only meaningfully above that band.
{
  const cases: Array<[number, number, "maintenance" | "building"]> = [
    [147, 21, "maintenance"], // exactly CTL×7
    [154, 21, "maintenance"], // 1.048× — inside the 5% band
    [155, 21, "building"], // 1.054× — just above the band
    [169, 21, "building"], // the 1.15× week-1 floor is claimed as building
    [118, 16.9, "maintenance"], // audited corpus shape: target ≈ maintenance
    [136, 16.9, "building"], // audited corpus shape under the week-1 floor
    [60, 20, "maintenance"], // weekly floor below maintenance
  ];
  check("T10a", "loadCopyBranch picks the branch from (target, ctl) pairs",
    cases.every(([t, c, want]) => loadCopyBranch(t, c) === want),
    cases.map(([t, c, want]) => `${t}/${c}→${loadCopyBranch(t, c)}${loadCopyBranch(t, c) === want ? "" : "≠" + want}`).join(" "));

  const mkWeek = (weekStart: string, targetTss: number, ctl: number, tsb: number): PlanWeek => ({
    weekStart,
    phase: "base",
    targetTss,
    projected: { ctl, atl: r1(ctl - tsb), tsb },
    sessions: [],
  });
  const fakePlan: Plan = {
    meta: {
      generatedAt: "-", engine: "test", raceName: "Copy test race", raceDate: "2026-10-18",
      raceType: "run-half", daysPerWeek: 6, longDay: "sunday",
      startCtl: 20, projectedRaceCtl: 30, projectedRaceTsb: 8,
    },
    // Week 1 targets exactly maintenance off startCtl 20 (140 ≤ 1.05×140);
    // week 2 targets 170 off the projected 20.3 CTL (> 1.05×142.1);
    // week 3 dives past −20 TSB (the deep branch outranks both).
    weeks: [
      mkWeek("2026-07-13", 140, 20.3, -1.2),
      mkWeek("2026-07-20", 170, 21.1, -8.4),
      mkWeek("2026-07-27", 190, 22.4, -21.3),
    ],
  };
  const briefs = ["2026-07-13", "2026-07-20", "2026-07-27"].map((d) => briefForWeek(fakePlan, d, "Copy test race"));
  const tsbLine = (i: number) => briefs[i]?.why[2] ?? "";
  check("T10b", "maintenance-level week says consolidation, never 'hard enough to adapt'",
    tsbLine(0).includes("consolidation") && !tsbLine(0).includes("hard enough to adapt"),
    tsbLine(0));
  check("T10c", "meaningfully-above-maintenance week keeps the building copy",
    tsbLine(1).includes("hard enough to adapt"), tsbLine(1));
  check("T10d", "deep-TSB branch (≤ −20) is untouched by the copy split",
    tsbLine(2).includes("deliberately deep"), tsbLine(2));
}

// ——— T11: anchor-v2 week-1 base floor (runway ≤ 14 weeks, base/build) ———
// With the seed fix in, week 1 of a plan opens ≈ maintenance (CTL×7), which
// holds fitness but cannot build it. Under the anchor-v2 flag, when the race
// is ≤ 14 weeks out and the week is base/build, the FIRST plan week is
// floored at 1.15 × maintenance — still under the rule-4 ramp rails (≤ +20%
// over the trailing-month mean AND over the anchor ramp-cap reference).
// Flag off stays byte-identical; later weeks ramp via the anchor rules.
{
  // A steady athlete: 26 weeks at 70 TSS → CTL ≈ 10, maintenance ≈ CTL×7.
  const mkEngine = (anchorV2: boolean) => {
    const eng = new TaperV1({ anchorV2 });
    let ctl = 10;
    let atl = 10;
    const last8: number[] = [70, 70, 70, 70];
    for (let i = 0; i < 26; i++) {
      eng.observe(
        {
          ctl, atl, tsb: ctl - atl,
          last4WeeksTss: last8.slice(-4),
          last4Shares: { swim: 0.1, bike: 0.3, run: 0.6 },
          daysToNextRace: null, weeksSinceStart: i, breakRatio: 1, daysSinceLastSession: 1,
        },
        70
      );
      for (let d = 0; d < 7; d++) {
        const tss = d < 6 ? 70 / 6 : 0;
        ctl = ctl + (tss - ctl) / 42;
        atl = atl + (tss - atl) / 7;
      }
      last8.push(70);
      if (last8.length > 8) last8.shift();
    }
    const state: AthleteState = {
      ctl, atl, tsb: ctl - atl,
      last4WeeksTss: last8.slice(-4),
      trailingWeeksTss: [...last8],
      last4Shares: { swim: 0.1, bike: 0.3, run: 0.6 },
      daysToNextRace: 90, // 12.9 weeks of runway → base phase, inside 14 weeks
      weeksSinceStart: 26, // 26 % 4 = 2: not a cutback slot
      breakRatio: 1, daysSinceLastSession: 1,
    };
    return { eng, state };
  };

  const { eng: engOn, state } = mkEngine(true);
  const maintenance = state.ctl * 7;
  const floor = 1.15 * maintenance;
  const rampRail = Math.min(70, Math.max(70, 0.7 * 70)) * 1.2; // 84, both rails agree here
  const w1 = engOn.prescribeWeek(state);
  check("T11a", "flag ON, week 1, runway ≤ 14w, base: target ≥ 1.15× maintenance (±1)",
    w1.phase === "base" && w1.weekTss >= floor - 1,
    `phase ${w1.phase}, target ${w1.weekTss}, floor ${floor.toFixed(1)}`);
  check("T11b", "the floored week 1 still respects the +20% ramp rails",
    w1.weekTss <= rampRail + 1, `target ${w1.weekTss}, rail ${rampRail.toFixed(1)}`);

  const farRace = engOn.prescribeWeek({ ...state, daysToNextRace: 120 });
  check("T11c", "flag ON but runway > 14 weeks: floor inactive (target ≈ maintenance, < floor)",
    farRace.weekTss < floor - 1, `target ${farRace.weekTss}, floor ${floor.toFixed(1)}`);

  const week2 = engOn.prescribeWeek({ ...state, prevPrescribedTss: 70 });
  check("T11d", "flag ON but not week 1 (prevPrescribedTss set): floor inactive",
    week2.weekTss < floor - 1, `target ${week2.weekTss}`);

  const cutback = engOn.prescribeWeek({ ...state, weeksSinceStart: 27 }); // 27 % 4 = 3 → recovery
  check("T11e", "flag ON but recovery week: floor never applies outside base/build",
    cutback.phase === "recovery" && cutback.weekTss < floor - 1,
    `phase ${cutback.phase}, target ${cutback.weekTss}`);

  const { eng: engOff, state: stateOff } = mkEngine(false);
  const off = engOff.prescribeWeek(stateOff);
  check("T11f", "flag OFF: week 1 stays on the legacy path, below the floor",
    off.weekTss < floor - 1, `target ${off.weekTss}, floor ${floor.toFixed(1)}`);
}

console.log(`\nPMC + projection tests (${existsSync("data") ? "real corpus" : "synthetic"})\n`);
for (const l of [...passes, ...failures].sort()) console.log("  " + l);
console.log(`\n${passes.length} pass, ${failures.length} fail`);
process.exit(failures.length);
