import { existsSync, readFileSync } from "node:fs";
import { generatePlan, type PlanRequest } from "./plan.ts";
import { seedStateAt, type DailyPmcPoint } from "./seed.ts";
import { deriveZones } from "./zones.ts";
import type { AthleteState } from "./types.ts";
import { recomputeRemaining, type ReplanInput, type StoredPlan, type WeekActual } from "./replan.ts";

/**
 * Adaptive re-plan acceptance tests (tsx; exit code = failure count). Skips
 * gracefully when the corpus is absent (the reflow needs a real seed/zones).
 * Named cases from the request: overshoot-forces-recovery, 3×overshoot-
 * rebaselines-up, 2×undershoot-triggers-recalibration-card, taper-never-
 * compressed — plus undershoot-no-redistribution, single-miss-silent, and
 * backtest-neutrality.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

// Backtest neutrality is a static property — checkable without the corpus.
{
  const bt = readFileSync("engine/backtest.ts", "utf8");
  check("N1", "backtest.ts does not import replan (pins stay byte-identical)", !/replan/.test(bt));
}

const REQ: PlanRequest = {
  raceName: "Toronto Waterfront Half",
  raceDate: "2026-10-18",
  raceType: "run-half",
  daysPerWeek: 6,
  longDay: "sunday",
  startDate: "2026-07-13",
  goalTime: "1:24:00",
};

function loadFixture(): { seed: AthleteState; history: ReplanInput["history"]; zones: ReturnType<typeof deriveZones> } | null {
  if (!existsSync("data/datasets/weekly-examples.jsonl") || !existsSync("data/derived/pmc.csv")) return null;
  const a = JSON.parse(readFileSync("data/raw/athlete.json", "utf8"));
  const lines = readFileSync("data/datasets/weekly-examples.jsonl", "utf8").split("\n").filter(Boolean);
  const history = lines.map((l) => {
    const ex = JSON.parse(l);
    return { state: ex.features as AthleteState, actualTss: ex.targets.weekTss as number, weekStart: ex.weekStart as string };
  });
  const base = history[history.length - 1].state;
  const [, ...pl] = readFileSync("data/derived/pmc.csv", "utf8").trim().split("\n");
  const series: DailyPmcPoint[] = pl.map((l) => {
    const [date, , ctl, atl] = l.split(",");
    return { date, ctl: +ctl, atl: +atl };
  });
  const seed = seedStateAt(base, series, "2026-07-13");
  const zones = deriveZones({
    ftpWatts: a.thresholds.ftpWatts,
    lthrBpm: a.thresholds.lthrBpm,
    runThresholdSpeedMps: a.thresholds.runThresholdSpeedMpsAlt ?? a.thresholds.runThresholdSpeedMps,
    swimCssMps: a.thresholds.swimCssMps,
  });
  return { seed, history, zones };
}

const fx = loadFixture();
if (!fx) {
  console.log("  T1–T7 SKIP — corpus absent (reflow needs a real seed)");
} else {
  const { history, zones } = fx;
  const stored: StoredPlan = { request: REQ, plan: generatePlan(REQ, fx.seed, history, zones) };

  // Re-plan from the 4th plan week; weeks 0–2 are "completed".
  const asOf = stored.plan.weeks[3].weekStart;
  const w = (i: number) => stored.plan.weeks[i];

  const state = (o: Partial<AthleteState>): AthleteState => ({
    ctl: 20, atl: 22, tsb: -2, last4WeeksTss: [110, 120, 118, 130],
    last4Shares: { swim: 0, bike: 0.05, run: 0.95 },
    daysToNextRace: 76, weeksSinceStart: 3, breakRatio: 1, daysSinceLastSession: 1, ...o,
  });

  const mkInput = (o: { actualState?: Partial<AthleteState>; actualTrailingTss?: number[]; ledger: WeekActual[] }): ReplanInput => ({
    stored,
    actualState: state(o.actualState ?? {}),
    actualTrailingTss: o.actualTrailingTss ?? [110, 120, 118, 130],
    ledger: o.ledger,
    asOf,
    history,
    zones,
  });

  const led = (i: number, actualTss: number, opts: Partial<WeekActual> = {}): WeekActual => ({
    weekStart: w(i).weekStart,
    actualTss,
    plannedTss: w(i).targetTss,
    sessionsMissed: opts.sessionsMissed ?? 0,
    sessionsPlanned: w(i).sessions.length,
    ...opts,
  });

  // ——— T1. overshoot-forces-recovery ———————————————————————————————
  {
    // Last completed week ran hard over its ramp ceiling.
    const cap = w(2).targetTss;
    const r = recomputeRemaining(mkInput({
      actualState: { ctl: 20 },
      ledger: [led(0, w(0).targetTss), led(1, w(1).targetTss), led(2, cap * 1.5, { rampCapTss: cap })],
    }));
    const first = r.plan.weeks[0];
    check("T1a", "over-cap week ⇒ forcedRecoveryWeek set", r.forcedRecoveryWeek === first.weekStart, String(r.forcedRecoveryWeek));
    check("T1b", "forced week ≤ maintenance (ctl×7 = 140) and phase recovery",
      first.targetTss <= 140 + 1 && first.phase === "recovery", `${first.targetTss} TSS · ${first.phase}`);
    check("T1c", "note explains the forced recovery", !!r.note && /recovery load/.test(r.note!));
  }

  // ——— T2. 3×overshoot-rebaselines-up ——————————————————————————————
  {
    const overshoots: WeekActual[] = [led(0, w(0).targetTss * 1.2), led(1, w(1).targetTss * 1.2), led(2, w(2).targetTss * 1.2)];
    const hi = recomputeRemaining(mkInput({ actualState: { ctl: 24 }, actualTrailingTss: [200, 220, 235, 250], ledger: overshoots }));
    // Control: same state, no overshoot streak (so no rebaseline).
    const lo = recomputeRemaining(mkInput({ actualState: { ctl: 24 }, actualTrailingTss: [110, 120, 118, 130], ledger: [led(0, w(0).targetTss), led(1, w(1).targetTss), led(2, w(2).targetTss)] }));
    check("T2a", "3 consecutive overshoots ⇒ rebaselined", hi.rebaselined && !lo.rebaselined);
    const buildIdx = hi.plan.weeks.findIndex((x) => x.phase === "build");
    const lifted = buildIdx >= 0 && hi.plan.weeks[buildIdx].targetTss >= lo.plan.weeks[buildIdx].targetTss;
    check("T2b", "re-baseline lifts (does not lower) build targets vs control",
      lifted, buildIdx >= 0 ? `${lo.plan.weeks[buildIdx].targetTss}→${hi.plan.weeks[buildIdx].targetTss}` : "no build week");
    check("T2c", "note mentions re-baseline", !!hi.note && /re-baselined/.test(hi.note!));
  }

  // ——— T3. 2×undershoot-triggers-recalibration-card ————————————————
  {
    const r = recomputeRemaining(mkInput({
      actualState: { ctl: 14, atl: 10, tsb: 4 },
      ledger: [led(0, w(0).targetTss), led(1, w(1).targetTss * 0.5), led(2, w(2).targetTss * 0.45, { sessionsMissed: 3 })],
    }));
    check("T3a", "2 consecutive ≥40% misses ⇒ recalibration card", r.recalibration != null);
    check("T3b", "recalibration carries a revised finish + realistic week + message",
      !!r.recalibration && !!r.recalibration.revisedFinish && r.recalibration.realisticWeekTss > 0 && r.recalibration.message.length > 40);
    check("T3c", "note reprojects the goal", !!r.note && /reprojected/.test(r.note!));
  }

  // ——— T4. taper-never-compressed (incl. badly behind) ————————————————
  {
    const behind = recomputeRemaining(mkInput({
      actualState: { ctl: 10, atl: 8, tsb: 2 },
      ledger: [led(0, w(0).targetTss * 0.4), led(1, w(1).targetTss * 0.4), led(2, w(2).targetTss * 0.4)],
    }));
    const tail = behind.plan.weeks.slice(-2);
    check("T4a", "final 2 weeks stay taper/race even when far behind",
      tail.length === 2 && tail.every((x) => x.phase === "taper" || x.phase === "race"), tail.map((x) => x.phase).join(","));
    // recomputeRemaining THROWS on <2 taper weeks — reaching here means it didn't.
    check("T4b", "recompute did not throw the taper invariant", true);
  }

  // ——— T5. undershoot-no-unsafe-make-up (the +20% ramp rail still binds) ——
  {
    // After a big miss, the reflow continues from lower fitness under the SAME
    // safe ramp — it never crams the lost load by exceeding +20% week-over-week.
    const r = recomputeRemaining(mkInput({
      actualState: { ctl: 12 },
      ledger: [led(0, w(0).targetTss), led(1, w(1).targetTss * 0.5), led(2, w(2).targetTss * 0.5)],
    }));
    const weeks = r.plan.weeks;
    let worst = 0;
    for (let i = 1; i < weeks.length; i++) {
      if (weeks[i].phase === "race" || weeks[i].phase === "taper") continue;
      const prev = weeks[i - 1].targetTss;
      if (prev > 0) worst = Math.max(worst, (weeks[i].targetTss - prev) / prev);
    }
    check("T5", "no reflowed week jumps more than +20% over the prior (rail holds; no cramming)",
      worst <= 0.20 + 0.03, `worst +${(worst * 100).toFixed(0)}%`);
  }

  // ——— T6. single-miss-silent ——————————————————————————————————————
  {
    // On-trajectory: actual fitness ≈ what the plan expected at the start of
    // this week (the prior week's end projection), so neither ahead nor behind.
    const r = recomputeRemaining(mkInput({
      actualState: { ctl: w(2).projected.ctl },
      ledger: [led(0, w(0).targetTss), led(1, w(1).targetTss), led(2, Math.round(w(2).targetTss * 0.92), { sessionsMissed: 1 })],
    }));
    check("T6", "one missed session in an on-target week ⇒ no note, no recalibration",
      r.note === null && r.recalibration === null, `note=${r.note}`);
  }

  // ——— T7. lastRecomputed stamped ——————————————————————————————————
  {
    const r = recomputeRemaining(mkInput({ ledger: [led(0, w(0).targetTss)] }));
    check("T7", "result stamps lastRecomputed = asOf", r.lastRecomputed === asOf);
  }

  // ——— T8. projected stays self-consistent after an override ————————
  {
    const cap = w(2).targetTss;
    const r = recomputeRemaining(mkInput({
      actualState: { ctl: 20 },
      ledger: [led(0, w(0).targetTss), led(1, w(1).targetTss), led(2, cap * 1.5, { rampCapTss: cap })],
    }));
    const bad = r.plan.weeks.filter((x) => Math.abs(x.projected.tsb - (x.projected.ctl - x.projected.atl)) > 0.11);
    check("T8a", "every re-derived week has projected.tsb === ctl − atl", bad.length === 0,
      bad.length ? `${bad.length} inconsistent` : "consistent");
    check("T8b", "no note ever contains Infinity/NaN", !r.note || !/Infinity|NaN/.test(r.note));
  }

  // ——— T9. a 0-target last week never divides by zero ——————————————
  {
    const r = recomputeRemaining(mkInput({
      actualState: { ctl: 18 },
      ledger: [led(0, w(0).targetTss), led(1, w(1).targetTss), { weekStart: w(2).weekStart, actualTss: 40, plannedTss: 0, sessionsMissed: 0, sessionsPlanned: 0 }],
    }));
    check("T9", "0-target last week ⇒ no Infinity% note (overshoot damp skipped)",
      !r.note || !/Infinity/.test(r.note), `note=${r.note}`);
  }
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.log("  " + f);
console.log(`\nreplan: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
