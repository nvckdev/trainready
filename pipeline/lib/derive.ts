import { join } from "node:path";
import { DERIVED, eachDay, isoWeekStart, writeCsv, writeJsonl } from "./io.ts";
import type { DayAggregate, Discipline, PmcPoint, Session, WeekAggregate } from "./types.ts";

const CTL_TC = 42;
const ATL_TC = 7;

export function deriveDaily(sessions: Session[]): DayAggregate[] {
  const byDate = new Map<string, DayAggregate>();
  for (const s of sessions) {
    const day =
      byDate.get(s.date) ??
      ({ date: s.date, tss: 0, hours: 0, sessions: 0, tssByDiscipline: {}, kmByDiscipline: {} } as DayAggregate);
    day.tss += s.tss ?? 0;
    day.hours += s.durationHr ?? 0;
    day.sessions += 1;
    day.tssByDiscipline[s.discipline] = (day.tssByDiscipline[s.discipline] ?? 0) + (s.tss ?? 0);
    if (s.distanceKm)
      day.kmByDiscipline[s.discipline] = (day.kmByDiscipline[s.discipline] ?? 0) + s.distanceKm;
    byDate.set(s.date, day);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Classic impulse-response performance-management chart.
 * CTL_t = CTL_{t-1} + (TSS_t − CTL_{t-1}) / 42, ATL same with 7,
 * TSB_t = CTL_{t-1} − ATL_{t-1} (TrainingPeaks reports "form" against yesterday).
 */
export function derivePmc(daily: DayAggregate[]): PmcPoint[] {
  if (daily.length === 0) return [];
  const tssByDate = new Map(daily.map((d) => [d.date, d.tss]));
  const out: PmcPoint[] = [];
  let ctl = 0;
  let atl = 0;
  for (const date of eachDay(daily[0].date, daily[daily.length - 1].date)) {
    const tss = tssByDate.get(date) ?? 0;
    const tsb = ctl - atl; // uses yesterday's values, computed before update
    ctl = ctl + (tss - ctl) / CTL_TC;
    atl = atl + (tss - atl) / ATL_TC;
    out.push({ date, tss, ctl, atl, tsb });
  }
  return out;
}

export function deriveWeekly(daily: DayAggregate[]): WeekAggregate[] {
  const byWeek = new Map<string, WeekAggregate>();
  for (const d of daily) {
    const ws = isoWeekStart(d.date);
    const w =
      byWeek.get(ws) ??
      ({ weekStart: ws, tss: 0, hours: 0, sessions: 0, tssByDiscipline: {}, rampPct: null } as WeekAggregate);
    w.tss += d.tss;
    w.hours += d.hours;
    w.sessions += d.sessions;
    for (const [k, v] of Object.entries(d.tssByDiscipline)) {
      w.tssByDiscipline[k as Discipline] = (w.tssByDiscipline[k as Discipline] ?? 0) + (v ?? 0);
    }
    byWeek.set(ws, w);
  }
  const weeks = [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  for (let i = 0; i < weeks.length; i++) {
    const prior = weeks.slice(Math.max(0, i - 4), i);
    if (prior.length >= 2) {
      const mean = prior.reduce((s, w) => s + w.tss, 0) / prior.length;
      weeks[i].rampPct = mean > 0 ? ((weeks[i].tss - mean) / mean) * 100 : null;
    }
  }
  return weeks;
}

export function derive(sessions: Session[]) {
  const daily = deriveDaily(sessions);
  const pmc = derivePmc(daily);
  const weekly = deriveWeekly(daily);

  writeJsonl(join(DERIVED, "daily.jsonl"), daily);
  writeCsv(
    join(DERIVED, "pmc.csv"),
    ["date", "tss", "ctl", "atl", "tsb"],
    pmc.map((p) => [p.date, p.tss.toFixed(1), p.ctl.toFixed(2), p.atl.toFixed(2), p.tsb.toFixed(2)])
  );
  writeCsv(
    join(DERIVED, "weekly.csv"),
    ["week_start", "tss", "hours", "sessions", "swim_tss", "bike_tss", "run_tss", "other_tss", "ramp_pct"],
    weekly.map((w) => {
      const swim = w.tssByDiscipline.swim ?? 0;
      const bike = w.tssByDiscipline.bike ?? 0;
      const run = w.tssByDiscipline.run ?? 0;
      const other = w.tss - swim - bike - run;
      return [
        w.weekStart,
        w.tss.toFixed(1),
        w.hours.toFixed(2),
        w.sessions,
        swim.toFixed(1),
        bike.toFixed(1),
        run.toFixed(1),
        other.toFixed(1),
        w.rampPct === null ? null : w.rampPct.toFixed(1),
      ];
    })
  );
  return { daily, pmc, weekly };
}
