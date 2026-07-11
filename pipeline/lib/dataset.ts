import { join } from "node:path";
import { DATASETS, isoWeekStart, writeCsv, writeJsonl } from "./io.ts";
import type { PmcPoint, RaceLabel, Session, WeekAggregate } from "./types.ts";

/**
 * Phase-0 imitation dataset: for each historical week, the athlete state at
 * the week's start (features) and what the coached athlete actually executed
 * that week (targets). This is the "what would a good week look like from
 * here" table the plan engine trains and backtests against.
 */
export interface WeeklyExample {
  weekStart: string;
  features: {
    ctl: number;
    atl: number;
    tsb: number;
    last4WeeksTss: number[]; // oldest → newest
    daysToNextRace: number | null;
    weeksSinceStart: number;
  };
  targets: {
    weekTss: number;
    weekHours: number;
    sessions: number;
    swimShare: number;
    bikeShare: number;
    runShare: number;
  };
}

export function buildDatasets(
  sessions: Session[],
  weekly: WeekAggregate[],
  pmc: PmcPoint[],
  races: RaceLabel[]
) {
  const pmcByDate = new Map(pmc.map((p) => [p.date, p]));
  const raceDates = races.map((r) => r.date).sort();

  const examples: WeeklyExample[] = [];
  weekly.forEach((w, i) => {
    const state = pmcByDate.get(w.weekStart);
    if (!state) return;
    const last4 = weekly.slice(Math.max(0, i - 4), i).map((x) => x.tss);
    if (last4.length < 4) return; // need a full lookback window

    const nextRace = raceDates.find((d) => d >= w.weekStart);
    const daysToNextRace = nextRace
      ? Math.round((Date.parse(nextRace) - Date.parse(w.weekStart)) / 86400000)
      : null;

    const swim = w.tssByDiscipline.swim ?? 0;
    const bike = w.tssByDiscipline.bike ?? 0;
    const run = w.tssByDiscipline.run ?? 0;
    const denom = Math.max(1, w.tss);

    examples.push({
      weekStart: w.weekStart,
      features: {
        ctl: round2(state.ctl),
        atl: round2(state.atl),
        tsb: round2(state.tsb),
        last4WeeksTss: last4.map(round2),
        daysToNextRace,
        weeksSinceStart: i,
      },
      targets: {
        weekTss: round2(w.tss),
        weekHours: round2(w.hours),
        sessions: w.sessions,
        swimShare: round2(swim / denom),
        bikeShare: round2(bike / denom),
        runShare: round2(run / denom),
      },
    });
  });
  writeJsonl(join(DATASETS, "weekly-examples.jsonl"), examples);

  // Session-level compliance where a plan was attached to the completion.
  const compliance = sessions
    .filter((s) => s.plannedDurationHr !== null || s.plannedTss !== null)
    .map((s) => ({
      id: s.id,
      date: s.date,
      week: isoWeekStart(s.date),
      discipline: s.discipline,
      plannedHr: s.plannedDurationHr,
      actualHr: s.durationHr,
      durationRatio:
        s.plannedDurationHr && s.durationHr ? s.durationHr / s.plannedDurationHr : null,
      plannedTss: s.plannedTss,
      actualTss: s.tss,
      tssRatio: s.plannedTss && s.tss ? s.tss / s.plannedTss : null,
    }));
  writeCsv(
    join(DATASETS, "compliance.csv"),
    ["id", "date", "week", "discipline", "planned_hr", "actual_hr", "duration_ratio", "planned_tss", "actual_tss", "tss_ratio"],
    compliance.map((c) => [
      c.id,
      c.date,
      c.week,
      c.discipline,
      c.plannedHr,
      c.actualHr,
      c.durationRatio === null ? null : c.durationRatio.toFixed(3),
      c.plannedTss,
      c.actualTss,
      c.tssRatio === null ? null : c.tssRatio.toFixed(3),
    ])
  );

  return { examples: examples.length, compliance: compliance.length };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
