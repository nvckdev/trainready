import { join } from "node:path";
import { DATASETS, isoWeekStart, writeCsv, writeJsonl } from "./io.ts";
import type { PlannedSession, PmcPoint, RaceLabel, Session, WeekAggregate } from "./types.ts";

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
    /** Trailing 4-week discipline mix of executed TSS. */
    last4Shares: { swim: number; bike: number; run: number };
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
    /**
     * Coach-programmed weekly TSS (paired plans + unmatched planned
     * sessions). Null before 2024-09-10 where extraction was completed-only.
     */
    plannedTss: number | null;
  };
}

const PLANNED_DATA_START = "2024-09-08"; // first Monday with planned coverage

export function buildDatasets(
  sessions: Session[],
  planned: PlannedSession[],
  weekly: WeekAggregate[],
  pmc: PmcPoint[],
  races: RaceLabel[]
) {
  const pmcByDate = new Map(pmc.map((p) => [p.date, p]));
  const raceDates = races.map((r) => r.date).sort();

  // Coach-programmed load per week: plans paired onto completions plus
  // plans that were never executed.
  const plannedByWeek = new Map<string, number>();
  for (const s of sessions) {
    if (s.plannedTss === null) continue;
    const w = isoWeekStart(s.date);
    plannedByWeek.set(w, (plannedByWeek.get(w) ?? 0) + s.plannedTss);
  }
  for (const p of planned) {
    if (p.tss === null) continue;
    const w = isoWeekStart(p.date);
    plannedByWeek.set(w, (plannedByWeek.get(w) ?? 0) + p.tss);
  }

  const examples: WeeklyExample[] = [];
  weekly.forEach((w, i) => {
    const state = pmcByDate.get(w.weekStart);
    if (!state) return;
    const last4 = weekly.slice(Math.max(0, i - 4), i);
    if (last4.length < 4) return; // need a full lookback window

    const nextRace = raceDates.find((d) => d >= w.weekStart);
    const daysToNextRace = nextRace
      ? Math.round((Date.parse(nextRace) - Date.parse(w.weekStart)) / 86400000)
      : null;

    const sum = (f: (x: WeekAggregate) => number) => last4.reduce((s, x) => s + f(x), 0);
    const trailingTss = Math.max(1, sum((x) => x.tss));
    const last4Shares = {
      swim: round2(sum((x) => x.tssByDiscipline.swim ?? 0) / trailingTss),
      bike: round2(sum((x) => x.tssByDiscipline.bike ?? 0) / trailingTss),
      run: round2(sum((x) => x.tssByDiscipline.run ?? 0) / trailingTss),
    };

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
        last4WeeksTss: last4.map((x) => round2(x.tss)),
        last4Shares,
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
        plannedTss:
          w.weekStart >= PLANNED_DATA_START
            ? round2(plannedByWeek.get(w.weekStart) ?? 0)
            : null,
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
