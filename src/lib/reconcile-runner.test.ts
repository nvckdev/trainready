import { readFileSync } from "node:fs";
import { generatePlan, type Plan, type PlanRequest } from "../../engine/plan.ts";
import { recomputeRemaining } from "../../engine/replan.ts";
import { reconcileGate, reflowSafeRequest } from "../../engine/reconcile.ts";
import { deriveZones } from "../../engine/zones.ts";
import { seedStateAt, type DailyPmcPoint } from "../../engine/seed.ts";
import type { AthleteState } from "../../engine/types.ts";
import { carryStatusForward, currentWeekIndex, preserveCompletedWeeks } from "./replan-auto";
import { buildLedger, type WeekActual } from "../../engine/replan.ts";

/**
 * End-to-end reconcile-runner tests (app layer — runs under app:tests, not
 * engine:tests, because it imports src/lib). Exit code = failure count.
 *
 * The gate is pinned in engine/reconcile.test.ts. This file pins the RUNNER's
 * two headline behaviors against the real engine:
 *   RR2 — a closed week with a 40% overshoot reflows and damps the next week
 *   RR3 — a closed week matching plan produces a byte-identical plan
 * plus the ledger/status plumbing the runner owns.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

function fixture() {
  try {
    const a = JSON.parse(readFileSync("data/raw/athlete.json", "utf8"));
    const lines = readFileSync("data/datasets/weekly-examples.jsonl", "utf8").split("\n").filter(Boolean);
    const history = lines.map((l) => {
      const ex = JSON.parse(l);
      return { state: ex.features as AthleteState, actualTss: ex.targets.weekTss as number, weekStart: ex.weekStart as string };
    });
    const [, ...pl] = readFileSync("data/derived/pmc.csv", "utf8").trim().split("\n");
    const series: DailyPmcPoint[] = pl.map((l) => {
      const [date, , ctl, atl] = l.split(",");
      return { date, ctl: +ctl, atl: +atl };
    });
    return {
      seed: seedStateAt(history[history.length - 1].state, series, "2026-07-13"),
      history,
      zones: deriveZones({
        ftpWatts: a.thresholds.ftpWatts,
        lthrBpm: a.thresholds.lthrBpm,
        runThresholdSpeedMps: a.thresholds.runThresholdSpeedMpsAlt ?? a.thresholds.runThresholdSpeedMps,
        swimCssMps: a.thresholds.swimCssMps,
      }),
    };
  } catch {
    return null;
  }
}

const fx = fixture();
if (!fx) {
  console.log("  RR SKIP — corpus absent");
} else {
  const { seed, history, zones } = fx;
  const REQ: PlanRequest = {
    raceName: "Runner Half",
    raceDate: "2026-10-18",
    raceType: "run-half",
    daysPerWeek: 6,
    longDay: "sunday",
    startDate: "2026-07-13",
    goalTime: "1:24:00",
  };
  const plan = generatePlan(REQ, seed, [], zones);
  const stored = { request: REQ, plan };
  const asOf = plan.weeks[3].weekStart;
  const state: AthleteState = {
    ctl: 20, atl: 22, tsb: -2,
    last4WeeksTss: [110, 120, 118, 130],
    last4Shares: { swim: 0, bike: 0.05, run: 0.95 },
    daysToNextRace: 76, weeksSinceStart: 3, breakRatio: 1, daysSinceLastSession: 1,
  };

  // ——— RR1. runner plumbing ————————————————————————————————————————————————
  {
    check("RR1a", "currentWeekIndex finds the week containing a mid-week date",
      plan.weeks[currentWeekIndex(plan.weeks, "2026-07-29")].weekStart === "2026-07-27",
      plan.weeks[currentWeekIndex(plan.weeks, "2026-07-29")].weekStart);
    const executed = new Map(plan.weeks.map((w) => [w.weekStart, w.targetTss]));
    const ledger = buildLedger(plan.weeks, asOf, executed);
    check("RR1b", "ledger covers exactly the completed weeks", ledger.length === 3, `${ledger.length}`);
    check("RR1c", "ledger rows carry planned + actual + a ramp reference",
      ledger.every((l) => l.plannedTss > 0 && l.actualTss !== null && l.actualTss > 0 && (l.rampCapTss ?? 0) > 0));
    // Status must survive a reflow — that is the athlete's log.
    const before = generatePlan(REQ, seed, [], zones);
    before.weeks[0].sessions[0].status = "done";
    const after = generatePlan(REQ, seed, [], zones);
    carryStatusForward(before, after);
    check("RR1d", "carryStatusForward preserves a done mark across a reflow",
      after.weeks[0].sessions[0].status === "done");
  }

  // ——— RR2. 40% overshoot ⇒ reflow damps the next week ————————————————————
  {
    const executed = new Map(plan.weeks.map((w) => [w.weekStart, w.targetTss]));
    executed.set(plan.weeks[2].weekStart, Math.round(plan.weeks[2].targetTss * 1.4));
    const decision = reconcileGate({
      weeks: plan.weeks,
      raceDate: REQ.raceDate,
      lastRecomputed: undefined,
      today: asOf,
      executedTssFor: (ws) => executed.get(ws),
    });
    check("RR2a", "gate is due", decision.due && decision.closedWeekStart === plan.weeks[2].weekStart);

    const r = recomputeRemaining({
      stored: { request: reflowSafeRequest(REQ, decision.asOf), plan },
      actualState: state,
      actualTrailingTss: [110, 120, 118, 130],
      ledger: buildLedger(plan.weeks, decision.asOf, executed),
      asOf: decision.asOf,
      history,
      zones,
    });
    check("RR2b", "the next week is damped below its original target",
      r.plan.weeks[0].targetTss < plan.weeks[3].targetTss,
      `${r.plan.weeks[0].targetTss} vs ${plan.weeks[3].targetTss}`);
    check("RR2c", "the engine's existing note is what gets surfaced", !!r.note, r.note ?? "none");
    check("RR2d", "the reflow still ends in a protected taper",
      r.plan.weeks.slice(-2).every((w) => w.phase === "taper" || w.phase === "race"),
      r.plan.weeks.slice(-2).map((w) => w.phase).join(","));
  }

  // ——— RR3. on-plan week ⇒ nothing fires, plan byte-identical ————————————
  {
    const executed = new Map(plan.weeks.map((w) => [w.weekStart, w.targetTss]));
    const decision = reconcileGate({
      weeks: plan.weeks,
      raceDate: REQ.raceDate,
      lastRecomputed: undefined,
      today: asOf,
      executedTssFor: (ws) => executed.get(ws),
    });
    check("RR3a", "gate refuses: within tolerance", !decision.due && decision.reason === "within-tolerance");
    const shape = (p: Plan) => JSON.stringify({ weeks: p.weeks, note: p.meta.replanNote ?? null });
    check("RR3b", "the stored plan is untouched (no write, no note, no stamp)",
      shape(plan) === shape(stored.plan) && plan.meta.replanNote === undefined && plan.meta.lastRecomputed === undefined);
  }

  // ——— RR5. history preservation (the fix for plan truncation) ——————————
  {
    const full = generatePlan(REQ, seed, [], zones);
    const reflowed = generatePlan({ ...REQ, startDate: full.weeks[3].weekStart }, seed, [], zones);
    const before = reflowed.weeks.length;
    preserveCompletedWeeks(full, reflowed);
    check("RR5a", "completed weeks are re-attached after a reflow",
      reflowed.weeks.length === before + 3, `${before} -> ${reflowed.weeks.length}`);
    check("RR5b", "…chronological, no duplicates",
      reflowed.weeks.every((x, i, arr) => i === 0 || arr[i - 1].weekStart < x.weekStart));
    const led2 = buildLedger(reflowed.weeks, reflowed.weeks[4].weekStart, new Map(reflowed.weeks.map((x) => [x.weekStart, x.targetTss])));
    check("RR5c", "…so the ledger keeps multi-week history (2-undershoot recalibration stays reachable)",
      led2.length >= 2, `${led2.length} rows`);
  }

  // ——— RR6. a zero-executed week must not disable forced recovery ————————
  {
    const executed = new Map(plan.weeks.map((w) => [w.weekStart, w.targetTss]));
    executed.set(plan.weeks[0].weekStart, 0);
    const ledger = buildLedger(plan.weeks, asOf, executed);
    check("RR6", "rampCapTss stays positive after a zero-executed week",
      ledger.every((l) => (l.rampCapTss ?? 0) > 0), ledger.map((l) => l.rampCapTss).join(","));
  }

  // ——— RR4. idempotence: a second visit the same week does nothing ————————
  {
    const executed = new Map(plan.weeks.map((w) => [w.weekStart, w.targetTss]));
    executed.set(plan.weeks[2].weekStart, Math.round(plan.weeks[2].targetTss * 1.4));
    const second = reconcileGate({
      weeks: plan.weeks,
      raceDate: REQ.raceDate,
      lastRecomputed: asOf, // stamped by the first reconcile
      today: asOf,
      executedTssFor: (ws) => executed.get(ws),
    });
    check("RR4", "already reconciled this week ⇒ refuses (no churn on every page view)",
      !second.due && second.reason === "already-reconciled", second.reason);
  }
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nreconcile-runner: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
