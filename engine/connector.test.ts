import { readFileSync } from "node:fs";
import {
  emptyRateState,
  emptyResult,
  rateCheck,
  rateSpend,
  runConnector,
  syncAll,
  STRAVA_BUDGET,
  type Connector,
  type FetchResult,
} from "./connector.ts";
import {
  activityTss,
  dedupeActivities,
  executedByWeek,
  isWeekCovered,
  type Coverage,
  type ImportedActivity,
} from "./activity.ts";

/**
 * Connector + coverage + TSS tests (stages 2–3). tsx script; exit = failures.
 *
 * THE safety pin (C2/C4): a connector that throws, times out, or is
 * rate-limited yields NO coverage, the week reads as UNKNOWN, and unknown
 * never triggers a reflow. A failed TrainingPeaks fetch is not a week of
 * no training — that is the lesson carried forward from 3704e65.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const act = (o: Partial<ImportedActivity> & { startTime: string }): ImportedActivity => ({
  source: "strava",
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

const stub = (over: Partial<Connector> & { source: ImportedActivity["source"] }): Connector => ({
  label: "Stub",
  isConfigured: () => true,
  fetchActivities: async () => emptyResult(over.source, "ok"),
  ...over,
});

// ——— C1. backtest neutrality ——————————————————————————————————————————————
{
  const bt = readFileSync("engine/backtest.ts", "utf8");
  check("C1", "backtest.ts imports neither connector nor activity", !/connector|activity/.test(bt));
}

// Engine tsconfig emits CJS, so top-level await is unavailable — the async
// blocks live inside main() and the summary runs after it resolves.
async function main() {
  // ——— C2. THE safety pin: failure ⇒ unknown, never zero ————————————————————
  {
    const thrower = stub({
      source: "trainingpeaks",
      label: "TrainingPeaks",
      fetchActivities: async () => {
        throw new Error("cookie expired");
      },
    });
    const r = await runConnector(thrower, "2026-07-01");
    check("C2a", "a throwing connector yields status unavailable, not a silent empty",
      r.status === "unavailable" && r.activities.length === 0, r.status);
    check("C2b", "…and contributes NO coverage (so the week stays unknown)", r.coverage.length === 0);
    check("C2c", "…and carries the reason for the athlete", (r.message ?? "").includes("cookie"), r.message);

    const hanger = stub({
      source: "strava",
      fetchActivities: () => new Promise<FetchResult>(() => {}), // never resolves
    });
    const t = await runConnector(hanger, "2026-07-01", 50);
    check("C2d", "a hanging connector times out to unavailable", t.status === "unavailable" && t.coverage.length === 0);

    const liar = stub({
      source: "strava",
      fetchActivities: async () => ({
        source: "strava" as const,
        status: "rate-limited" as const,
        activities: [],
        coverage: [{ source: "strava" as const, from: "2026-07-01", to: "2026-07-31" }],
        attemptedAt: new Date().toISOString(),
      }),
    });
    const l = await runConnector(liar, "2026-07-01");
    check("C2e", "coverage claimed by a NON-ok result is stripped (defends the invariant)",
      l.coverage.length === 0, `${l.coverage.length}`);

    const unconfigured = stub({ source: "healthkit", isConfigured: () => false });
    const u = await runConnector(unconfigured, "2026-07-01");
    check("C2f", "an unconnected source is not-configured, distinct from a failure",
      u.status === "not-configured" && u.coverage.length === 0);
  }

  // ——— C3. unknown never triggers a reflow (end-to-end with the rollup) ————
  {
    const weekStarts = ["2026-07-06", "2026-07-13", "2026-07-20"];
    // TP fails; nothing else configured. No activities, no coverage.
    const failed = await syncAll(
      [stub({ source: "trainingpeaks", fetchActivities: async () => { throw new Error("401"); } })],
      "2026-07-01"
    );
    const mapFailed = executedByWeek(weekStarts, dedupeActivities(failed.activities), failed.coverage);
    check("C3a", "a failed sync leaves EVERY week unknown (absent from the map)",
      mapFailed.size === 0, `${mapFailed.size} entries`);
    check("C3b", "…and the summary reports degraded so the UI can say so", failed.degraded === true);

    // Now a successful sync that genuinely found nothing in one week.
    const okSync = await syncAll(
      [
        stub({
          source: "strava",
          fetchActivities: async () => ({
            source: "strava" as const,
            status: "ok" as const,
            activities: [act({ startTime: "2026-07-07T10:00:00.000Z", tss: 80 })],
            coverage: [{ source: "strava" as const, from: "2026-07-06", to: "2026-07-26" }],
            attemptedAt: new Date().toISOString(),
          }),
        }),
      ],
      "2026-07-01"
    );
    const mapOk = executedByWeek(weekStarts, dedupeActivities(okSync.activities), okSync.coverage);
    check("C3c", "a covered week with activity is authoritative and positive", mapOk.get("2026-07-06") === 80);
    check("C3d", "a covered week with NO activity is an authoritative ZERO (reflow-worthy)",
      mapOk.get("2026-07-13") === 0, String(mapOk.get("2026-07-13")));
    check("C3e", "…and a week the window never reached stays unknown",
      !mapOk.has("2026-07-27"), "2026-07-27 should be absent");
    check("C3f", "degraded is false when every configured source succeeded", okSync.degraded === false);
  }

  // ——— C4. file sources may raise a week but never authorize a zero ————————
  {
    const fileOnly: Coverage[] = []; // a dropped FIT asserts no window
    const m = executedByWeek(["2026-07-06", "2026-07-13"], [act({ source: "file", startTime: "2026-07-07T09:00:00.000Z", tss: 55 })], fileOnly);
    check("C4a", "a file raises the week it contains", m.get("2026-07-06") === 55);
    check("C4b", "…but cannot make an empty week an authoritative zero", !m.has("2026-07-13"));
  }

  // ——— C5. coverage arithmetic ——————————————————————————————————————————————
  {
    const full: Coverage[] = [{ source: "strava", from: "2026-07-06", to: "2026-07-12" }];
    check("C5a", "a window covering exactly the 7 days counts as covered", isWeekCovered(full, "2026-07-06"));
    const short: Coverage[] = [{ source: "strava", from: "2026-07-06", to: "2026-07-11" }];
    check("C5b", "a window one day short does NOT cover the week", !isWeekCovered(short, "2026-07-06"));
    const split: Coverage[] = [
      { source: "strava", from: "2026-07-06", to: "2026-07-09" },
      { source: "healthkit", from: "2026-07-10", to: "2026-07-14" },
    ];
    check("C5c", "two sources' windows union to cover a week", isWeekCovered(split, "2026-07-06"));
    check("C5d", "no coverage at all is never covered", !isWeekCovered([], "2026-07-06"));
  }

  // ——— C6. TSS reconciliation reuses the engine's IF²·100 model ——————————————
  {
    const measured = act({ startTime: "2026-07-07T10:00:00.000Z", tss: 92 });
    const m = activityTss(measured);
    check("C6a", "a source-supplied TSS is used verbatim and flagged not-estimated",
      m.tss === 92 && m.estimated === false);

    // 10 km in 50 min = 3.33 m/s against a 4.0 m/s threshold ⇒ IF 0.833
    const paced = act({ startTime: "2026-07-07T10:00:00.000Z", distanceM: 10000, durationS: 3000, movingTimeS: 3000 });
    const p = activityTss(paced, { runThresholdMps: 4.0 });
    const expected = (3000 / 3600) * Math.pow(10000 / 3000 / 4.0, 2) * 100;
    check("C6b", "pace-derived TSS matches hours·IF²·100 exactly",
      Math.abs(p.tss - Math.round(expected * 10) / 10) < 0.2, `${p.tss} vs ${expected.toFixed(1)}`);
    check("C6c", "…and is flagged as an estimate", p.estimated === true);

    const faster = activityTss(act({ startTime: "x2026-07-07T10:00:00.000Z".slice(1), distanceM: 12000, durationS: 3000, movingTimeS: 3000 }), { runThresholdMps: 4.0 });
    check("C6d", "a faster run of the same duration scores higher", faster.tss > p.tss, `${faster.tss} > ${p.tss}`);

    const hr = activityTss(act({ startTime: "2026-07-07T10:00:00.000Z", distanceM: null, durationS: 3600, avgHr: 160 }), { lthrBpm: 170 });
    check("C6e", "with no distance, heart rate drives intensity", hr.tss > 60 && hr.estimated === true, String(hr.tss));

    const bare = activityTss(act({ startTime: "2026-07-07T10:00:00.000Z", distanceM: null, durationS: 3600 }));
    check("C6f", "with neither, a conservative per-sport default is used", bare.tss > 0 && bare.tss < 70, String(bare.tss));

    const glitch = activityTss(act({ startTime: "2026-07-07T10:00:00.000Z", distanceM: 90000, durationS: 3600, movingTimeS: 3600 }), { runThresholdMps: 4.0 });
    check("C6g", "a GPS glitch cannot manufacture an absurd TSS (intensity clamped)",
      glitch.tss <= 500 && glitch.tss < 200, String(glitch.tss));
  }

  // ——— C7. rate limiting ————————————————————————————————————————————————————
  {
    let s = emptyRateState(0);
    check("C7a", "a fresh budget permits a request", rateCheck(s, STRAVA_BUDGET, 1, 0).ok);
    s = rateSpend(s, STRAVA_BUDGET, 200, 0);
    const blocked = rateCheck(s, STRAVA_BUDGET, 1, 1000);
    check("C7b", "the 200/15min short limit blocks the 201st", !blocked.ok && blocked.waitMs > 0, `${blocked.waitMs}ms`);
    const later = rateCheck(s, STRAVA_BUDGET, 1, 16 * 60 * 1000);
    check("C7c", "…and clears once the 15-minute window rolls", later.ok);
    let d = emptyRateState(0);
    d = rateSpend(d, STRAVA_BUDGET, 2000, 0);
    check("C7d", "the 2000/day limit blocks even after the short window clears",
      !rateCheck(d, STRAVA_BUDGET, 1, 16 * 60 * 1000).ok);
    check("C7e", "…and clears after the day rolls", rateCheck(d, STRAVA_BUDGET, 1, 25 * 3600 * 1000).ok);
  }

}

await_main();
function await_main() {
  void main().then(() => {
    for (const p of passes) console.log("  " + p);
    for (const f of failures) console.error("  " + f);
    console.log(`\nconnector: ${passes.length} passed, ${failures.length} failed`);
    process.exit(failures.length);
  });
}
