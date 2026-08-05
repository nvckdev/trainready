import { readFileSync } from "node:fs";
import {
  dailyExecutedTss,
  dedupeActivities,
  executedByWeek,
  mergeCandidates,
  sameActivity,
  DEDUP_WINDOW_S,
  DEDUP_DISTANCE_FRAC,
  SOURCE_PRIORITY,
  type ImportedActivity,
} from "./activity.ts";

/**
 * Activity dedup tests (stage 1). tsx script; exit code = failure count.
 *
 * Written BEFORE the implementation, per the brief. The hard part of activity
 * import is not fetching — it is that one run pushed from a watch appears in
 * TrainingPeaks, Strava and HealthKit simultaneously, and triple-counting it
 * would inflate executed load and make the reconcile engine damp a week the
 * athlete actually trained correctly.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const act = (o: Partial<ImportedActivity> & { source: ImportedActivity["source"]; startTime: string }): ImportedActivity => ({
  sport: "run",
  distanceM: 10000,
  durationS: 3000,
  movingTimeS: null,
  avgHr: null,
  elevationM: null,
  externalId: null,
  tss: null,
  ...o,
});

// ——— A1. backtest neutrality ————————————————————————————————————————————
{
  const bt = readFileSync("engine/backtest.ts", "utf8");
  check("A1", "backtest.ts does not import activity (pins stay byte-identical)", !/activity/.test(bt));
}

// ——— A2. the pair predicate ——————————————————————————————————————————————
{
  const base = act({ source: "trainingpeaks", startTime: "2026-07-20T11:00:00.000Z" });
  const within = act({ source: "strava", startTime: "2026-07-20T11:01:20.000Z" }); // +80s
  const outside = act({ source: "strava", startTime: "2026-07-20T11:02:00.000Z" }); // +120s
  check("A2a", `same activity within ±${DEDUP_WINDOW_S}s and ±${DEDUP_DISTANCE_FRAC * 100}% distance`,
    sameActivity(base, within));
  check("A2b", "outside the time window ⇒ different activities", !sameActivity(base, outside));
  const farDistance = act({ source: "strava", startTime: "2026-07-20T11:00:30.000Z", distanceM: 10500 }); // +5%
  check("A2c", "inside the time window but distance off by 5% ⇒ different", !sameActivity(base, farDistance));
  const nearDistance = act({ source: "strava", startTime: "2026-07-20T11:00:30.000Z", distanceM: 10150 }); // +1.5%
  check("A2d", "inside both windows ⇒ same", sameActivity(base, nearDistance));
  const otherSport = act({ source: "strava", startTime: "2026-07-20T11:00:30.000Z", sport: "bike" });
  check("A2e", "different sport is never the same activity", !sameActivity(base, otherSport));
}

// ——— A3. THE headline case: one run in all three sources ⇒ one activity ——
{
  const all = [
    act({ source: "healthkit", startTime: "2026-07-20T11:00:45.000Z", distanceM: 10020, durationS: 3010, avgHr: 148 }),
    act({ source: "strava", startTime: "2026-07-20T11:00:00.000Z", distanceM: 10000, durationS: 3000, elevationM: 120 }),
    act({ source: "trainingpeaks", startTime: "2026-07-20T11:01:10.000Z", distanceM: 9980, durationS: 2995, tss: 68 }),
  ];
  const out = dedupeActivities(all);
  check("A3a", "the same run in all three sources collapses to ONE", out.length === 1, `${out.length}`);
  check("A3b", "the canonical record is the TrainingPeaks one (source priority)",
    out[0]?.source === "trainingpeaks", out[0]?.source);
  check("A3c", "…and it keeps TP's TSS", out[0]?.tss === 68, String(out[0]?.tss));
  check("A3d", "richer fields from lower-priority sources are merged in, not lost",
    out[0]?.avgHr === 148 && out[0]?.elevationM === 120,
    `hr ${out[0]?.avgHr} elev ${out[0]?.elevationM}`);
  check("A3e", "the merge records every contributing source",
    (out[0]?.mergedFrom ?? []).length === 3, (out[0]?.mergedFrom ?? []).join(","));
}

// ——— A4. two genuinely different runs on the same day stay two ————————————
{
  const morning = act({ source: "strava", startTime: "2026-07-20T11:00:00.000Z", distanceM: 10000 });
  const evening = act({ source: "strava", startTime: "2026-07-20T23:00:00.000Z", distanceM: 5000, durationS: 1500 });
  const out = dedupeActivities([morning, evening]);
  check("A4a", "two runs on the same day, hours apart, stay two", out.length === 2, `${out.length}`);
  // Doubles: same day, same distance, 40 minutes apart — a real double day.
  const a = act({ source: "strava", startTime: "2026-07-20T11:00:00.000Z", distanceM: 8000 });
  const b = act({ source: "strava", startTime: "2026-07-20T11:40:00.000Z", distanceM: 8000 });
  check("A4b", "identical-distance double 40 min apart stays two", dedupeActivities([a, b]).length === 2);
}

// ——— A5. treadmill (no GPS distance) still dedups on time ————————————————
{
  const tp = act({ source: "trainingpeaks", startTime: "2026-07-21T12:00:00.000Z", distanceM: null, durationS: 2700, tss: 45 });
  const hk = act({ source: "healthkit", startTime: "2026-07-21T12:01:00.000Z", distanceM: null, durationS: 2700, avgHr: 152 });
  const out = dedupeActivities([tp, hk]);
  check("A5a", "a treadmill run with no distance in either source dedups on time", out.length === 1, `${out.length}`);
  check("A5b", "…canonical stays TrainingPeaks and gains the HR", out[0]?.source === "trainingpeaks" && out[0]?.avgHr === 152);
  // One side has distance, the other doesn't: absent distance can't refute a match.
  const withDist = act({ source: "strava", startTime: "2026-07-21T12:00:30.000Z", distanceM: 9000 });
  check("A5c", "distance known on only one side still dedups on time",
    dedupeActivities([tp, withDist]).length === 1);
  // But two treadmill runs far apart in time are still two.
  const later = act({ source: "healthkit", startTime: "2026-07-21T18:00:00.000Z", distanceM: null });
  check("A5d", "…while two distance-less runs hours apart stay two",
    dedupeActivities([tp, later]).length === 2);
}

// ——— A6. single-source activity passes through untouched ————————————————
{
  const only = act({ source: "strava", startTime: "2026-07-22T09:00:00.000Z", distanceM: 21100, durationS: 6000 });
  const out = dedupeActivities([only]);
  check("A6a", "a run present in only one source passes through", out.length === 1);
  check("A6b", "…unmodified apart from provenance",
    out[0].distanceM === 21100 && out[0].durationS === 6000 && out[0].source === "strava");
  check("A6c", "empty input yields empty output", dedupeActivities([]).length === 0);
}

// ——— A7. priority + merge rules ————————————————————————————————————————
{
  check("A7a", "priority order is TrainingPeaks > Strava > HealthKit",
    SOURCE_PRIORITY.indexOf("trainingpeaks") < SOURCE_PRIORITY.indexOf("strava") &&
      SOURCE_PRIORITY.indexOf("strava") < SOURCE_PRIORITY.indexOf("healthkit"));
  // Merge must not invent: a field absent everywhere stays absent.
  const merged = mergeCandidates([
    act({ source: "strava", startTime: "2026-07-23T10:00:00.000Z" }),
    act({ source: "healthkit", startTime: "2026-07-23T10:00:30.000Z" }),
  ]);
  check("A7b", "a field absent in every source stays null (no invention)", merged.avgHr === null && merged.tss === null);
  // A lower-priority source must never overwrite a higher-priority value.
  const conflict = mergeCandidates([
    act({ source: "trainingpeaks", startTime: "2026-07-23T10:00:00.000Z", tss: 70, avgHr: 150 }),
    act({ source: "strava", startTime: "2026-07-23T10:00:30.000Z", tss: 99, avgHr: 99 }),
  ]);
  check("A7c", "lower-priority values never overwrite higher-priority ones",
    conflict.tss === 70 && conflict.avgHr === 150, `tss ${conflict.tss} hr ${conflict.avgHr}`);
  check("A7d", "canonical startTime comes from the highest-priority source",
    conflict.startTime === "2026-07-23T10:00:00.000Z");
}

// ——— A8. THE INVARIANT the reconcile engine depends on ————————————————————
{
  // Build a messy realistic stream: 40 activities across 3 sources with heavy
  // overlap, doubles, treadmills and singles. The output must never contain
  // two activities inside the dedup window — that is what would double-count
  // executed load and make the reconcile engine damp a correctly-trained week.
  const stream: ImportedActivity[] = [];
  for (let d = 0; d < 14; d++) {
    const day = `2026-07-${String(6 + d).padStart(2, "0")}`;
    const base = `${day}T11:00:00.000Z`;
    stream.push(act({ source: "strava", startTime: base, distanceM: 10000 + d * 100 }));
    if (d % 2 === 0) stream.push(act({ source: "trainingpeaks", startTime: `${day}T11:00:50.000Z`, distanceM: 10000 + d * 100, tss: 60 + d }));
    if (d % 3 === 0) stream.push(act({ source: "healthkit", startTime: `${day}T11:01:10.000Z`, distanceM: 10050 + d * 100, avgHr: 140 + d }));
    if (d % 5 === 0) stream.push(act({ source: "strava", startTime: `${day}T18:00:00.000Z`, distanceM: 5000, durationS: 1500 }));
  }
  const out = dedupeActivities(stream);
  let violations = 0;
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (sameActivity(out[i], out[j])) violations++;
    }
  }
  check("A8a", "INVARIANT: no two activities in the deduped stream are within the dedup window",
    violations === 0, `${violations} violations across ${out.length} activities`);
  check("A8b", "…and the deduped stream is strictly fewer than the raw stream",
    out.length < stream.length, `${out.length} of ${stream.length}`);
  check("A8c", "…and is sorted chronologically",
    out.every((a, i, arr) => i === 0 || arr[i - 1].startTime <= a.startTime));
  // Idempotence: deduping an already-deduped stream changes nothing.
  check("A8d", "dedup is idempotent", dedupeActivities(out).length === out.length);
  // Order independence: the result must not depend on input ordering.
  const shuffled = [...stream].reverse();
  check("A8e", "dedup is order-independent", dedupeActivities(shuffled).length === out.length,
    `${dedupeActivities(shuffled).length} vs ${out.length}`);
}

// ——— A10. week bucketing follows the athlete's calendar, not UTC ——————————
// An 8:30 pm Sunday run in New York is 00:30 Monday UTC. Bucketed by UTC it
// migrates into the NEXT ledger week: the closed week under-counts, the new
// week over-counts, and the reconcile reads a false divergence twice.
{
  const nyish = (iso: string) => new Date(Date.parse(iso) - 4 * 3600000).toISOString().slice(0, 10);
  const sundayEvening = act({ source: "strava", startTime: "2026-07-13T00:30:00.000Z", tss: 90 });
  const weekStarts = ["2026-07-06", "2026-07-13"];
  const cov = [{ source: "strava" as const, from: "2026-07-06", to: "2026-07-19" }];

  const local = executedByWeek(weekStarts, [sundayEvening], cov, {}, undefined, nyish);
  check("A10a", "with the athlete's converter, the Sunday-evening run stays in its week",
    local.get("2026-07-06") === 90 && local.get("2026-07-13") === 0,
    `${local.get("2026-07-06")}/${local.get("2026-07-13")}`);

  const utc = executedByWeek(weekStarts, [sundayEvening], cov, {});
  check("A10b", "neutrality: without a converter the old UTC bucketing is byte-identical",
    utc.get("2026-07-13") === 90 && utc.get("2026-07-06") === 0,
    `${utc.get("2026-07-06")}/${utc.get("2026-07-13")}`);
}

// ——— A9. dailyExecutedTss: imports reach the fitness derivation ————————————
// The failure this kills: a HealthKit athlete who trains six weeks and never
// taps MARK DONE had their CTL decayed to ~37% of truth, and the reflow cut
// the plan ~60% while blaming "your current fitness".
{
  const done = new Map([
    ["2026-07-20", 70], // tapped
    ["2026-07-22", 55], // tapped
  ]);
  const imports: ImportedActivity[] = [
    // The imported twin of the tapped Jul 20 session — must NOT double-count.
    act({ source: "strava", startTime: "2026-07-20T11:00:00.000Z", tss: 78 }),
    // An import-only day the athlete never tapped — must count.
    act({ source: "strava", startTime: "2026-07-21T11:00:00.000Z", tss: 90 }),
  ];
  const map = dailyExecutedTss(done, imports);
  check("A9a", "a day with both tap and import takes the MAX, never the sum",
    map.get("2026-07-20") === 78, String(map.get("2026-07-20")));
  check("A9b", "an import-only day counts in full", map.get("2026-07-21") === 90);
  check("A9c", "a tap-only day keeps its prescribed credit", map.get("2026-07-22") === 55);
  check("A9d", "a day with neither is absent, not zero", !map.has("2026-07-23"));

  // Neutrality: with no imports the map is byte-identical to the done-marks.
  const bare = dailyExecutedTss(done, []);
  check("A9e", "no imports ⇒ byte-identical to the done-mark map",
    JSON.stringify([...bare.entries()].sort()) === JSON.stringify([...done.entries()].sort()));

  // End-to-end CTL preservation — the 60%-cut kill test. Six weeks of daily
  // 60-TSS imported training, zero taps: run the τ=42/7 recursion over the
  // merged map and over the done-only map, compare.
  const importsOnly: ImportedActivity[] = [];
  for (let d = 0; d < 42; d++) {
    const day = new Date(Date.parse("2026-06-01T11:00:00Z") + d * 86400000).toISOString();
    importsOnly.push(act({ source: "strava", startTime: day, tss: 60 }));
  }
  const merged = dailyExecutedTss(new Map(), importsOnly);
  const roll = (m: Map<string, number>) => {
    let ctl = 40;
    let atl = 40;
    for (let d = 0; d < 42; d++) {
      const day = new Date(Date.parse("2026-06-01T11:00:00Z") + d * 86400000).toISOString().slice(0, 10);
      const tss = m.get(day) ?? 0;
      ctl = ctl + (tss - ctl) / 42;
      atl = atl + (tss - atl) / 7;
    }
    return ctl;
  };
  const withImports = roll(merged);
  const withoutImports = roll(new Map());
  check("A9f", "an import-only athlete keeps their fitness (CTL ~52, not decayed to ~15)",
    withImports > 50 && withoutImports < 20, `${withImports.toFixed(1)} vs ${withoutImports.toFixed(1)}`);

  // Estimation path: an import with tss null prices through activityTss ctx.
  const est = dailyExecutedTss(new Map(), [act({ source: "strava", startTime: "2026-07-21T10:00:00.000Z", tss: null, distanceM: 12000, durationS: 3600, movingTimeS: 3600 })], { runThresholdMps: 4.0 });
  check("A9g", "a null-tss import is priced by the athlete-aware estimator",
    (est.get("2026-07-21") ?? 0) > 60, String(est.get("2026-07-21")));

  // Injectable local-date bucketing (E7 groundwork): an evening-NY run lands
  // on its NY date when the caller supplies the converter.
  const nyDate = (iso: string) => {
    const d = new Date(Date.parse(iso) - 4 * 3600000); // EDT approximation for the test
    return d.toISOString().slice(0, 10);
  };
  const evening = dailyExecutedTss(new Map(), [act({ source: "strava", startTime: "2026-07-21T00:30:00.000Z", tss: 50 })], {}, nyDate);
  check("A9h", "the caller's local-date converter buckets an evening run on its local day",
    evening.has("2026-07-20") && !evening.has("2026-07-21"));
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nactivity: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
