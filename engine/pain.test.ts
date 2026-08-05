import {
  isPainEntry,
  isPainHeld,
  surfaceAlerts,
  upsertPainEntry,
  weeklyPainAverages,
  type PainEntry,
} from "./pain.ts";

/**
 * The pain log's rules, tested where they now live.
 *
 * They were dashboard-only (src/lib/pain-rules.ts) and had no direct test —
 * their only coverage was indirectly, through tissue-constraints.test.ts. Now
 * that mobile writes the same log and applies the same rules, an untested
 * shared rule would be a defect on two surfaces at once, so they are pinned
 * here against the exact thresholds docs/strength-module.md §4 promises.
 *
 * Every alert is a claim about an athlete's body that changes what the plan
 * prescribes, so each threshold is tested from BOTH sides — one below the bar
 * must stay silent, or the feature cries wolf and gets ignored on the day it
 * matters.
 *
 * tsx harness; exit code = failure count.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const TODAY = "2026-08-05";
const e = (date: string, score: number, context: PainEntry["context"] = "after-session"): PainEntry => ({
  date,
  region: "calf-achilles",
  score0to10: score,
  context,
});

// ——— P1. rule 1: three consecutive days at 4+ ————————————————————————————
{
  const hit = surfaceAlerts([e("2026-08-03", 4), e("2026-08-04", 4), e("2026-08-05", 4)], TODAY);
  check("P1a", "three consecutive days at 4/10 raises the consecutive rule",
    hit.length === 1 && hit[0].rule === "consecutive", hit.map((a) => a.rule).join(","));
  const three = surfaceAlerts([e("2026-08-03", 3), e("2026-08-04", 5), e("2026-08-05", 5)], TODAY);
  check("P1b", "…and one day below the bar does not — 4 is the threshold, not 3",
    !three.some((a) => a.rule === "consecutive"), three.map((a) => a.rule).join(","));
  const gap = surfaceAlerts([e("2026-08-02", 6), e("2026-08-03", 6), e("2026-08-05", 6)], TODAY);
  check("P1c", "a missing day breaks the streak — silence is not a 0",
    !gap.some((a) => a.rule === "consecutive"), gap.map((a) => a.rule).join(","));
  // The window may end yesterday: someone who has not logged yet this morning
  // is still three days into a flare.
  const yesterday = surfaceAlerts([e("2026-08-02", 5), e("2026-08-03", 5), e("2026-08-04", 5)], TODAY);
  check("P1d", "a streak ending yesterday still alerts (today may be unlogged)",
    yesterday.some((a) => a.rule === "consecutive"), yesterday.map((a) => a.rule).join(","));
  const stale = surfaceAlerts([e("2026-08-01", 5), e("2026-08-02", 5), e("2026-08-03", 5)], TODAY);
  check("P1e", "…but a streak that ended two days ago does not",
    !stale.some((a) => a.rule === "consecutive"), stale.map((a) => a.rule).join(","));
}

// ——— P2. rule 2: pain at rest ————————————————————————————————————————————
{
  const hit = surfaceAlerts([e("2026-08-04", 3, "at-rest")], TODAY);
  check("P2a", "3/10 AT REST alerts — a lower bar than loading pain, deliberately",
    hit.length === 1 && hit[0].rule === "at-rest", hit.map((a) => a.rule).join(","));
  const loading = surfaceAlerts([e("2026-08-04", 3, "during-session")], TODAY);
  check("P2b", "…while the same 3/10 during a session does not",
    loading.length === 0, loading.map((a) => a.rule).join(","));
  const old = surfaceAlerts([e("2026-07-20", 8, "at-rest")], TODAY);
  check("P2c", "an at-rest reading outside the 7-day window has expired",
    old.length === 0, old.map((a) => a.rule).join(","));
}

// ——— P3. rule 3: a rising week ————————————————————————————————————————————
{
  const rising = surfaceAlerts([e("2026-08-01", 1), e("2026-08-03", 2), e("2026-08-05", 3)], TODAY);
  check("P3a", "a climbing week alerts on trend", rising.some((a) => a.rule === "rising-trend"),
    rising.map((a) => a.rule).join(","));
  const flat = surfaceAlerts([e("2026-08-01", 3), e("2026-08-03", 3), e("2026-08-05", 3)], TODAY);
  check("P3b", "a flat week does not — the slope test needs a rise", flat.length === 0,
    flat.map((a) => a.rule).join(","));
  const noisy = surfaceAlerts([e("2026-08-01", 2), e("2026-08-03", 1), e("2026-08-05", 3)], TODAY);
  check("P3c", "a 1-point wobble does not — the level test filters noise",
    !noisy.some((a) => a.rule === "rising-trend"), noisy.map((a) => a.rule).join(","));
  const twoPoints = surfaceAlerts([e("2026-08-01", 1), e("2026-08-05", 5)], TODAY);
  check("P3d", "two data points are not a trend", twoPoints.length === 0, twoPoints.map((a) => a.rule).join(","));
}

// ——— P4. precedence and scope ————————————————————————————————————————————
{
  const both = surfaceAlerts(
    [e("2026-08-03", 6), e("2026-08-04", 6), e("2026-08-05", 6, "at-rest")],
    TODAY
  );
  check("P4a", "at most one alert per region, strongest rule first",
    both.length === 1 && both[0].rule === "consecutive", both.map((a) => a.rule).join(","));
  const twoRegions = surfaceAlerts(
    [
      e("2026-08-04", 5, "at-rest"),
      { date: "2026-08-04", region: "knee", score0to10: 5, context: "at-rest" },
    ],
    TODAY
  );
  check("P4b", "regions alert independently", twoRegions.length === 2,
    twoRegions.map((a) => a.region).join(","));
  const future = surfaceAlerts([e("2026-08-09", 9, "at-rest")], TODAY);
  check("P4c", "an entry dated after today is ignored, never read forward",
    future.length === 0, future.map((a) => a.rule).join(","));
  check("P4d", "an empty log is silent", surfaceAlerts([], TODAY).length === 0);
}

// ——— P5. the scheduler hold ———————————————————————————————————————————————
{
  const alerts = surfaceAlerts([e("2026-08-04", 5, "at-rest")], TODAY);
  check("P5a", "a protocol targeting the alerted region is held",
    isPainHeld({ targets: ["calf-achilles"] }, alerts));
  check("P5b", "…but rehab work is exempt — that is the work that helps",
    !isPainHeld({ rehab: true, targets: ["calf-achilles"] }, alerts));
  check("P5c", "an unrelated protocol runs", !isPainHeld({ targets: ["shoulder"] }, alerts));
  check("P5d", "a protocol with no targets is never held", !isPainHeld({}, alerts));
}

// ——— P6. weekly averages for the load/pain chart —————————————————————————
{
  const avgs = weeklyPainAverages([e("2026-08-03", 4), e("2026-08-05", 6)], ["2026-08-03", "2026-08-10"]);
  check("P6a", "a week's average is the mean of its daily maxima", avgs[0] === 5, String(avgs[0]));
  check("P6b", "a week with NO entries is null, never 0 — no data is not no pain",
    avgs[1] === null, String(avgs[1]));
  const sameDay = weeklyPainAverages([e("2026-08-03", 2), e("2026-08-03", 7, "at-rest")], ["2026-08-03"]);
  check("P6c", "two entries on one day count once, at the worst of them",
    sameDay[0] === 7, String(sameDay[0]));
}

// ——— P7. entry hygiene — mobile and dashboard write the same series ————————
{
  const log = [e("2026-08-05", 3)];
  const up = upsertPainEntry(log, e("2026-08-05", 6));
  check("P7a", "re-logging the same day/region/context overwrites rather than doubling",
    up.length === 1 && up[0].score0to10 === 6, JSON.stringify(up));
  const other = upsertPainEntry(log, e("2026-08-05", 6, "at-rest"));
  check("P7b", "…while a different context is a separate reading",
    other.length === 2, String(other.length));
  const sorted = upsertPainEntry([e("2026-08-05", 3)], e("2026-08-01", 2));
  check("P7c", "the series stays in date order", sorted[0].date === "2026-08-01",
    sorted.map((x) => x.date).join(","));
  // A pain log FILTERS bad rows rather than refusing the file — the opposite
  // of the declaration boundary, and deliberately so: a bad pain row costs one
  // data point, a dropped declaration costs a safety cap.
  check("P7d", "a well-formed entry validates", isPainEntry(e("2026-08-05", 3)));
  const bad: unknown[] = [
    { ...e("2026-08-05", 3), region: "elbow" },
    { ...e("2026-08-05", 3), context: "whenever" },
    { ...e("2026-08-05", 3), score0to10: "3" },
    { ...e("2026-08-05", 3), date: 20260805 },
    null,
    "calf",
  ];
  check("P7e", `malformed rows are rejected by the shape guard (${bad.length} shapes)`,
    bad.every((x) => !isPainEntry(x)), bad.filter((x) => isPainEntry(x)).length + " leaked");
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\npain: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
