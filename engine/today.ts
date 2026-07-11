import { readFileSync } from "node:fs";
import { join } from "node:path";
import { referenceEngine } from "./reference.ts";
import type { AthleteState } from "./types.ts";

/** Prints the engine's prescription for the coming week from current state. */

const ROOT = process.cwd();
const lines = readFileSync(join(ROOT, "data/datasets/weekly-examples.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean);
const latest = JSON.parse(lines[lines.length - 1]) as {
  weekStart: string;
  features: AthleteState;
  targets: { weekTss: number };
};

const p = referenceEngine.prescribeWeek(latest.features);
const f = latest.features;

console.log(`\nTAPER · ${referenceEngine.name} · week of ${latest.weekStart}`);
console.log(`state  CTL ${f.ctl} · ATL ${f.atl} · TSB ${f.tsb} · trailing weeks [${f.last4WeeksTss.join(", ")}]`);
console.log(`\nprescription`);
console.log(`  phase     ${p.phase}`);
console.log(`  load      ${p.weekTss} TSS across ~${p.sessions} sessions`);
console.log(`  mix       swim ${Math.round(p.shares.swim * 100)}% · bike ${Math.round(p.shares.bike * 100)}% · run ${Math.round(p.shares.run * 100)}%`);
console.log(`  why       ${p.rationale}`);
console.log(`\n(actually executed that week: ${latest.targets.weekTss} TSS)\n`);
