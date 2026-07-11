import { join } from "node:path";
import { listJson, RAW, readJson, REPORTS } from "./io.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import type { PmcPoint, RaceLabel, Session, WeekAggregate } from "./types.ts";

type LoosePoint = Record<string, unknown>;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Read TrainingPeaks' own CTL/ATL/TSB series, tolerating shape drift. */
function readTpFitness(): Map<string, { ctl: number | null; atl: number | null; tsb: number | null }> {
  const out = new Map<string, { ctl: number | null; atl: number | null; tsb: number | null }>();
  for (const f of listJson(join(RAW, "fitness"))) {
    const data = readJson<unknown>(f) as Record<string, unknown> | unknown[];
    const list: LoosePoint[] = Array.isArray(data)
      ? (data as LoosePoint[])
      : (["daily_data", "fitness", "data", "points", "entries", "trend", "series"]
          .map((k) => (data as Record<string, unknown>)[k])
          .find(Array.isArray) as LoosePoint[] | undefined) ?? [];
    for (const p of list) {
      const rawDate = ["date", "day", "workoutDay"].map((k) => p[k]).find((v) => typeof v === "string") as
        | string
        | undefined;
      if (!rawDate) continue;
      const date = rawDate.slice(0, 10);
      out.set(date, {
        ctl: num(p.ctl) ?? num(p.fitness) ?? num(p.CTL),
        atl: num(p.atl) ?? num(p.fatigue) ?? num(p.ATL),
        tsb: num(p.tsb) ?? num(p.form) ?? num(p.TSB),
      });
    }
  }
  return out;
}

function mae(pairs: Array<[number, number]>): number | null {
  if (pairs.length === 0) return null;
  return pairs.reduce((s, [a, b]) => s + Math.abs(a - b), 0) / pairs.length;
}

export function validate(
  sessions: Session[],
  weekly: WeekAggregate[],
  pmc: PmcPoint[],
  races: RaceLabel[],
  normalizeStats: Record<string, number>,
  datasetStats: { examples: number; compliance: number }
): string {
  const first = sessions[0]?.date ?? "n/a";
  const last = sessions[sessions.length - 1]?.date ?? "n/a";
  const missingTss = sessions.filter((s) => s.tss === null).length;

  const byDiscipline = new Map<string, number>();
  for (const s of sessions) {
    byDiscipline.set(s.discipline, (byDiscipline.get(s.discipline) ?? 0) + 1);
  }

  // PMC agreement with TrainingPeaks, past a 60-day seed warmup
  const tp = readTpFitness();
  const warmupEnd = new Date(Date.parse(first) + 60 * 86400000).toISOString().slice(0, 10);
  const ctlPairs: Array<[number, number]> = [];
  const atlPairs: Array<[number, number]> = [];
  let maxCtlDiff = 0;
  let maxCtlDiffDate = "";
  for (const p of pmc) {
    if (p.date < warmupEnd) continue;
    const t = tp.get(p.date);
    if (!t) continue;
    if (t.ctl !== null) {
      ctlPairs.push([p.ctl, t.ctl]);
      const d = Math.abs(p.ctl - t.ctl);
      if (d > maxCtlDiff) {
        maxCtlDiff = d;
        maxCtlDiffDate = p.date;
      }
    }
    if (t.atl !== null) atlPairs.push([p.atl, t.atl]);
  }
  const ctlMae = mae(ctlPairs);
  const atlMae = mae(atlPairs);
  const pmcVerdict =
    ctlMae === null
      ? "NO TP FITNESS DATA — comparison skipped"
      : ctlMae < 2
        ? "PASS (CTL MAE < 2)"
        : ctlMae < 5
          ? "MARGINAL (2 ≤ CTL MAE < 5) — check dedupe and race-day TSS"
          : "FAIL (CTL MAE ≥ 5) — derived load diverges from TrainingPeaks";

  const weeksActive = weekly.filter((w) => w.sessions > 0).length;
  const md = `# Taper — Phase 0 data pipeline report

Generated ${new Date().toISOString().slice(0, 10)} · corpus of athlete 4195411 (founder)

## Coverage

| | |
|---|---|
| Date span | ${first} → ${last} |
| Completed sessions | ${sessions.length} |
| Active weeks | ${weeksActive} of ${weekly.length} |
| Race days labeled | ${races.length} |
| Missing TSS | ${missingTss} (${pct(missingTss, sessions.length)}) |
| Unknown discipline | ${normalizeStats.unknownDiscipline} (${pct(normalizeStats.unknownDiscipline, sessions.length)}) |
| Low-confidence discipline | ${normalizeStats.lowConfidence} (${pct(normalizeStats.lowConfidence, sessions.length)}) |
| Duplicates dropped (window overlap) | ${normalizeStats.duplicatesDropped} |
| Unmatched planned sessions kept | ${normalizeStats.plannedUnmatched} |

## Sessions by discipline

${[...byDiscipline.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([d, n]) => `- ${d}: ${n}`)
  .join("\n")}

## PMC agreement vs TrainingPeaks (after 60-day warmup)

| Metric | Value |
|---|---|
| Days compared | ${ctlPairs.length} |
| CTL MAE | ${fmt(ctlMae)} |
| ATL MAE | ${fmt(atlMae)} |
| Max CTL diff | ${maxCtlDiff.toFixed(2)} on ${maxCtlDiffDate || "n/a"} |
| **Verdict** | **${pmcVerdict}** |

The Phase-0 gate from PRD §12: the engine's load math must reproduce the
founder's real seasons before any prescription work begins.

## Datasets emitted

- \`data/datasets/weekly-examples.jsonl\` — ${datasetStats.examples} imitation examples (state → executed week)
- \`data/datasets/compliance.csv\` — ${datasetStats.compliance} plan-vs-actual session pairs
- \`data/derived/pmc.csv\`, \`weekly.csv\`, \`daily.jsonl\`, \`races.jsonl\`

## Known gaps

- Discipline is inferred (summaries carry \`sport: null\`); ${pct(
    normalizeStats.lowConfidence,
    sessions.length
  )} of sessions are low-confidence and should be spot-checked or re-enriched via per-workout detail pulls.
- Windows before 2024-09-10 are completed-only; unpaired planned sessions (skipped workouts) exist only after that date.
- Interval-level data (power/HR streams) not yet extracted; summary TSS is the load currency for Phase 0.
`;

  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(join(REPORTS, "phase0.md"), md);
  return md;
}

const pct = (n: number, d: number) => (d === 0 ? "0%" : `${((n / d) * 100).toFixed(1)}%`);
const fmt = (n: number | null) => (n === null ? "n/a" : n.toFixed(2));
