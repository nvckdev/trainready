import { activityTss, dedupeActivities, type ImportedActivity } from "../../engine/activity.ts";
import { importToActivity } from "./connectors";
import type { ImportedActivity as FileActivity } from "./imports-io";

/**
 * E1 pins — the file-import path must not lie to the reconcile ledger.
 *
 * Two bugs this file exists to keep dead:
 *  1. fileConnector forwarded the flat-IF tssEst, which short-circuits
 *     activityTss — a threshold hour entered the ledger at ~56 TSS instead of
 *     ~95, and a file-only week read ~40% "under plan".
 *  2. fileConnector fabricated startTime as noon UTC, so the same run
 *     uploaded as a file AND synced from Strava could never fall inside the
 *     ±90 s dedup window — the week double-counted and read ~2× over plan.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const fileAct = (o: Partial<FileActivity>): FileActivity => ({
  id: "2026-07-21T11:03:27.000Z|run",
  date: "2026-07-21",
  sport: "run",
  durationHr: 1.0,
  distanceKm: 12.0,
  avgHr: 152,
  tssEst: 56.3,
  source: "fit",
  ...o,
});

// ——— F1. the real start instant survives the mapping ——————————————————————
{
  const a = importToActivity(fileAct({}));
  check("F1a", "startTime is the instant embedded in the id, not fabricated noon",
    a.startTime === "2026-07-21T11:03:27.000Z", a.startTime);

  const malformed = importToActivity(fileAct({ id: "not-a-date|run" }));
  check("F1b", "a malformed id falls back to noon UTC of the NY date (old behavior, never a crash)",
    malformed.startTime === "2026-07-21T12:00:00.000Z", malformed.startTime);
}

// ——— F2. the flat-IF estimate never reaches the ledger ————————————————————
{
  const a = importToActivity(fileAct({}));
  check("F2a", "tss is null — the flat per-sport estimate is display-only",
    a.tss === null, String(a.tss));

  // With the athlete's threshold, the same file now prices like the same run
  // from any other source: 12 km in 1 h vs 4.0 m/s threshold ⇒ IF 0.833.
  const priced = activityTss(a, { runThresholdMps: 4.0 });
  check("F2b", "the ledger prices the file with the athlete-aware IF²·100 path",
    priced.tss > 65 && priced.estimated === true, String(priced.tss));
  check("F2c", "…which is far from the flat-IF figure the page shows as 'est'",
    Math.abs(priced.tss - 56.3) > 5, `${priced.tss} vs 56.3`);
}

// ——— F3. the file+Strava twin now collapses in dedup ——————————————————————
{
  const fromFile = importToActivity(fileAct({}));
  const fromStrava: ImportedActivity = {
    source: "strava",
    startTime: "2026-07-21T11:04:02.000Z", // 35 s later — watch vs platform clock
    sport: "run",
    distanceM: 12050,
    durationS: 3600,
    movingTimeS: 3590,
    avgHr: 151,
    elevationM: 84,
    externalId: "s1",
    tss: null,
  };
  const deduped = dedupeActivities([fromFile, fromStrava]);
  check("F3a", "the same run from file + Strava is ONE canonical activity",
    deduped.length === 1, `${deduped.length}`);
  check("F3b", "…with both sources in provenance",
    JSON.stringify(deduped[0].mergedFrom?.slice().sort()) === JSON.stringify(["file", "strava"]),
    JSON.stringify(deduped[0].mergedFrom));

  // The old fabricated-noon behavior, reproduced, must fail to dedup — this
  // is the regression the fix kills; keep it visible.
  const noonFile = { ...fromFile, startTime: "2026-07-21T12:00:00.000Z" };
  check("F3c", "control: the fabricated-noon variant double-counts (the old bug)",
    dedupeActivities([noonFile, fromStrava]).length === 2);
}

// ——— F4. field fidelity ———————————————————————————————————————————————————
{
  const a = importToActivity(fileAct({ distanceKm: null, avgHr: null }));
  check("F4a", "null distance stays null (treadmill absence is not zero)", a.distanceM === null);
  check("F4b", "null HR stays null", a.avgHr === null);
  const walk = importToActivity(fileAct({ sport: "walk" }));
  check("F4c", "walk normalizes to other", walk.sport === "other");
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nconnectors: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
