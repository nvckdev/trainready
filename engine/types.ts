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
  /** True ONLY for the opening week of a freshly generated plan — generatePlan
   *  sets it on week index 0. It is the sole trigger for the anchor-v2 week-1
   *  base floor. It is NEVER set on the backtest replay path (engine/backtest.ts
   *  prescribes from dataset features that lack it), so the floor cannot fire
   *  there. This replaces the old `prevPrescribedTss === undefined` proxy, which
   *  was also true for every backtest week and leaked the floor onto ~47
   *  base/build weeks — regressing the pinned baselines once anchor-v2 became
   *  the default. Absent everywhere except a real plan's first week. */
  isFirstPlanWeek?: boolean;
  /** Required peak (pre-taper) CTL implied by the plan's race goal
   *  (engine/goal.ts goalCtlTarget). Set ONLY inside generatePlan's per-week
   *  state; NEVER present on the backtest replay path (dataset features lack
   *  it — engine/backtest.ts prescribes from records that have no such key),
   *  so the goal periodization floor (engine/learned.ts) cannot fire there.
   *  Mirrors isFirstPlanWeek's audited neutrality pattern — the goal target is
   *  invisible to prescribeWeek(ex.features), keeping the pinned backtest
   *  baselines byte-for-byte unchanged (taper-rules rule 7). */
  goalPeakCtl?: number;
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

/**
 * Normalized, machine-readable workout structure. The generator EMITS this
 * directly when it composes a session (engine/plan.ts) — it already knows the
 * reps / durations / paces / zone as it builds the human-readable string, so
 * those values are written straight into blocks rather than ever being parsed
 * back out of text (parsing our own emitted text would be backwards). The
 * human-readable `PlannedSessionOut.structure` string is derived from the SAME
 * per-session computation, so text and blocks can never diverge on a value.
 * See docs/workout-structure.md.
 */

/** Intensity zone — a color/effort ramp, coldest → hottest. Drives the
 *  visual renderer's zone palette (documented ember/bone ramp), NOT the
 *  fixed chart SERIES slots (taper-rules rule 14). `cv` = critical velocity
 *  (e.g. swim CSS); `race` = goal-race effort. */
export type Zone =
  | "recovery"
  | "easy"
  | "tempo"
  | "threshold"
  | "cv"
  | "vo2"
  | "race";

/** Structural role of a block within the session. */
export type BlockKind =
  | "warmup"
  | "main"
  | "cooldown"
  | "strides"
  | "recovery"
  | "segment";

/**
 * One structural unit of a workout. Duration OR distance carries the size
 * (runs/bikes use durationSec; swims use distanceM). `reps` > 1 means the
 * block repeats (interval set). Pace fields are per-km and populated for RUN
 * efforts only — bike (watts) and swim (per-100m) efforts carry their target
 * in `effortNote` and are identified by `zone`. All fields except `kind` and
 * `zone` are optional; a block always has a structural role and an intensity.
 */
export interface Block {
  kind: BlockKind;
  zone: Zone;
  /** Repeat count for an interval set (absent/1 = a single continuous block). */
  reps?: number;
  /** Per-rep (or whole-block) duration in seconds. */
  durationSec?: number;
  /** Per-rep (or whole-block) distance in metres (swims, distance-defined work). */
  distanceM?: number;
  /** Run pace window, seconds per km. min = fast end, max = slow end. */
  paceMinSecPerKm?: number;
  paceMaxSecPerKm?: number;
  /** Recovery between reps, in seconds. */
  recoverySec?: number;
  /** Free text qualifying the recovery, e.g. "easy", "rest", "full recovery". */
  recoveryNote?: string;
  /** Free text qualifying the effort, e.g. a bike watt target or a cue. */
  effortNote?: string;
}

export interface WorkoutStructure {
  blocks: Block[];
}
