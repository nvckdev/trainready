/**
 * The Taper prescription interface. The backtest, the future API, and the
 * product all speak this contract; any engine implementation (the reference
 * rules engine here, or the proprietary algorithm) plugs in behind it.
 */

export type Phase = "base" | "build" | "taper" | "race" | "recovery";

export interface AthleteState {
  /** Chronic training load at the week's start. */
  ctl: number;
  atl: number;
  tsb: number;
  /** Executed weekly TSS, oldest → newest (4 weeks). */
  last4WeeksTss: number[];
  /** Trailing discipline mix of executed load. */
  last4Shares: { swim: number; bike: number; run: number };
  /** Days from the week's start to the next A-race, if one is scheduled. */
  daysToNextRace: number | null;
  /** Weeks of continuous training history (for cutback rhythm). */
  weeksSinceStart: number;
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
