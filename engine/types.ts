/**
 * The Taper prescription interface. The backtest, the future API, and the
 * product all speak this contract; any engine implementation (the reference
 * rules engine here, or the proprietary algorithm) plugs in behind it.
 */

export type Phase = "base" | "build" | "taper" | "race" | "recovery" | "offseason";

export interface AthleteState {
  /** Chronic training load at the week's start. */
  ctl: number;
  atl: number;
  tsb: number;
  /** Executed weekly TSS, oldest → newest (4 weeks). */
  last4WeeksTss: number[];
  /** Optional richer window: executed (or in-plan prescribed) weekly TSS,
   *  oldest → newest, up to 8 weeks when the caller has them (the plan
   *  simulation does). A superset of last4WeeksTss; today only anchor-v2's
   *  ramp-cap reference reads it, falling back to last4WeeksTss. */
  trailingWeeksTss?: number[];
  /** What the engine itself prescribed for the immediately preceding week,
   *  when this state sits inside a simulated plan (plan.ts sets it from week
   *  2 on). Only anchor-v2's week-over-week smoothing band reads it; absent
   *  (real history, backtest, week 1) the band is inactive. */
  prevPrescribedTss?: number;
  /** Trailing discipline mix of executed load. */
  last4Shares: { swim: number; bike: number; run: number };
  /** Days from the week's start to the next A-race, if one is scheduled. */
  daysToNextRace: number | null;
  /** Weeks of continuous training history (for cutback rhythm). */
  weeksSinceStart: number;
  /** mean(last 2 weeks TSS) / mean(last 8 weeks TSS): <0.6 smells like a break. */
  breakRatio: number;
  /** Days since the athlete last completed any session. */
  daysSinceLastSession: number;
}

export interface WeekPrescription {
  phase: Phase;
  /** Target load for the coming week. */
  weekTss: number;
  /** Rough session count implied by the load. */
  sessions: number;
  shares: { swim: number; bike: number; run: number };
  /** One sentence: the why. Product principle #1 applies to engines too. */
  rationale: string;
}

export interface Engine {
  name: string;
  prescribeWeek(state: AthleteState): WeekPrescription;
}
