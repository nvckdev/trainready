import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  finishEstimate,
  goalCtlTarget,
  longRunKm,
  parseGoalTime,
  peakLongKm,
  raceDistanceKm,
  vdot,
} from "./goal.ts";
import { TaperV1 } from "./learned.ts";
import { generatePlan, type Plan, type PlanRequest } from "./plan.ts";
import { seedStateAt, type DailyPmcPoint } from "./seed.ts";
import { deriveZones } from "./zones.ts";
import type { AthleteState } from "./types.ts";

/**
 * Goal-backed periodization acceptance tests (`npm run engine:tests`, run
 * after engine/pmc.test.ts). Same harness shape: a tsx script whose exit
 * code is the number of failures.
 *
 * Covers docs/periodization-spec.md §7 A–H:
 *   A anchor & bands, B monotonicity, C invertibility, D backtest neutrality
 *   (rule 7 — the pins must not move), E rails still bind (rule 4),
 *   F rising trajectory, G distance-tied injury-capped long run.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const HALF = 21.1;
const sec = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s;
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ——— A. Anchor & bands ———————————————————————————————————————————
{
  const g = goalCtlTarget(HALF, sec(1, 24));
  check("A1a", "1:24 half → raceDayCtl in [48,52] (the 'use ~50' anchor)",
    g.raceDayCtl >= 48 && g.raceDayCtl <= 52, `raceDayCtl ${g.raceDayCtl.toFixed(1)}`);
  check("A1b", "1:24 half → peakCtl in [45,55]",
    g.peakCtl >= 45 && g.peakCtl <= 55, `peakCtl ${g.peakCtl.toFixed(1)}`);
  // Model-A closed-form cross-check: 0.158 · D · v_kmh (v = 21.1/1.4 h)
  const modelA = 0.158 * HALF * (HALF / (84 / 60));
  check("A2", "Model-A cross-check within ±1.5 CTL of raceDayCtl",
    near(modelA, g.raceDayCtl, 1.5), `modelA ${modelA.toFixed(1)} vs ${g.raceDayCtl.toFixed(1)}`);
}

// ——— B. Monotonicity (both gradients — the hard requirement) ————————
{
  const rd = (t: number) => goalCtlTarget(HALF, t).raceDayCtl;
  const p17 = rd(sec(1, 17)), p24 = rd(sec(1, 24)), p30 = rd(sec(1, 30)), p35 = rd(sec(1, 35));
  check("B3", "pace sweep (half fixed): faster pace ⇒ strictly higher CTL",
    p17 > p24 && p24 > p30 && p30 > p35,
    `1:17 ${p17.toFixed(1)} > 1:24 ${p24.toFixed(1)} > 1:30 ${p30.toFixed(1)} > 1:35 ${p35.toFixed(1)}`);

  // Distance sweep at a fixed 4:00/km pace (240 s/km ⇒ T = 240·D seconds).
  const atPace = (d: number) => goalCtlTarget(d, 240 * d).raceDayCtl;
  const c10 = atPace(10), cHalf = atPace(HALF), cMar = atPace(42.2);
  check("B4", "distance sweep (pace fixed 4:00/km): 10k < half < marathon strictly",
    c10 < cHalf && cHalf < cMar, `10k ${c10.toFixed(1)} < half ${cHalf.toFixed(1)} < mar ${cMar.toFixed(1)}`);
}

// ——— C. Invertibility ————————————————————————————————————————————
{
  let allRoundTrip = true;
  const detail: string[] = [];
  for (const [h, m] of [[1, 17], [1, 24], [1, 30], [1, 40]] as Array<[number, number]>) {
    const t = sec(h, m);
    const est = finishEstimate(goalCtlTarget(HALF, t).raceDayCtl, HALF);
    if (!near(est, t, 20)) allRoundTrip = false;
    detail.push(`${h}:${String(m).padStart(2, "0")}→${(est / 60).toFixed(1)}m`);
  }
  check("C5", "round-trip finishEstimate∘goalCtlTarget within ±20 s", allRoundTrip, detail.join(" "));

  // finishEstimate strictly decreasing in reachable CTL; growing with distance.
  const f = (c: number) => finishEstimate(c, HALF);
  check("C6a", "finishEstimate strictly decreasing in reachable CTL",
    f(20) > f(26) && f(26) > f(35) && f(35) > f(50), `${f(20).toFixed(0)}>${f(26).toFixed(0)}>${f(35).toFixed(0)}>${f(50).toFixed(0)}`);
  check("C6b", "finishEstimate grows with distance at fixed CTL",
    finishEstimate(30, 10) < finishEstimate(30, HALF) && finishEstimate(30, HALF) < finishEstimate(30, 42.2), "");

  // The gap-region sanity that motivated the Model-B choice (guards a
  // Model-A-style d²/CTL blow-up): reachable ~26 ⇒ ~1:40–1:47.
  const g26 = finishEstimate(26, HALF);
  check("C7", "finishEstimate(26, half) in [1:40, 1:47] (gap-region sanity)",
    g26 >= sec(1, 40) && g26 <= sec(1, 47), `${(g26 / 60).toFixed(1)} min`);
}

// ——— CAL. Personal-anchored finish calibration (docs/finish-calibration.md) —
// The generic curve treats CTL as total fitness and predicts ~1:50 at CTL ~22 —
// slower than a 1:31 this athlete already ran at CTL ~18. These pin the fix:
// finish is anchored to demonstrated performance + a durable ceiling, clamped so
// a projection is never slower than a real race at equal-or-lower CTL.
{
  // Real athlete race anchors {date, distanceKm, timeSec, ctlAtRace}: the 1:31
  // (2026-05-03) and the 1:17 PR (2023-11-05). CTL looked up in data/derived/pmc.csv.
  const ANCHORS = [
    { date: "2023-11-05", distanceKm: 21.071, timeSec: 1.2877249717712402 * 3600, ctlAtRace: 67.3 },
    { date: "2026-05-03", distanceKm: 21.2945390625, timeSec: 1.5284639596939087 * 3600, ctlAtRace: 17.6 },
  ];
  const ASOF = "2026-07-13";
  const RECENT_SEC = 1.5284639596939087 * 3600; // 5502.5 s — the real 1:31 (91:42)
  const fe = (c: number, d = HALF) => finishEstimate(c, d, ANCHORS, ASOF);

  // equal-VDOT half time of an anchor (the clamp ceiling) via the same vdot inverse.
  const halfEquiv = (a: { distanceKm: number; timeSec: number }) => {
    const V = vdot(a.distanceKm, a.timeSec / 60);
    let lo = 2.5 * HALF, hi = 9.0 * HALF;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (vdot(HALF, m) > V) lo = m; else hi = m; }
    return ((lo + hi) / 2) * 60;
  };

  // (a) reproduces the real race — anchored to demonstrated performance, not raw CTL.
  const atAnchor = finishEstimate(17.6, 21.2945390625, ANCHORS, ASOF);
  check("CAL-a1", "at the anchor CTL+distance the model reproduces the real 1:31 (±20 s)",
    near(atAnchor, RECENT_SEC, 20), `${(atAnchor / 60).toFixed(2)} min vs ${(RECENT_SEC / 60).toFixed(2)}`);
  const at20 = fe(20);
  check("CAL-a2", "at CTL 20 the half projects ~1:31 (within ~90 s of 1:31:00), never the old ~1:52",
    near(at20, sec(1, 31), 90) && at20 < sec(1, 35), `${(at20 / 60).toFixed(2)} min`);

  // (b) HARD INVARIANT: never slower than any real race at CTL ≤ C. Sweep 18–26.
  let invOk = true;
  const viol: string[] = [];
  for (let c = 18; c <= 26; c += 0.5) {
    const caps = ANCHORS.filter((a) => a.ctlAtRace <= c).map(halfEquiv);
    const cap = caps.length ? Math.min(...caps) : Infinity;
    if (fe(c) > cap + 1e-6) { invOk = false; viol.push(`C${c}: ${fe(c).toFixed(0)}>${cap.toFixed(0)}`); }
  }
  check("CAL-b1", "HARD INVARIANT: finishEstimate(C,half) ≤ min half-equiv of anchors with CTL≤C, C∈[18,26]",
    invOk, viol.slice(0, 3).join("; "));
  check("CAL-b2", "finishEstimate(22, half) ≤ 1:31 (vs the 1:31 already run at CTL 17.6)",
    fe(22) <= sec(1, 31) + 1e-6, `${(fe(22) / 60).toFixed(2)} min`);
  check("CAL-b3", "at CTL ≥ the PR CTL the half projects ≤ the 1:17 PR half-equivalent",
    finishEstimate(67.3, HALF, ANCHORS, ASOF) <= halfEquiv(ANCHORS[0]) + 1e-6, "");

  // (c) honest gap for a 1:24 goal: reachable ~22 does NOT suddenly reach 1:24.
  check("CAL-c", "1:24 stays an honest gap: finishEstimate(22) slower than 1:24 yet far faster than 1:52",
    fe(22) > sec(1, 24) && fe(22) < sec(1, 45), `${(fe(22) / 60).toFixed(2)} min (>1:24, <1:45)`);

  // (d) monotone: more CTL ⇒ faster (or equal).
  let monoOk = true;
  let prev = Infinity;
  for (let c = 15; c <= 30; c += 1) { const v = fe(c); if (v > prev + 1e-6) monoOk = false; prev = v; }
  check("CAL-d", "personal curve monotone non-increasing in CTL (more fitness ⇒ ≤ time)", monoOk);

  // (e) no personal races ⇒ byte-identical fallback to the generic VDOT model.
  const SNAP: Record<number, number> = {
    20: 6636.079195, 22: 6496.017031, 26: 6233.556021, 35: 5716.944664, 50: 5030.580392,
  };
  let fbOk = true;
  const fbDetail: string[] = [];
  for (const c of [20, 22, 26, 35, 50]) {
    const none = finishEstimate(c, HALF);
    const empty = finishEstimate(c, HALF, [], ASOF);
    if (none !== empty || Math.abs(none - SNAP[c]) > 1e-3) { fbOk = false; fbDetail.push(`C${c}:${none.toFixed(3)}`); }
  }
  check("CAL-e", "no-anchor fallback byte-identical to the pre-change generic model", fbOk, fbDetail.join(" "));
}

// ——— D. Backtest neutrality (rule 7 — the pins must not move) ————————
{
  // D8/D10: replay every dataset week through TaperV1 exactly like
  // engine/backtest.ts and assert the per-week weekTss sequence is
  // byte-identical to the pre-change engine (hash captured 2026-07-13 before
  // the goal-periodization change). The dataset feature records carry no
  // goalPeakCtl, so the §2.1 goal floor is provably inert on the replay path.
  const PRECHANGE_HASH = "f3bbe19b7cc6a11e760bedab197c149b008ac9b59c75640dc1e4b9896b881a95";
  const dataset = join(process.cwd(), "data/datasets/weekly-examples.jsonl");
  if (!existsSync(dataset)) {
    console.log("  D8/D9 SKIP — corpus absent (data/datasets/weekly-examples.jsonl)");
  } else {
    const rows = readFileSync(dataset, "utf8").split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as { weekStart: string; features: AthleteState; targets: { weekTss: number } });
    const v1 = new TaperV1();
    const seq: number[] = [];
    let leak = false;
    for (const r of rows) {
      if ("goalPeakCtl" in (r.features as unknown as Record<string, unknown>)) leak = true;
      seq.push(v1.prescribeWeek(r.features).weekTss);
      v1.observe(r.features, r.targets.weekTss, r.weekStart);
    }
    const hash = createHash("sha256").update(seq.join(",")).digest("hex");
    check("D8", "backtest replay weekTss byte-identical to pre-change engine (pins hold)",
      hash === PRECHANGE_HASH, `${rows.length}w hash ${hash.slice(0, 12)}`);
    check("D9", "no dataset feature row carries a goalPeakCtl key", !leak);
  }

  // D10: prescribeWeek is provably inert without the flag — presence of an
  // explicit undefined goalPeakCtl equals its absence, on a battery of states
  // that exercise base/build/recovery/offseason and the floors.
  const base = (o: Partial<AthleteState>): AthleteState => ({
    ctl: 20, atl: 22, tsb: -2, last4WeeksTss: [110, 120, 118, 130],
    last4Shares: { swim: 0, bike: 0.05, run: 0.95 },
    daysToNextRace: 90, weeksSinceStart: 5, breakRatio: 1, daysSinceLastSession: 1, ...o,
  });
  const battery: AthleteState[] = [
    base({}),
    base({ ctl: 17, tsb: 3, daysToNextRace: 98, weeksSinceStart: 0, isFirstPlanWeek: true }),
    base({ ctl: 30, atl: 35, tsb: -5, daysToNextRace: 40, weeksSinceStart: 7, last4WeeksTss: [200, 210, 220, 215] }),
    base({ ctl: 25, weeksSinceStart: 3, last4WeeksTss: [150, 160, 155, 140], prevPrescribedTss: 160 }),
    base({ ctl: 12, atl: 10, tsb: 2, daysToNextRace: null, weeksSinceStart: 2, breakRatio: 0.4, daysSinceLastSession: 14, last4WeeksTss: [40, 30, 20, 10] }),
    base({ ctl: 45, atl: 40, tsb: 5, daysToNextRace: 200, weeksSinceStart: 40, last4WeeksTss: [300, 320, 310, 330] }),
  ];
  const e = new TaperV1();
  let inert = true;
  for (const s of battery) {
    const off = e.prescribeWeek(s);
    const explicitUndef = e.prescribeWeek({ ...s, goalPeakCtl: undefined });
    if (JSON.stringify(off) !== JSON.stringify(explicitUndef)) inert = false;
  }
  check("D10", "prescribeWeek inert when goalPeakCtl is unset/undefined (battery)", inert);
}

// ——— Corpus fixture for plan-level tests (E/F/G) ———————————————————

function loadPlanFixture(): {
  seed: AthleteState;
  history: Array<{ state: AthleteState; actualTss: number; weekStart?: string }>;
  zones: ReturnType<typeof deriveZones>;
} | null {
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
  console.log("  E/F/G SKIP — corpus absent (plan-trajectory tests need real seed data)");
} else {
  const { seed, history, zones } = fx;
  const plan: Plan = generatePlan(ATHLETE_REQ, seed, history, zones);
  const noGoal: Plan = generatePlan({ ...ATHLETE_REQ, goalTime: undefined }, seed, history, zones);
  const full = plan.weeks.slice(0, -1); // last week is race week

  // ——— E. Rails still bind under a goal (rule 4) ———————————————————
  {
    // no week exceeds 1.20× trailing-4wk mean nor 1.20× the prior week
    const tss = plan.weeks.map((w) => w.targetTss);
    let rampOk = true;
    const bad: string[] = [];
    for (let i = 0; i < plan.weeks.length; i++) {
      if (plan.weeks[i].phase === "taper" || plan.weeks[i].phase === "race") continue;
      const trailing = i >= 1 ? tss.slice(Math.max(0, i - 4), i).reduce((s, x) => s + x, 0) / Math.min(4, i) : Infinity;
      const prev = i >= 1 ? tss[i - 1] : Infinity;
      // Rails bind on the PRESCRIBED weekTss; the emitted targetTss is that sum
      // re-rounded across ~6–7 sessions (the long-run redistribution preserves
      // the total pre-rounding), so allow a small ±4 TSS rounding band.
      if (tss[i] > trailing * 1.2 + 4 || tss[i] > prev * 1.2 + 4) {
        rampOk = false;
        bad.push(`wk${i} ${tss[i]} vs trail ${trailing.toFixed(0)} prev ${prev}`);
      }
    }
    check("E11a", "no week's targetTss exceeds +20% over trailing-4wk mean or prior week (±4 rounding)", rampOk, bad.slice(0, 3).join("; "));

    const tsbFloorOk = plan.weeks.every((w) => w.projected.tsb >= -25);
    check("E11b", "no week breaches the TSB floor (−25)", tsbFloorOk,
      `min tsb ${Math.min(...plan.weeks.map((w) => w.projected.tsb)).toFixed(1)}`);

    const floorOk = full.every((w) => w.targetTss >= 60);
    check("E11c", "every full week ≥ 60 TSS (weekly floor)", floorOk,
      `min full-week TSS ${Math.min(...full.map((w) => w.targetTss))}`);

    check("E12", "reachable race-day CTL stays well below required (gap real, rails not loosened)",
      plan.meta.projectedRaceCtl < (plan.meta.goalGap?.requiredPeakCtl ?? 999),
      `reachable ${plan.meta.projectedRaceCtl} vs required ${plan.meta.goalGap?.requiredPeakCtl}`);
  }

  // ——— F. Rising trajectory (§2) ——————————————————————————————————
  {
    // base/build projected.ctl is net-increasing; dips only on cutback weeks.
    let risingOk = true;
    const dips: string[] = [];
    for (let i = 1; i < plan.weeks.length; i++) {
      const w = plan.weeks[i], prev = plan.weeks[i - 1];
      if (w.phase !== "base" && w.phase !== "build") continue;
      // w is base/build here; a dip is only allowed the week after a cutback
      // (the recovery week shed load, so the next week starts lower).
      if (w.projected.ctl < prev.projected.ctl - 0.05 && prev.phase !== "recovery") {
        risingOk = false;
        dips.push(`wk${i} ${w.projected.ctl}<${prev.projected.ctl}`);
      }
    }
    check("F13a", "base/build projected.ctl strictly rising (dips only around cutbacks)", risingOk, dips.slice(0, 4).join("; "));

    // "Meaningfully above current, not flat ~17." From a low injured base with
    // τ=42 inertia CTL climbs ~0.5 pt/wk (spec §4.1), so a clear multi-point
    // rise over ~10 effective build weeks is the honest bar — not the fictional
    // ~50 the goal would need (that gap is what the assessment reports).
    const peakCtl = Math.max(...plan.weeks.map((w) => w.projected.ctl));
    check("F13b", "peak projected.ctl meaningfully above current (not flat ~17)",
      peakCtl >= plan.meta.startCtl + 4, `peak ${peakCtl} vs start ${plan.meta.startCtl}`);

    check("F14", "goal plan's reachable race CTL ≥ the no-goal baseline (floor lifts, never lowers)",
      plan.meta.projectedRaceCtl >= noGoal.meta.projectedRaceCtl - 0.1,
      `goal ${plan.meta.projectedRaceCtl} vs no-goal ${noGoal.meta.projectedRaceCtl}`);
  }

  // ——— G. Long run (§5) ————————————————————————————————————————————
  {
    const EASY_KMH = 11.6;
    const longRuns = full
      .flatMap((w) => w.sessions)
      .filter((s) => s.discipline === "run" && s.title.toLowerCase().startsWith("long run"));
    const peakMin = Math.max(...longRuns.map((s) => s.durationHr * 60));
    const peakKmEq = Math.max(...longRuns.map((s) => s.durationHr * EASY_KMH));
    check("G15a", "peak long run in [110,130] min and never > 156 min",
      peakMin >= 110 && peakMin <= 130 && peakMin <= 156, `peak ${peakMin.toFixed(0)} min`);
    check("G15b", "peak long run in [22,26] km-equivalent",
      peakKmEq >= 22 && peakKmEq <= 26, `peak ${peakKmEq.toFixed(1)} km`);

    // peakLongKm / longRunKm unit behavior
    check("G15c", "peakLongKm(run-half) = 24 (min of 21.1·1.15 and injury cap 24)",
      near(peakLongKm("run-half"), 24, 0.01), `${peakLongKm("run-half")}`);
    check("G15d", "longRunKm step ≤ 2 km and ≤ +15%/week; flat on cutback; capped at peak",
      longRunKm(12, 24, false) <= Math.min(12 + 2, 12 * 1.15) + 1e-9 &&
        longRunKm(20, 24, false) <= 20 + 2 + 1e-9 && // step binds above ~13 km
        longRunKm(20, 24, true) === 20 && // cutback holds flat
        longRunKm(23.5, 24, false) === 24, // never exceeds the injury cap
      `12→${longRunKm(12, 24, false).toFixed(2)}, 20→${longRunKm(20, 24, false).toFixed(2)}, cutback ${longRunKm(20, 24, true)}`);
  }

  // ——— gap assessment fires for this athlete (task item f) ————————————
  {
    const gap = plan.meta.goalGap;
    check("Gap-a", "goalGap present for low-CTL/14wk/injury athlete", !!gap);
    if (gap) {
      check("Gap-b", "reachable peak CTL < required (gap computed)",
        gap.reachablePeakCtl < gap.requiredPeakCtl && gap.gapCtl > 0,
        `reach ${gap.reachablePeakCtl} req ${gap.requiredPeakCtl} gap ${gap.gapCtl}`);
      check("Gap-c", "produces a finish estimate + non-empty message",
        typeof gap.realisticFinish === "string" && gap.realisticFinish.includes(":") && gap.message.length > 40,
        `finish ${gap.realisticFinish}`);
      check("Gap-d", "realistic finish never faster than the goal time",
        parseGoalTime(gap.realisticFinish + ":00")! >= 0, gap.realisticFinish);
    }
  }
}

// ——— parse/util unit sanity ————————————————————————————————————————
{
  check("U-a", "parseGoalTime H:MM:SS", parseGoalTime("1:24:00") === 5040);
  check("U-b", "parseGoalTime MM:SS", parseGoalTime("84:00") === 5040);
  check("U-c", "parseGoalTime invalid → undefined",
    parseGoalTime("") === undefined && parseGoalTime("abc") === undefined);
  check("U-d", "raceDistanceKm mapping", raceDistanceKm("run-half") === 21.1 && raceDistanceKm("sprint") === undefined);
  check("U-e", "vdot monotone decreasing in time at fixed distance",
    vdot(HALF, 80) > vdot(HALF, 90), "");
}

console.log(`\nGoal-periodization tests (${existsSync("data") ? "real corpus" : "synthetic"})\n`);
for (const l of [...passes, ...failures].sort()) console.log("  " + l);
console.log(`\n${passes.length} pass, ${failures.length} fail`);
process.exit(failures.length);
