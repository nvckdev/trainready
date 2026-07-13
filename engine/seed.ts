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

/**
 * A seeded athlete state plus provenance: WHERE the PMC numbers are anchored.
 * The provenance drives the Today-page "Fitness anchored to …" line so the
 * athlete can see how much of their current form is real logged data vs
 * zero-load roll-forward across a scheduling gap.
 */
export interface SeededState extends AthleteState {
  /** The last daily PMC row strictly before startDate — the last day backed
   *  by real logged activity that the seed is anchored on. null when the
   *  series is empty or begins on/after startDate (no real data to anchor). */
  anchorDate: string | null;
  /** Count of zero-load days the recursion rolled forward from anchorDate to
   *  the morning of startDate (the unlogged tail). 0 when startDate is the day
   *  after the anchor row, or when there is no anchor. */
  zeroLoadDays: number;
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
): SeededState {
  let last: DailyPmcPoint | null = null;
  for (const r of series) {
    if (r.date >= startDate) break;
    last = r;
  }
  if (!last) return { ...base, anchorDate: null, zeroLoadDays: 0 };
  let ctl = last.ctl;
  let atl = last.atl;
  const gap =
    Math.round((Date.parse(startDate + "T12:00:00Z") - Date.parse(last.date + "T12:00:00Z")) / DAY) - 1;
  for (let i = 0; i < gap; i++) {
    // PMC recursion, zero load (CTL τ=42, ATL τ=7 — rule 6, never tuned).
    ctl = ctl + (0 - ctl) / 42;
    atl = atl + (0 - atl) / 7;
  }
  // gap is ≥ 0 (last.date is strictly before startDate), so it is exactly the
  // number of zero-load days the loop above rolled forward — report it as-is.
  return { ...base, ctl, atl, tsb: ctl - atl, anchorDate: last.date, zeroLoadDays: gap };
}
