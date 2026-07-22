import { generatePlan, type Plan, type PlanRequest } from "./plan.ts";
import { deriveZones } from "./zones.ts";
import type { AthleteState } from "./types.ts";
import { TaperV1, fitPriorFromExamples } from "./learned.ts";
import { referenceEngine } from "./reference.ts";

/**
 * Population-prior tests (refinement 2). tsx script; exit code = failures.
 *
 * The ridge layer is inert for an athlete's first 24 weeks. A population
 * prior — fit across athletes' corpora and passed EXPLICITLY as
 * PlanRequest.priorWeights / TaperV1Options.priorWeights — makes the learned
 * layer live from week 1: per-athlete data then refits TOWARD the prior
 * (ridge centered on it), never from zero. Walk-forward honesty is untouched
 * (observe-after-prescribe ordering is the caller's, unchanged).
 *
 * The linchpin (PR1): absent signal ⇒ byte-identical. The prior is
 * caller-supplied, never auto-loaded inside TaperV1 — the backtest constructs
 * TaperV1 directly and must never see it.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

// Synthetic "population": a steady 250-TSS athlete's 60 weeks.
function popExamples(weekly: number, n: number) {
  const ex: Array<{ state: AthleteState; actualTss: number; weekStart?: string }> = [];
  let ctl = 20;
  let atl = 20;
  const last8: number[] = [];
  for (let i = 0; i < n; i++) {
    ex.push({
      state: {
        ctl, atl, tsb: ctl - atl,
        last4WeeksTss: last8.slice(-4).length ? last8.slice(-4) : [0],
        last4Shares: { swim: 0, bike: 0, run: 1 },
        daysToNextRace: null, weeksSinceStart: i, breakRatio: 1, daysSinceLastSession: 1,
      },
      actualTss: weekly,
    });
    for (let d = 0; d < 7; d++) {
      const t = d < 6 ? weekly / 6 : 0;
      ctl = ctl + (t - ctl) / 42;
      atl = atl + (t - atl) / 7;
    }
    last8.push(weekly);
    if (last8.length > 8) last8.shift();
  }
  return ex;
}

const prior = fitPriorFromExamples(popExamples(250, 60));

const seed: AthleteState = {
  ctl: 30, atl: 28, tsb: 2,
  last4WeeksTss: [190, 200, 205, 210],
  trailingWeeksTss: [170, 180, 185, 190, 190, 200, 205, 210],
  last4Shares: { swim: 0, bike: 0, run: 1 },
  daysToNextRace: 90, weeksSinceStart: 24, breakRatio: 1, daysSinceLastSession: 1,
};
const zones = deriveZones({ ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: 3.6, swimCssMps: 1.2 });
const REQ: PlanRequest = {
  raceName: "Prior HM", raceDate: "2026-11-08", raceType: "run-half",
  daysPerWeek: 5, longDay: "sunday", startDate: "2026-07-20", goalTime: "1:35:00",
};
const stable = (p: Plan): string => JSON.stringify({ ...p, meta: { ...p.meta, generatedAt: "-" } });

// ——— PR1. Neutrality ————————————————————————————————————————————————————
{
  check("PR1a", "fitPriorFromExamples returns an 11-feature weight vector",
    prior.length === 11 && prior.every(Number.isFinite));
  const a = stable(generatePlan(REQ, seed, [], zones));
  const b = stable(generatePlan({ ...REQ, priorWeights: undefined }, seed, [], zones));
  check("PR1b", "priorWeights: undefined is byte-identical to the field being absent", a === b);
  const c = stable(generatePlan({ ...REQ, priorWeights: prior }, seed, [], zones));
  check("PR1c", "a supplied prior changes the plan (the layer is live from week 1)", a !== c);
  const eng0 = new TaperV1({});
  const eng1 = new TaperV1({ priorWeights: undefined });
  const p0 = eng0.prescribeWeek(seed);
  const p1 = eng1.prescribeWeek(seed);
  check("PR1d", "TaperV1 without the option prescribes exactly as before (warming-up path)",
    JSON.stringify(p0) === JSON.stringify(p1) && /warming up/.test(p0.rationale));
}

// ——— PR2. Live from week 1, inside the rails ————————————————————————————
{
  const eng = new TaperV1({ priorWeights: prior });
  const p = eng.prescribeWeek(seed); // zero observed weeks
  check("PR2a", "cold engine with a prior does NOT fall back to reference",
    !/warming up/.test(p.rationale), p.rationale.slice(0, 80));
  const trailingMean = seed.last4WeeksTss.reduce((s, v) => s + v, 0) / 4;
  check("PR2b", "prior-driven prescription obeys the rails (never above anchor/ramp ceiling)",
    p.weekTss <= Math.round(trailingMean * 1.2) + 1 && p.weekTss >= 60, `${p.weekTss}`);
  const taperState: AthleteState = { ...seed, daysToNextRace: 14 };
  const ref = referenceEngine.prescribeWeek(taperState);
  const viaPrior = eng.prescribeWeek(taperState);
  check("PR2c", "taper/race protocol lock unaffected by the prior",
    viaPrior.weekTss === ref.weekTss && viaPrior.phase === "taper");
}

// ——— PR3. Per-athlete data refits TOWARD the prior, walk-forward ————————
{
  const withPrior = new TaperV1({ priorWeights: prior });
  const noPrior = new TaperV1({});
  // 40 identical observed weeks: the athlete's own data should dominate λ·prior.
  const athleteWeeks = popExamples(200, 40);
  for (const w of athleteWeeks) {
    withPrior.observe(w.state, w.actualTss, w.weekStart);
    noPrior.observe(w.state, w.actualTss, w.weekStart);
  }
  const a = withPrior.prescribeWeek(seed).weekTss;
  const b = noPrior.prescribeWeek(seed).weekTss;
  check("PR3a", "after 40 observed weeks the prior engine converges to the data (Δ ≤ 8 TSS)",
    Math.abs(a - b) <= 8, `${a} vs ${b}`);
  const early = new TaperV1({ priorWeights: prior });
  for (const w of athleteWeeks.slice(0, 4)) early.observe(w.state, w.actualTss, w.weekStart);
  const pe = early.prescribeWeek(seed);
  check("PR3b", "4 observed weeks already refit (learned layer active pre-24)",
    !/warming up/.test(pe.rationale) && pe.weekTss >= 60);
}

for (const p of passes) console.log(p);
for (const f of failures) console.error(f);
console.log(`\n${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
