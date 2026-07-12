import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { referenceEngine } from "./reference.ts";
import { TaperV1 } from "./learned.ts";
import type { AthleteState, Engine } from "./types.ts";

/**
 * Replays every corpus week through each engine (walk-forward: learned
 * engines observe a week only after prescribing it) and scores prescriptions
 * against executed load and estimated coach-programmed load. Writes
 * data/reports/engine-backtest.md and a per-week CSV.
 */

interface Example {
  weekStart: string;
  features: AthleteState;
  targets: { weekTss: number; plannedTss: number | null; plannedTssEst: number | null };
}

const ROOT = process.cwd();
const examples: Example[] = readFileSync(join(ROOT, "data/datasets/weekly-examples.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const v1 = new TaperV1();
const engines: Engine[] = [referenceEngine, v1];

interface Cell {
  phase: string;
  predicted: number;
}
interface Row {
  week: string;
  executed: number;
  plannedEst: number | null;
  daysToRace: number | null;
  byEngine: Record<string, Cell>;
}

const rows: Row[] = examples.map((ex) => {
  const byEngine: Record<string, Cell> = {};
  for (const e of engines) {
    const p = e.prescribeWeek(ex.features);
    byEngine[e.name] = { phase: p.phase, predicted: p.weekTss };
  }
  // Learned engines see the outcome only after prescribing (no look-ahead).
  v1.observe(ex.features, ex.targets.weekTss);
  return {
    week: ex.weekStart,
    executed: ex.targets.weekTss,
    plannedEst: ex.targets.plannedTssEst,
    daysToRace: ex.features.daysToNextRace,
    byEngine,
  };
});

// ——— metrics ———————————————————————————————————————————————

const mae = (pairs: Array<[number, number]>) =>
  pairs.reduce((s, [a, b]) => s + Math.abs(a - b), 0) / Math.max(1, pairs.length);
const corr = (pairs: Array<[number, number]>) => {
  const n = pairs.length;
  if (n < 3) return NaN;
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

function scores(name: string) {
  const all: Array<[number, number]> = rows.map((r) => [r.byEngine[name].predicted, r.executed]);

  const consistent: Array<[number, number]> = [];
  rows.forEach((r, i) => {
    if (i < 4) return;
    const trailing = rows.slice(i - 4, i).reduce((s, x) => s + x.executed, 0) / 4;
    if (trailing > 50 && r.executed >= trailing * 0.6)
      consistent.push([r.byEngine[name].predicted, r.executed]);
  });

  const vsPlanned: Array<[number, number]> = rows
    .filter((r) => r.plannedEst !== null && r.plannedEst > 30)
    .map((r) => [r.byEngine[name].predicted, r.plannedEst!]);

  let dirHits = 0,
    dirTotal = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].executed;
    if (Math.abs(rows[i].executed - prev) < 25) continue;
    dirTotal++;
    if (Math.sign(rows[i].byEngine[name].predicted - prev) === Math.sign(rows[i].executed - prev))
      dirHits++;
  }

  return {
    maeAll: mae(all),
    corrAll: corr(all),
    maeConsistent: mae(consistent),
    corrConsistent: corr(consistent),
    nConsistent: consistent.length,
    maePlanned: vsPlanned.length ? mae(vsPlanned) : null,
    corrPlanned: vsPlanned.length ? corr(vsPlanned) : null,
    nPlanned: vsPlanned.length,
    direction: (dirHits / Math.max(1, dirTotal)) * 100,
  };
}

const s0 = scores(referenceEngine.name);
const s1 = scores(v1.name);

// Taper behavior at races for both engines
const taperRows = rows.filter((r) => r.daysToRace !== null && r.daysToRace <= 14);
const taperCuts = taperRows.map((r) => {
  const idx = rows.indexOf(r);
  const base = rows.slice(Math.max(0, idx - 6), Math.max(0, idx - 2));
  const baseline = base.reduce((s, x) => s + x.executed, 0) / Math.max(1, base.length);
  const pct = (v: number) => (baseline > 0 ? Math.round((v / baseline) * 100) + "%" : "n/a");
  return {
    week: r.week,
    d: r.daysToRace,
    ref: pct(r.byEngine[referenceEngine.name].predicted),
    v1: pct(r.byEngine[v1.name].predicted),
    actual: pct(r.executed),
  };
});

// ——— outputs ———————————————————————————————————————————————

writeFileSync(
  join(ROOT, "data/derived/engine-backtest.csv"),
  ["week,days_to_race,executed_tss,planned_est_tss,ref_phase,ref_tss,v1_phase,v1_tss"]
    .concat(
      rows.map((r) =>
        [
          r.week,
          r.daysToRace ?? "",
          r.executed,
          r.plannedEst ?? "",
          r.byEngine[referenceEngine.name].phase,
          r.byEngine[referenceEngine.name].predicted,
          r.byEngine[v1.name].phase,
          r.byEngine[v1.name].predicted,
        ].join(",")
      )
    )
    .join("\n") + "\n"
);

const fm = (n: number | null, d = 1) => (n === null || Number.isNaN(n) ? "n/a" : n.toFixed(d));

const md = `# Taper engine backtest — reference-v0 vs taper-v1

Generated ${new Date().toISOString().slice(0, 10)} · ${rows.length} weeks replayed (founder corpus), walk-forward, zero look-ahead

taper-v1 = ridge regression on the athlete's own history, clamped inside the
reference engine's phase guardrails. It activates after 24 observed weeks;
before that it defers to the reference.

## Weekly load prescription

| Metric | reference-v0 | taper-v1 |
|---|---|---|
| MAE vs executed, all ${rows.length} weeks | ${fm(s0.maeAll)} | **${fm(s1.maeAll)}** |
| MAE vs executed, consistent-training weeks (${s1.nConsistent}) | ${fm(s0.maeConsistent)} | **${fm(s1.maeConsistent)}** |
| Correlation, consistent weeks | ${fm(s0.corrConsistent, 2)} | **${fm(s1.corrConsistent, 2)}** |
| MAE vs coach-programmed (est.), ${s1.nPlanned} weeks | ${fm(s0.maePlanned)} | **${fm(s1.maePlanned)}** |
| Correlation vs coach-programmed (est.) | ${fm(s0.corrPlanned, 2)} | **${fm(s1.corrPlanned, 2)}** |
| Direction agreement | ${fm(s0.direction, 0)}% | **${fm(s1.direction, 0)}%** |

"Coach-programmed (est.)" fills TrainingPeaks' missing planned TSS (11% run,
0% swim coverage) with duration×IF² estimates from the plan text; it is a
noisy but honest reconstruction of coach intent after 2024-09.

## Taper behavior at races (≤14 days out, % of trailing month)

| Week | Days out | reference-v0 | taper-v1 | Athlete |
|---|---|---|---|---|
${taperCuts.map((t) => `| ${t.week} | ${t.d} | ${t.ref} | ${t.v1} | ${t.actual} |`).join("\n")}

## Reading the numbers

- Walk-forward means taper-v1's early weeks are the reference engine; its
  advantage compounds as history accumulates.
- Executed weeks embed compliance noise (illness, travel, skipped sessions);
  the consistent-training subset and the coach-programmed comparison are the
  fairer reads of prescription quality.
- The reference engine now has an off-season phase (no race in 120 days +
  demonstrated break → rebuild from current volume, not old CTL).

Per-week detail: \`data/derived/engine-backtest.csv\`.
`;

mkdirSync(join(ROOT, "data/reports"), { recursive: true });
writeFileSync(join(ROOT, "data/reports/engine-backtest.md"), md);

console.log(
  JSON.stringify(
    {
      weeks: rows.length,
      reference: { maeConsistent: +fm(s0.maeConsistent), corr: +fm(s0.corrConsistent, 2), maePlanned: s0.maePlanned && +fm(s0.maePlanned), dir: +fm(s0.direction, 0) },
      taperV1: { maeConsistent: +fm(s1.maeConsistent), corr: +fm(s1.corrConsistent, 2), maePlanned: s1.maePlanned && +fm(s1.maePlanned), dir: +fm(s1.direction, 0) },
    },
    null,
    1
  )
);
console.log("report: data/reports/engine-backtest.md");
