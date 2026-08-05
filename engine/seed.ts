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
  /** Count of gap days rolled forward at an ASSUMED zero — days no source
   *  could speak for. This is the provenance the reconcile path consults
   *  before prescribing from the result: a state built mostly of assumptions
   *  is a lower bound, not a measurement. */
  zeroLoadDays: number;
  /** Count of gap days rolled from real evidence — either a recorded load or
   *  a source that covered the day and found nothing (a true rest day). */
  evidencedDays: number;
}

/**
 * What actually happened during the gap between the last extracted day and
 * the seed date. Optional: absent ⇒ the historical zero-load roll-forward,
 * byte-identical (pinned by T14a).
 *
 * `load` is the merged daily TSS the rest of the system already computes
 * (engine/activity.ts dailyExecutedTss — imports deduped across sources,
 * merged with done-marks per day). `covered` answers whether some source
 * actually LOOKED at that day, which is what separates a real rest day from
 * silence — the same distinction executedByWeek draws for weeks.
 */
export interface GapEvidence {
  load: Map<string, number>;
  covered?: (day: string) => boolean;
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
  startDate: string,
  gapEvidence?: GapEvidence
): SeededState {
  let last: DailyPmcPoint | null = null;
  for (const r of series) {
    if (r.date >= startDate) break;
    last = r;
  }
  if (!last) return { ...base, anchorDate: null, zeroLoadDays: 0, evidencedDays: 0 };
  let ctl = last.ctl;
  let atl = last.atl;
  const anchorMs = Date.parse(last.date + "T12:00:00Z");
  const gap = Math.round((Date.parse(startDate + "T12:00:00Z") - anchorMs) / DAY) - 1;
  let assumed = 0;
  let evidenced = 0;
  for (let i = 1; i <= gap; i++) {
    const day = new Date(anchorMs + i * DAY).toISOString().slice(0, 10);
    // A recorded load is evidence on its own (a dropped file vouches for
    // itself); a covered day with no load is an authoritative rest day. Only
    // a day nobody looked at is an assumption — and it still rolls at zero,
    // because the recursion needs a number, but it is COUNTED so the caller
    // can decline to prescribe from the result.
    const recorded = gapEvidence?.load.get(day);
    const tss = recorded ?? 0;
    if (recorded !== undefined || gapEvidence?.covered?.(day)) evidenced++;
    else assumed++;
    // PMC recursion (CTL τ=42, ATL τ=7 — rule 6, never tuned). Unchanged: the
    // only difference from the historical zero-load roll is WHAT this loop is
    // told happened on the day.
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
  }
  return {
    ...base,
    ctl,
    atl,
    tsb: ctl - atl,
    anchorDate: last.date,
    zeroLoadDays: assumed,
    evidencedDays: evidenced,
  };
}

/**
 * How many gap days may be ASSUMED before a seeded state is too speculative
 * to prescribe a season from.
 *
 * Each assumed day decays CTL by a factor of (1 − 1/42), so three days is a
 * ≲7% understatement — inside the reconcile gate's own 10% tolerance. Past
 * that the error compounds fast (three stale weeks understate CTL ~40%).
 */
export const MAX_ASSUMED_GAP_DAYS = 3;

/**
 * Is this state mostly assumption rather than measurement?
 *
 * Unknown days can only ever have ADDED load, so a state built on them is a
 * LOWER bound — the risk is one-directional: prescribing too little. A few
 * days is bounded and tolerable; past that the honest answer is to decline,
 * which is the same answer the reconcile gate gives when it cannot see a
 * week (no-execution-data), applied to fitness instead of load.
 */
export function tooSpeculativeToPrescribe(state: SeededState): boolean {
  return state.zeroLoadDays > MAX_ASSUMED_GAP_DAYS;
}
