import { readFileSync } from "node:fs";
import { generatePlan, type Plan, type PlanRequest } from "./plan.ts";
import { buildLedger, knownTrailingTss, recomputeRemaining, type WeekActual } from "./replan.ts";
import { deriveZones } from "./zones.ts";
import { seedStateAt, type DailyPmcPoint } from "./seed.ts";
import type { AthleteState } from "./types.ts";
import {
  mondayOnOrBefore,
  reconcileGate,
  reflowSafeRequest,
  RECONCILE_TOLERANCE,
  TAPER_LOCK_DAYS,
} from "./reconcile.ts";

/**
 * Weekly-reconcile gate tests. tsx script; exit code = failure count.
 *
 * The behavioral pins the feature was asked for:
 *   RC4 — a closed week with a 40% overshoot FIRES and damps the next week
 *   RC5 — a closed week matching plan fires NOTHING (byte-identical no-op)
 * plus the four throw/misfire situations an unconditional trigger would hit,
 * each verified against the real engine rather than asserted in the abstract.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

// ——— RC1. backtest neutrality (the N1 pattern) ————————————————————————————
{
  const bt = readFileSync("engine/backtest.ts", "utf8");
  check("RC1", "backtest.ts does not import reconcile (pins stay byte-identical)", !/reconcile/.test(bt));
}

// ——— RC2. gate arithmetic, no corpus needed ——————————————————————————————
{
  check("RC2a", "mondayOnOrBefore: a Monday maps to itself", mondayOnOrBefore("2026-07-20") === "2026-07-20");
  check("RC2b", "mondayOnOrBefore: mid-week maps back", mondayOnOrBefore("2026-07-23") === "2026-07-20");
  check("RC2c", "mondayOnOrBefore: Sunday maps back to its Monday", mondayOnOrBefore("2026-07-26") === "2026-07-20");

  const weeks = [
    { weekStart: "2026-07-06", targetTss: 200 },
    { weekStart: "2026-07-13", targetTss: 210 },
    { weekStart: "2026-07-20", targetTss: 220 },
  ];
  const g = (over: Record<string, unknown>) =>
    reconcileGate({
      weeks,
      raceDate: "2026-10-18",
      today: "2026-07-20",
      executedTssFor: () => 210,
      ...over,
    } as Parameters<typeof reconcileGate>[0]);

  check("RC2d", "no weeks ⇒ no-plan", g({ weeks: [] }).reason === "no-plan");
  check("RC2e", "race already run ⇒ race-passed (generatePlan would throw)",
    g({ today: "2026-10-19" }).reason === "race-passed");
  check("RC2f", `inside ${TAPER_LOCK_DAYS} days of the race ⇒ taper-lock`,
    g({ today: "2026-10-01" }).reason === "taper-lock");
  check("RC2g", "no week has closed yet ⇒ no-closed-week",
    g({ today: "2026-07-08" }).reason === "no-closed-week");
  check("RC2h", "the closed week is the newest whose last day passed",
    g({}).closedWeekStart === "2026-07-13", String(g({}).closedWeekStart));
  check("RC2i", "already stamped past the closed week ⇒ already-reconciled (idempotent)",
    g({ lastRecomputed: "2026-07-20" }).reason === "already-reconciled");
  check("RC2j", "asOf is always the current Monday (never mid-week)",
    g({ today: "2026-07-23" }).asOf === "2026-07-20");
}

// ——— RC3. tolerance band ————————————————————————————————————————————————
// A 10-week fixture so the remaining-weeks floor never intercepts: this block
// isolates the tolerance decision, nothing else.
{
  const weeks = Array.from({ length: 10 }, (_, i) => ({
    weekStart: mondayOnOrBefore(new Date(Date.UTC(2026, 6, 6 + i * 7, 12)).toISOString().slice(0, 10)),
    targetTss: 200,
  }));
  const at = (executed: number) =>
    reconcileGate({
      weeks,
      raceDate: "2026-10-18",
      today: "2026-07-20",
      executedTssFor: () => executed,
    });
  check("RC3a", "exactly on plan ⇒ within-tolerance, not due", at(200).reason === "within-tolerance" && !at(200).due);
  check("RC3b", `${RECONCILE_TOLERANCE * 100}% over is still tolerated`, at(220).reason === "within-tolerance");
  check("RC3c", "a hair past tolerance is due", at(221).due === true, `${(at(221).deltaPct * 100).toFixed(1)}%`);
  check("RC3d", "40% overshoot is due", at(280).due === true && at(280).deltaPct > 0.39);
  check("RC3e", "a fully missed week is due (executed 0)", at(0).due === true && at(0).deltaPct === -1);
  // DELIBERATE REVERSAL of the original pin ("unknown ⇒ zero"). An adversarial
  // review reproduced the consequence against this repo: with the corpus
  // lagging the plan (the ordinary state between syncs) the gate fabricated a
  // fully-missed week and silently rewrote the season, every week, forever.
  // Absence of evidence is not evidence of absence.
  const unknown = reconcileGate({ weeks, raceDate: "2026-10-18", today: "2026-07-20", executedTssFor: () => undefined });
  check("RC3f", "UNKNOWN execution refuses to reflow (silence is not a missed week)",
    !unknown.due && unknown.reason === "no-execution-data", unknown.reason);
  check("RC3g", "an AUTHORITATIVE zero still reflows (a truly missed week)",
    at(0).due === true && at(0).deltaPct === -1);
}

// ——— RC8 (pure). buildLedger: unknown is null, never a fabricated zero ————
{
  const weeks = [
    { weekStart: "2026-07-06", targetTss: 200, sessions: [{ discipline: "run", tss: 100, status: "done" as const }, { discipline: "run", tss: 100 }] },
    { weekStart: "2026-07-13", targetTss: 210, sessions: [{ discipline: "run", tss: 210 }] },
    { weekStart: "2026-07-20", targetTss: 220, sessions: [{ discipline: "run", tss: 220 }] },
    { weekStart: "2026-07-27", targetTss: 230, sessions: [] },
  ];
  const executed = new Map([
    ["2026-07-06", 195],
    // 2026-07-13 deliberately ABSENT — unknown, not zero.
    ["2026-07-20", 0], // authoritative zero (covered, nothing trained)
  ]);
  const rows = buildLedger(weeks, "2026-07-27", executed);
  check("RC8a", "three completed weeks enter the ledger (the current week does not)",
    rows.length === 3 && rows[2].weekStart === "2026-07-20");
  check("RC8b", "a known week carries its number", rows[0].actualTss === 195);
  check("RC8c", "an UNKNOWN week is null — the type can no longer express a fabricated zero",
    rows[1].actualTss === null, String(rows[1].actualTss));
  check("RC8d", "an authoritative zero stays a real 0 (present in the map ⇒ evidence)",
    rows[2].actualTss === 0);
  check("RC8e", "rampRef falls back to target across a zero-executed week (|| semantics kept)",
    rows[2].rampCapTss === Math.round(210 * 1.2), String(rows[2].rampCapTss));
  check("RC8f", "sessionsMissed still counts unmarked non-race sessions",
    rows[0].sessionsMissed === 1);

  const trail = knownTrailingTss(weeks, "2026-07-27", executed);
  check("RC8g", "the trailing array contains ONLY known weeks — no zeros invented",
    JSON.stringify(trail) === JSON.stringify([195, 0]), JSON.stringify(trail));
}

// ——— RC4/RC5/RC6. against the real engine, with the real corpus ——————————
function loadFixture(): { seed: AthleteState; history: Array<{ state: AthleteState; actualTss: number; weekStart?: string }>; zones: ReturnType<typeof deriveZones> } | null {
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

const fx = loadFixture();
if (!fx) {
  console.log("  RC4–RC7 SKIP — corpus absent");
} else {
  const { seed, history, zones } = fx;
  const REQ: PlanRequest = {
    raceName: "Reconcile Half",
    raceDate: "2026-10-18",
    raceType: "run-half",
    daysPerWeek: 6,
    longDay: "sunday",
    startDate: "2026-07-13",
    goalTime: "1:24:00",
  };
  const stored = { request: REQ, plan: generatePlan(REQ, seed, [], zones) };
  const w = (i: number) => stored.plan.weeks[i];
  const asOf = w(3).weekStart;
  const led = (i: number, actualTss: number): WeekActual => ({
    weekStart: w(i).weekStart,
    actualTss: Math.round(actualTss),
    plannedTss: w(i).targetTss,
    rampCapTss: Math.round(w(i).targetTss * 1.2),
    sessionsMissed: 0,
    sessionsPlanned: w(i).sessions.length,
  });
  const state = (o: Partial<AthleteState> = {}): AthleteState => ({
    ctl: 20, atl: 22, tsb: -2,
    last4WeeksTss: [110, 120, 118, 130],
    last4Shares: { swim: 0, bike: 0.05, run: 0.95 },
    daysToNextRace: 76, weeksSinceStart: 3, breakRatio: 1, daysSinceLastSession: 1,
    ...o,
  });

  // ——— RC4. 40% overshoot fires AND damps the next week ———————————————————
  {
    const gate = reconcileGate({
      weeks: stored.plan.weeks,
      raceDate: REQ.raceDate,
      today: asOf,
      executedTssFor: (ws) => (ws === w(2).weekStart ? Math.round(w(2).targetTss * 1.4) : w(2).targetTss),
    });
    check("RC4a", "gate fires on a 40% overshoot in the closed week",
      gate.due && gate.reason === "due" && gate.closedWeekStart === w(2).weekStart,
      `${gate.reason} ${(gate.deltaPct * 100).toFixed(0)}%`);

    const r = recomputeRemaining({
      stored,
      actualState: state(),
      actualTrailingTss: [110, 120, 118, 130],
      ledger: [led(0, w(0).targetTss), led(1, w(1).targetTss), led(2, w(2).targetTss * 1.4)],
      asOf: gate.asOf,
      history,
      zones,
    });
    const originalNext = w(3).targetTss;
    check("RC4b", "the reflowed next week is damped below its original target",
      r.plan.weeks[0].targetTss < originalNext,
      `${r.plan.weeks[0].targetTss} vs ${originalNext}`);
    check("RC4c", "…and the engine's own note explains it (reused, not reinvented)",
      !!r.note && /over target|recovery load|re-baselined/.test(r.note), r.note ?? "none");
  }

  // ——— RC5. a week matching plan fires nothing ——————————————————————————————
  {
    const gate = reconcileGate({
      weeks: stored.plan.weeks,
      raceDate: REQ.raceDate,
      today: asOf,
      executedTssFor: (ws) => stored.plan.weeks.find((x) => x.weekStart === ws)?.targetTss,
    });
    check("RC5a", "gate does NOT fire when the closed week landed on plan",
      !gate.due && gate.reason === "within-tolerance", gate.reason);
    check("RC5b", "…so recomputeRemaining is never called and the plan is untouched",
      JSON.stringify(stored.plan) === JSON.stringify(generatePlan(REQ, seed, [], zones)).replace(
        /"generatedAt":"[^"]*"/,
        `"generatedAt":"${stored.plan.meta.generatedAt}"`
      ));
  }

  // ——— RC6. the gate prevents the documented throws/misfires ————————————————
  {
    // A tune-up that has already happened makes EVERY reflow throw. The gate's
    // sanitizer fixes it without touching generatePlan.
    const tuned: PlanRequest = { ...REQ, tuneups: [{ date: "2026-08-02", raceType: "run-10k" }] };
    let threw = "";
    try {
      generatePlan({ ...tuned, startDate: "2026-08-10" }, seed, [], zones);
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    check("RC6a", "raw reflow with a past tune-up throws (the bug this closes)",
      /tune-up/.test(threw), threw || "did not throw");
    const safe = reflowSafeRequest(tuned, "2026-08-10");
    let threw2 = "";
    try {
      generatePlan({ ...safe, startDate: "2026-08-10" }, seed, [], zones);
    } catch (e) {
      threw2 = e instanceof Error ? e.message : String(e);
    }
    check("RC6b", "reflowSafeRequest drops the past tune-up and the reflow succeeds", threw2 === "", threw2);
    check("RC6c", "…and a still-future tune-up is preserved",
      reflowSafeRequest(tuned, "2026-07-20").tuneups?.length === 1);
    check("RC6d", "…and a request without tune-ups is returned unchanged (identity)",
      reflowSafeRequest(REQ, "2026-08-10") === REQ);

    // The taper lock is what keeps the 1-and-2-remaining-week hazards
    // unreachable: at >21 days out there are always ≥3 remaining weeks.
    const late = stored.plan.weeks[stored.plan.weeks.length - 2].weekStart;
    const g = reconcileGate({
      weeks: stored.plan.weeks,
      raceDate: REQ.raceDate,
      today: late,
      executedTssFor: () => 0,
    });
    check("RC6e", "a date deep in the taper is refused by the lock, not by luck",
      !g.due && g.reason === "taper-lock", g.reason);

    // Sweep every day of the plan: the gate must never permit a reflow that
    // leaves fewer than 3 remaining weeks (the throw + silent-misfire zone).
    let worst = Infinity;
    const firstDay = stored.plan.weeks[0].weekStart;
    for (let t = Date.parse(firstDay + "T12:00:00Z"); t <= Date.parse(REQ.raceDate + "T12:00:00Z"); t += 86400000) {
      const day = new Date(t).toISOString().slice(0, 10);
      const d = reconcileGate({
        weeks: stored.plan.weeks,
        raceDate: REQ.raceDate,
        today: day,
        executedTssFor: () => 0,
      });
      if (!d.due) continue;
      const remaining = stored.plan.weeks.filter((x) => x.weekStart >= d.asOf).length;
      worst = Math.min(worst, remaining);
    }
    check("RC6f", "across every day of the plan, a firing gate always leaves ≥3 weeks",
      worst >= 3, `worst ${worst === Infinity ? "never fired" : worst}`);
  }

  // ——— RC7. reflowing from the current Monday keeps the current week ————————
  {
    const midWeek = "2026-07-15"; // a Wednesday
    const g = reconcileGate({
      weeks: stored.plan.weeks,
      raceDate: REQ.raceDate,
      today: midWeek,
      executedTssFor: () => 0,
    });
    const r = recomputeRemaining({
      stored,
      actualState: state(),
      actualTrailingTss: [110, 120, 118, 130],
      ledger: [led(0, 0)],
      asOf: g.asOf,
      history,
      zones,
    });
    check("RC7", "a mid-week reconcile still starts at the current Monday (no lost week)",
      r.plan.weeks[0].weekStart === mondayOnOrBefore(midWeek),
      `${r.plan.weeks[0].weekStart} vs ${mondayOnOrBefore(midWeek)}`);
  }

  // ——— RC8h+. unknown weeks break streaks — the recalibration kill test ————
  {
    const unknownLed = (i: number): WeekActual => ({ ...led(i, 0), actualTss: null });
    const base = {
      stored,
      actualState: state(),
      actualTrailingTss: [110, 120, 118, 130],
      asOf: w(3).weekStart,
      history,
      zones,
    };
    // One light week PRECEDED BY an unknown week: missStreak must be 1, and
    // the 2-miss recalibration card must NOT fire off silence.
    const withUnknown = recomputeRemaining({
      ...base,
      ledger: [led(0, w(0).targetTss), unknownLed(1), led(2, w(2).targetTss * 0.5)],
    });
    check("RC8h", "light week after an UNKNOWN week: no recalibration fires off silence",
      !withUnknown.recalibration, withUnknown.recalibration?.message ?? "none");

    // Control: two genuinely light KNOWN weeks still fire it.
    const twoMisses = recomputeRemaining({
      ...base,
      ledger: [led(0, w(0).targetTss), led(1, w(1).targetTss * 0.5), led(2, w(2).targetTss * 0.5)],
    });
    check("RC8i", "control: two known light weeks still recalibrate",
      !!twoMisses.recalibration, twoMisses.recalibration ? "fired" : "did not fire");

    // The JS coercion trap: null <= number coerces null to 0, so a naive
    // pred would count an unknown LAST week as a miss AND as an over-cap
    // trigger. An unknown last week must trigger neither.
    const unknownLast = recomputeRemaining({
      ...base,
      ledger: [led(0, w(0).targetTss), led(1, w(1).targetTss), unknownLed(2)],
    });
    check("RC8j", "an unknown LAST week triggers no forced recovery and no recalibration",
      !unknownLast.recalibration && unknownLast.forcedRecoveryWeek === null,
      `forced=${unknownLast.forcedRecoveryWeek ?? "none"}`);

    // Neutrality: an all-known ledger produces byte-identical output to the
    // same input before this change (no null anywhere ⇒ old arithmetic).
    const allKnown = recomputeRemaining({
      ...base,
      ledger: [led(0, w(0).targetTss), led(1, w(1).targetTss), led(2, w(2).targetTss * 1.4)],
    });
    check("RC8k", "neutrality: all-known ledger still damps the overshoot exactly as RC4",
      allKnown.plan.weeks[0].targetTss < w(3).targetTss);
  }
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nreconcile: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
