import { normalize } from "./lib/normalize.ts";
import { derive } from "./lib/derive.ts";
import { labelRaces } from "./lib/label.ts";
import { buildDatasets } from "./lib/dataset.ts";
import { validate } from "./lib/validate.ts";

const stage = process.argv[2] ?? "all";

const { sessions, planned, stats } = normalize();
console.log("normalize:", JSON.stringify(stats));
if (stage === "normalize") process.exit(0);

const { daily, pmc, weekly } = derive(sessions);
console.log(`derive: ${daily.length} days, ${weekly.length} weeks, pmc ${pmc.length} points`);
if (stage === "derive") process.exit(0);

const races = labelRaces(sessions, pmc);
console.log(`label: ${races.length} race days`);
if (stage === "label") process.exit(0);

const datasetStats = buildDatasets(sessions, planned, weekly, pmc, races);
console.log("dataset:", JSON.stringify(datasetStats));
if (stage === "dataset") process.exit(0);

validate(sessions, weekly, pmc, races, stats, datasetStats);
console.log("validate: wrote data/reports/phase0.md");
