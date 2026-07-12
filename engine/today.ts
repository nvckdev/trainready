import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TaperV1 } from "./learned.ts";
import type { AthleteState } from "./types.ts";

/** Prints taper-v1's prescription for the coming week: the model is warmed
 *  on every prior week of history, then asked about the latest state. */

const ROOT = process.cwd();
const examples = readFileSync(join(ROOT, "data/datasets/weekly-examples.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map(
    (l) =>
      JSON.parse(l) as {
        weekStart: string;
        features: AthleteState;
        targets: { weekTss: number };
      }
  );

const engine = new TaperV1();
const latest = examples[examples.length - 1];
for (const ex of examples.slice(0, -1)) engine.observe(ex.features, ex.targets.weekTss);

const p = engine.prescribeWeek(latest.features);
const f = latest.features;

console.log(`\nTAPER · ${engine.name} · week of ${latest.weekStart}`);
console.log(`state  CTL ${f.ctl} · ATL ${f.atl} · TSB ${f.tsb} · trailing weeks [${f.last4WeeksTss.join(", ")}]`);
console.log(`\nprescription`);
console.log(`  phase     ${p.phase}`);
console.log(`  load      ${p.weekTss} TSS across ~${p.sessions} sessions`);
console.log(`  mix       swim ${Math.round(p.shares.swim * 100)}% · bike ${Math.round(p.shares.bike * 100)}% · run ${Math.round(p.shares.run * 100)}%`);
console.log(`  why       ${p.rationale}`);
console.log(`\n(actually executed that week: ${latest.targets.weekTss} TSS)\n`);
