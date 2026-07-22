import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fitPriorFromExamples } from "../engine/learned.ts";
import type { AthleteState } from "../engine/types.ts";

/**
 * Fit the population prior (refinement 2) across every athlete corpus on this
 * machine and write data/models/population-prior.json. Sources:
 *   data/datasets/weekly-examples.jsonl            (the primary corpus)
 *   data/corpora/<athlete>/weekly-examples.jsonl   (additional athletes)
 * The artifact is gitignored with the rest of data/ — it derives from
 * personal training history. The engine NEVER reads it implicitly; callers
 * pass it via PlanRequest.priorWeights (see engine/learned.ts
 * loadPopulationPrior). Usage: npm run train:prior
 */

const ROOT = process.cwd();

function readExamples(path: string): Array<{ state: AthleteState; actualTss: number }> {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const ex = JSON.parse(l) as { features: AthleteState; targets: { weekTss: number } };
      return { state: ex.features, actualTss: ex.targets.weekTss };
    });
}

const sources: string[] = [];
const primary = join(ROOT, "data", "datasets", "weekly-examples.jsonl");
if (existsSync(primary)) sources.push(primary);
const corporaDir = join(ROOT, "data", "corpora");
if (existsSync(corporaDir)) {
  for (const d of readdirSync(corporaDir)) {
    const p = join(corporaDir, d, "weekly-examples.jsonl");
    if (existsSync(p)) sources.push(p);
  }
}

if (sources.length === 0) {
  console.error("no corpora found (data/datasets/weekly-examples.jsonl absent) — nothing to fit");
  process.exit(1);
}

const examples = sources.flatMap(readExamples);
const weights = fitPriorFromExamples(examples);
const out = {
  v: 1,
  weights,
  trainedWeeks: examples.length,
  athletes: sources.length,
  generatedAt: new Date().toISOString(),
};
mkdirSync(join(ROOT, "data", "models"), { recursive: true });
writeFileSync(join(ROOT, "data", "models", "population-prior.json"), JSON.stringify(out, null, 2) + "\n");
console.log(
  `population prior fit on ${examples.length} weeks across ${sources.length} corpus/corpora → data/models/population-prior.json`
);
console.log("weights:", weights.map((w) => w.toFixed(3)).join(", "));
