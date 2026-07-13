import type { AthleteState } from "./types.ts";

/**
 * Plan-seed state: where a generated plan's PMC simulation starts.
 *
 * The athlete-facing "Today" header derives CTL/ATL/TSB from the DAILY pmc
 * series (data/derived/pmc.csv, read via src/lib/athlete-data.ts getPmc).
 * Plan generation must start from that same state. Seeding from the last
 * WEEKLY example instead (features frozen at that week's Monday) is up to
 * two weeks stale — observed: plan seeded TSB −10.4 while the header read
 * +2.5 for the same athlete on the same day.
 */

export interface DailyPmcPoint {
  date: string; // YYYY-MM-DD
  ctl: number; // end-of-day value (after that day's logged load)
  atl: number;
}

const DAY = 86400000;

/**
 * Roll the daily PMC series forward to the morning of `startDate` and merge
 * the result into `base` (which supplies the non-PMC features:
 * last4WeeksTss, shares, weeksSinceStart, …).
 *
 * Series rows carry END-of-day CTL/ATL, already reflecting every logged
 * activity's TSS (data/derived/pmc.csv emits a row for every day through the
 * last logged activity, zeros included). So: take the last row strictly
 * before `startDate`, then apply the exact zero-load recursion from
 * engine/plan.ts / pipeline/lib/derive.ts across the unlogged tail up to
 * end-of-(startDate−1). Seed TSB keeps the TrainingPeaks convention — the
 * form the athlete wakes into on startDate is yesterday's CTL − ATL, which
 * is exactly seed.ctl − seed.atl here.
 *
 * `series` must be in chronological order (pmc.csv is). An empty series or
 * one that starts on/after `startDate` falls back to `base` unchanged.
 */
export function seedStateAt(
  base: AthleteState,
  series: DailyPmcPoint[],
  startDate: string
): AthleteState {
  let last: DailyPmcPoint | null = null;
  for (const r of series) {
    if (r.date >= startDate) break;
    last = r;
  }
  if (!last) return { ...base };
  let ctl = last.ctl;
  let atl = last.atl;
  const gap =
    Math.round((Date.parse(startDate + "T12:00:00Z") - Date.parse(last.date + "T12:00:00Z")) / DAY) - 1;
  for (let i = 0; i < gap; i++) {
    // PMC recursion, zero load (CTL τ=42, ATL τ=7 — rule 6, never tuned).
    ctl = ctl + (0 - ctl) / 42;
    atl = atl + (0 - atl) / 7;
  }
  return { ...base, ctl, atl, tsb: ctl - atl };
}
