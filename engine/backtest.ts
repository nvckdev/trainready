import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { referenceEngine } from "./reference.ts";
import type { AthleteState } from "./types.ts";

/**
 * Replays every corpus week through an engine and scores its prescription
 * against (a) what the athlete actually executed and (b) what the coach
 * programmed, where plan data exists. Writes data/reports/engine-backtest.md
 * and a per-week CSV.
 */

interface Example {
  weekStart: string;
  features: AthleteState & { daysToNextRace: number | null };
  targets: {
    weekTss: number;
    sessions: number;
    swimShare: number;
    bikeShare: number;
    runShare: number;
    plannedTss: number | null;
  };
}

const ROOT = process.cwd();
const examples: Example[] = readFileSync(join(ROOT, "data/datasets/weekly-examples.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const engine = referenceEngine;

interface Row {
  week: string;
  phase: string;
  predicted: number;
  executed: number;
  planned: number | null;
  daysToRace: number | null;
}

const rows: Row[] = examples.map((ex) => {
  const p = engine.prescribeWeek(ex.features);
  return {
    week: ex.weekStart,
    phase: p.phase,
    predicted: p.weekTss,
    executed: ex.targets.weekTss,
    planned: ex.targets.plannedTss,
    daysToRace: ex.features.daysToNextRace,
  };
});

// ——— metrics ———————————————————————————————————————————————

const mae = (pairs: Array<[number, number]>) =>
  pairs.reduce((s, [a, b]) => s + Math.abs(a - b), 0) / Math.max(1, pairs.length);
const mape = (pairs: Array<[number, number]>) =>
  (pairs
    .filter(([, b]) => b > 30)
    .reduce((s, [a, b]) => s + Math.abs(a - b) / b, 0) /
    Math.max(1, pairs.filter(([, b]) => b > 30).length)) *
  100;
const corr = (pairs: Array<[number, number]>) => {
  const n = pairs.length;
  const ma = pairs.reduce((s, [a]) => s + a, 0) / n;
  const mb = pairs.reduce((s, [, b]) => s + b, 0) / n;
  let num = 0,
    da = 0,
    db = 0;
  for (const [a, b] of pairs) {
    num += (a - ma) * (b - mb);
    da += (a - ma) ** 2;
    db += (b - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
};

const vsExecuted: Array<[number, number]> = rows.map((r) => [r.predicted, r.executed]);

// Weeks where the athlete demonstrably trained to plan (executed at least
// 60% of their trailing month's weekly mean): the compliance-noise-reduced
// view of prescription quality.
const consistent: Array<[number, number]> = [];
rows.forEach((r, i) => {
  if (i < 4) return;
  const trailing = rows.slice(i - 4, i).reduce((s, x) => s + x.executed, 0) / 4;
  if (trailing > 50 && r.executed >= trailing * 0.6) consistent.push([r.predicted, r.executed]);
});

// Direction agreement: did the engine call this week up or down vs the
// athlete's previous executed week, and did the coach agree?
let dirHits = 0;
let dirTotal = 0;
for (let i = 1; i < rows.length; i++) {
  const prev = rows[i - 1].executed;
  const predDir = Math.sign(rows[i].predicted - prev);
  const actDir = Math.sign(rows[i].executed - prev);
  if (Math.abs(rows[i].executed - prev) < 25) continue; // flat weeks don't vote
  dirTotal++;
  if (predDir === actDir) dirHits++;
}

// Taper behavior: in the two weeks before each race, how much did the engine
// cut vs how much the athlete actually cut (relative to 4 weeks prior).
const raceWeeks = rows.filter((r) => r.daysToRace !== null && r.daysToRace <= 14);
const taperCuts = raceWeeks.map((r) => {
  const idx = rows.indexOf(r);
  const baselineRows = rows.slice(Math.max(0, idx - 6), Math.max(0, idx - 2));
  const baseline =
    baselineRows.reduce((s, x) => s + x.executed, 0) / Math.max(1, baselineRows.length);
  return {
    week: r.week,
    daysToRace: r.daysToRace,
    predictedCut: baseline > 0 ? r.predicted / baseline : null,
    actualCut: baseline > 0 ? r.executed / baseline : null,
  };
});

// ——— outputs ———————————————————————————————————————————————

mkdirSync(join(ROOT, "data/reports"), { recursive: true });
writeFileSync(
  join(ROOT, "data/derived/engine-backtest.csv"),
  ["week,phase,predicted_tss,executed_tss,planned_tss,days_to_race"]
    .concat(
      rows.map(
        (r) =>
          `${r.week},${r.phase},${r.predicted},${r.executed},${r.planned ?? ""},${r.daysToRace ?? ""}`
      )
    )
    .join("\n") + "\n"
);

const phaseCounts = new Map<string, number>();
for (const r of rows) phaseCounts.set(r.phase, (phaseCounts.get(r.phase) ?? 0) + 1);

const md = `# Taper engine backtest — ${engine.name}

Generated ${new Date().toISOString().slice(0, 10)} · ${rows.length} weeks replayed (founder corpus)

The reference engine is the transparent physiology baseline (and safety
scaffold) the proprietary/learned engine must beat. Scores below are the
bar, not the ceiling.

## Weekly load prescription

| Comparison | Weeks | MAE (TSS) | MAPE | Correlation |
|---|---|---|---|---|
| vs executed weeks (all) | ${vsExecuted.length} | ${mae(vsExecuted).toFixed(1)} | ${mape(vsExecuted).toFixed(0)}% | ${corr(vsExecuted).toFixed(2)} |
| vs executed, consistent-training weeks | ${consistent.length} | ${mae(consistent).toFixed(1)} | ${mape(consistent).toFixed(0)}% | ${corr(consistent).toFixed(2)} |

A "vs coach-programmed" comparison is not yet measurable: TrainingPeaks
carries planned TSS for 98% of bike plans but 11% of run and 0% of swim
plans, so weekly planned totals are bike-skewed noise. Follow-up: estimate
planned TSS from planned duration × phase intensity before scoring it.

Direction agreement (up/down vs previous week, flat weeks excluded):
**${dirHits}/${dirTotal} = ${((dirHits / Math.max(1, dirTotal)) * 100).toFixed(0)}%**

## Phase calls

${[...phaseCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([p, n]) => `- ${p}: ${n} weeks`)
  .join("\n")}

## Taper behavior at races (≤14 days out)

| Week | Days to race | Engine cut to | Athlete cut to |
|---|---|---|---|
${taperCuts
  .map(
    (t) =>
      `| ${t.week} | ${t.daysToRace} | ${t.predictedCut === null ? "n/a" : Math.round(t.predictedCut * 100) + "%"} | ${t.actualCut === null ? "n/a" : Math.round(t.actualCut * 100) + "%"} |`
  )
  .join("\n")}

(percent of the trailing month's weekly load)

## Reading the numbers

- "Executed" weeks embed compliance noise: illness, travel, and skipped
  sessions that no forward-looking engine can (or should) predict. The
  consistent-training subset is the fairer read.
- Race detection is corpus-derived (multi-leg days); races the detector
  missed will make some taper weeks look like disagreement.
- The reference engine sees no season context (no off-season concept), so it
  prescribes maintenance load through breaks the athlete took deliberately.

Per-week detail: \`data/derived/engine-backtest.csv\`.
`;

writeFileSync(join(ROOT, "data/reports/engine-backtest.md"), md);
console.log(
  JSON.stringify(
    {
      weeks: rows.length,
      maeVsExecuted: +mae(vsExecuted).toFixed(1),
      corrVsExecuted: +corr(vsExecuted).toFixed(2),
      consistentWeeks: consistent.length,
      maeConsistent: +mae(consistent).toFixed(1),
      corrConsistent: +corr(consistent).toFixed(2),
      directionAgreement: +((dirHits / Math.max(1, dirTotal)) * 100).toFixed(0),
    },
    null,
    1
  )
);
console.log("report: data/reports/engine-backtest.md");
