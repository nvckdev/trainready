import type { RaceAnchor } from "./goal.ts";
import { fitAround, repsWithin, splitAround } from "./session-fit.ts";
import {
  CVOL,
  cvolFor,
  easyKmhFor,
  EVIDENCE_FLOOR,
  finishEstimate,
  goalCtlTarget,
  longRunKm,
  LONG_FRACTION_MAX,
  qualityKmhFor,
  parseGoalTime,
  peakLongKm,
  peakWeeklyKm,
  raceDistanceKm,
  type GoalCtl,
} from "./goal.ts";
import { TaperV1, type Era } from "./learned.ts";
import { activeTissueCaps, tissueReasons, type TissueCaps, type TissueConstraint } from "./tissue.ts";
import { peakLongRunKm, peakWeekRunKm, sessionRunKm, weekRunKm } from "./volume.ts";
import { crossKindFor } from "./crosstrain.ts";
import { deriveBaseRichness, rampCapFromRichness } from "./history.ts";
import { sessionZoneSeconds, targetDistribution, weekDistribution, z1FloorFor } from "./intensity.ts";
import type { AthleteState, Block, Phase, WorkoutStructure, Zone } from "./types.ts";
import { thresholdMpsFromZones, type PaceRange, type Zones } from "./zones.ts";

export type { Block, WorkoutStructure } from "./types.ts";

/**
 * Season plan generation: simulate the weeks between now and race day,
 * asking the engine for each week's load as projected fitness evolves, then
 * distribute each week into day-level structured sessions with zone targets
 * and a why. This is the product's core artifact.
 */

export type RaceType =
  | "sprint"
  | "olympic"
  | "half-ironman"
  | "ironman"
  | "run-5k"
  | "run-10k"
  | "run-half"
  | "run-marathon";

export interface PlanRequest {
  raceName: string;
  raceDate: string; // YYYY-MM-DD
  /** Era definitions for capability anchoring (E6) — thread loadEras() from a
   *  node-side caller; absent ⇒ no era weighting (mobile's effective state,
   *  since it has no context file). */
  eras?: Era[] | null;
  /** The athlete's demonstrated races (E6) — thread loadRaceAnchors() from a
   *  node-side caller; absent ⇒ the generic anchorless paths. */
  raceAnchors?: RaceAnchor[];
  raceType: RaceType;
  daysPerWeek: number; // 4–7
  longDay: "saturday" | "sunday";
  startDate?: string; // defaults to today
  /** Hard cap on training sessions per week (the race itself is protocol and
   *  does not count). Defaults to 5; dropped-slot volume redistributes over
   *  the surviving slots by weight, so the long session keeps its share. */
  maxSessions?: number;
  /** Anchor-v2 load ceiling (see engine/learned.ts). NOW THE DEFAULT — kept
   *  as a harmless no-op alias so existing callers/scripts don't break; it no
   *  longer toggles anything. To opt out, use `anchorLegacy`. */
  anchorV2?: boolean;
  /** Escape hatch back to the legacy trailing-mean ceiling (pre-anchor-v2).
   *  Default false → anchor-v2 is standard. Also switchable via env
   *  ANCHOR_LEGACY=1. */
  anchorLegacy?: boolean;
  /** Optional race goal time, "H:MM:SS" or "MM:SS". When present (and the
   *  race is a run distance), the plan is periodized toward the CTL the goal
   *  pace implies (engine/goal.ts) and surfaces an honest gap assessment.
   *  Optional → every existing caller/harness stays valid; parsed engine-side,
   *  so an invalid/empty value simply leaves the goal target inert. */
  goalTime?: string;
  /** Population-prior weights for the learned layer (refinement 2). The
   *  CALLER loads the artifact (engine/learned.ts loadPopulationPrior) and
   *  passes it explicitly — the engine never reads it implicitly, so the
   *  backtest path and every existing caller are byte-identical when absent.
   *  With it, a brand-new athlete gets a live learned layer from week 1,
   *  refined toward their own history as weeks land. */
  priorWeights?: number[];
  /** Tune-up races (B-races) inside the plan window — same plan-only seam as
   *  goalPeakCtl, invisible to the backtest path. Each reshapes ONLY its own
   *  week: the race replaces that week's quality at full race TSS, the day
   *  before drops to openers, the day after to recovery, and the weekly budget
   *  absorbs the race load rather than stacking on top of it. Must sit ≥10
   *  days before the goal race (inside that window is the goal's taper).
   *  ABSENT or [] ⇒ byte-identical plans. */
  tuneups?: Array<{ date: string; raceType: RaceType; name?: string }>;
  /** Active tissue constraints (feature 4) — user-declared or inferred from the
   *  pain tracker (app layer). Each caps only what its provocation justifies and
   *  publishes a "why". ABSENT or [] ⇒ no caps: the plan is byte-identical to
   *  one generated without the field (a healthy runner is never capped
   *  prophylactically — Fokkema found no volume↔injury link). See engine/tissue.ts. */
  tissueConstraints?: TissueConstraint[];
}

export interface PlannedSessionOut {
  date: string;
  weekday: string;
  discipline: "swim" | "bike" | "run" | "rest" | "race";
  title: string;
  durationHr: number;
  tss: number;
  /** Human-readable session text. DERIVED from `workout.blocks` in the same
   *  per-session computation that builds them (see engine/types.ts), so the
   *  two can never diverge; today's exact wording is preserved. Every existing
   *  consumer (SessionCard, calendar.ics, plan-io) reads this string
   *  unchanged. */
  structure: string;
  /** Normalized machine-readable structure the visual renderer consumes.
   *  Optional so pre-existing stored plans and text-only conversions
   *  (week-insights.easedVersion) still validate and fall back to `structure`;
   *  every freshly generated session carries it. */
  workout?: WorkoutStructure;
  why: string;
  status?: "done" | "skipped";
  /** True for a non-impact session added to REPLACE running a tissue constraint
   *  caps (feature 5). Its load builds total CTL but never running-specific CTL. */
  substituted?: boolean;
  /** True for a B-race (PlanRequest.tuneups): a race-discipline session whose
   *  week is reshaped around it — quality lives here, not on top of it. */
  tuneup?: boolean;
}

export interface PlanWeek {
  weekStart: string;
  phase: Phase;
  targetTss: number;
  /**
   * How the Z1 floor (refinement 1) was held on this week, when the normal
   * TSS transfer could not do it. "demoted-quality": a quality session was
   * rebuilt as easy at the same TSS — less intensity, more easy volume, the
   * week conserved. "unreachable": even with every demotable session easy the
   * floor cannot be met within this week's structure — surfaced explicitly
   * rather than breached silently. Absent on every week the transfer alone
   * handled (byte-identical to the pre-fix plan).
   */
  z1FloorAction?: "demoted-quality" | "unreachable";
  /** projected fitness at week's end. runCtl/runTsb are present ONLY when cross-
   *  training made running-specific load diverge from total (feature 5). */
  projected: { ctl: number; atl: number; tsb: number; runCtl?: number; runTsb?: number };
  sessions: PlannedSessionOut[];
}

export interface Plan {
  meta: {
    generatedAt: string;
    engine: string;
    raceName: string;
    raceDate: string;
    raceType: RaceType;
    daysPerWeek: number;
    longDay: "saturday" | "sunday";
    startCtl: number;
    projectedRaceCtl: number;
    projectedRaceTsb: number;
    /** Running-specific race-day CTL (feature 5) — present ONLY when cross-
     *  training was used, so total and running CTL differ. The goal-gap finish
     *  is read from THIS (running fitness), never the cross-training-inflated total. */
    projectedRaceRunCtl?: number;
    /** Honest goal-vs-reachable assessment (engine/goal.ts). Present only when
     *  a run-distance race goal was supplied; absent for goal-less and tri
     *  plans, so existing plans are unaffected. The rails are NEVER loosened to
     *  close the gap — reachablePeakCtl is literally the plotted trajectory's
     *  peak, and the finish is a load-limited bound, not a prediction. */
    goalGap?: {
      goalTime: string; // "1:24:00"
      requiredPeakCtl: number; // ~50 — the race-day CTL the goal pace needs
      reachablePeakCtl: number; // ~26 — safe race-day CTL under the rails
      realisticFinish: string; // "1:43"
      gapCtl: number; // ~24
      message: string; // the §4.2 paragraph
      loadLimited: true; // flags the finish as a bound, not a prediction
    };
    /** Active tissue constraints (feature 4). Present ONLY when a constraint was
     *  declared/inferred — absent for a healthy athlete, so their plan meta is
     *  byte-identical. `caps` are the resolved (tightest) limits actually applied;
     *  `why` is the human justification shown beside each cap. */
    tissue?: {
      caps: TissueCaps;
      why: string[];
    };
    /** Direct volume/long-run targets vs what the plan achieves (feature 2).
     *  Present only for run-distance races. The evidence floors (Fokkema 2020)
     *  are the minimum viable weekly/long km; `meets*` flags whether the plan
     *  reaches them, and `tissueActive` whether a constraint legitimately holds
     *  it below. */
    volumeTargets?: {
      peakWeeklyKmTarget: number;
      peakWeeklyKmActual: number;
      peakLongKmTarget: number;
      peakLongKmActual: number;
      weeklyFloorKm: number;
      longFloorKm: number;
      meetsWeeklyFloor: boolean;
      meetsLongFloor: boolean;
      tissueActive: boolean;
      /** Refinement 5: the ~35% volume-fraction rail (not a tissue cap) is
       *  what holds the long run under its evidence floor. Optional so stored
       *  pre-refinement plans still validate. */
      longCappedByFraction?: boolean;
    };
    /** Adaptive re-plan (engine/replan.ts) — all optional/inert, absent on
     *  freshly generated plans so nothing pre-existing changes. Stamped by the
     *  re-plan action after a recompute-from-actual. */
    lastRecomputed?: string; // ISO date of the last recompute-from-actual
    replanNote?: string; // one-line "plan adjusted" note (what changed + why)
    recalibration?: {
      revisedFinish: string;
      reachablePeakCtl: number;
      realisticWeekTss: number;
      message: string;
    };
  };
  weeks: PlanWeek[];
}

const RACE_TSS: Record<RaceType, number> = {
  sprint: 95,
  olympic: 180,
  "half-ironman": 340,
  ironman: 560,
  "run-5k": 48,
  "run-10k": 75,
  "run-half": 115,
  "run-marathon": 250,
};

const isTri = (t: RaceType) => !t.startsWith("run-");

// ——— session templates ————————————————————————————————————————

type Kind =
  | "run-easy"
  | "run-strides"
  | "run-long"
  | "run-tempo"
  | "run-vo2"
  | "bike-z2"
  | "bike-threshold"
  | "bike-vo2"
  | "bike-long"
  | "swim-endurance"
  | "swim-threshold";

/** What a template emits: the normalized blocks the visual renderer reads,
 *  plus the human-readable `text`. Both are built in ONE function from the
 *  same locals, so a value change flows to both — they cannot diverge, and
 *  the text is never parsed back into blocks (engine/types.ts). */
interface Built {
  blocks: Block[];
  text: string;
}

interface Template {
  discipline: "swim" | "bike" | "run";
  intensity: number; // IF for TSS→duration
  title: (min: number) => string;
  /**
   * Build the session's blocks for an exact budget IN SECONDS.
   *
   * Every time-defined template's blocks must sum to `sec`. It used to take
   * minutes already rounded to the nearest 5 by mins(), which put the template
   * up to 2.5 minutes away from the duration the session would actually store
   * before its own arithmetic was even considered. See engine/session-fit.ts
   * for why the budget is hard and the interval set is what yields to it.
   */
  build: (z: Zones, sec: number) => Built;
  why: string;
}

/** Whole minutes for prose. Blocks carry exact seconds; the text rounds them
 *  for readability, the way a coach writes a session down. */
const mm = (sec: number) => Math.round(sec / 60);

/** A quality session gets a real warmup and cooldown before the set gets its
 *  reps — going straight into VO2 work is an injury, not a short session. */
const MIN_WARM_SEC = 300;
const MIN_COOL_SEC = 180;

// Interval shapes. Named because the budget arithmetic reads them twice —
// once to size the set and once to write the session down — and a literal
// that drifted between the two is exactly the class of bug being fixed here.
const STRIDE_REPS = 5;
const STRIDE_SEC = 20;
const STRIDE_REC_SEC = 60; // walk-back after a 20s stride; real time, so budgeted
const TEMPO_REP_SEC = 480;
const TEMPO_REC_SEC = 120;
const TEMPO_MIN_WORK_SEC = 900; // below this it is not a tempo session
const VO2_REP_SEC = 180;
const VO2_REC_SEC = 90;
const VO2_MIN_REPS = 3;
const BIKE_THR_REC_SEC = 300;
const BIKE_VO2_REP_SEC = 120;
const BIKE_VO2_REC_SEC = 120;
const BIKE_LONG_TEMPO_REPS = 2;
const BIKE_LONG_TEMPO_SEC = 1200;

/** Spread a run PaceRange into the two Block pace fields. */
const rp = (r: PaceRange) => ({ paceMinSecPerKm: r.minSecPerKm, paceMaxSecPerKm: r.maxSecPerKm });

const TEMPLATES: Record<Kind, Template> = {
  "run-easy": {
    discipline: "run",
    intensity: 0.67,
    title: (m) => `Easy ${m}`,
    build: (z, sec) => ({
      blocks: [
        {
          kind: "main",
          zone: "easy",
          durationSec: sec,
          ...rp(z.runSec.easy),
          effortNote: "HR is the governor; slow down before you speed up.",
        },
      ],
      text: `${mm(sec)} min easy @ ${z.run.easy}. HR is the governor; slow down before you speed up.`,
    }),
    why: "Aerobic volume at low cost: the base everything else stands on.",
  },
  "run-strides": {
    discipline: "run",
    intensity: 0.68,
    title: (m) => `Easy ${m} + strides`,
    build: (z, sec) => {
      // "Full recovery" is real time on the clock, so it is budgeted rather
      // than left implicit: 5 × 20s on 60s walk-back is 340s. The old template
      // reserved 5 minutes for strides and built 100 seconds of them, which is
      // why a strides session structured at 0.87x its declared duration.
      const set = STRIDE_REPS * STRIDE_SEC + STRIDE_REC_SEC * (STRIDE_REPS - 1);
      const easy = Math.max(60, sec - set);
      return {
        blocks: [
          { kind: "segment", zone: "easy", durationSec: easy, ...rp(z.runSec.easy) },
          {
            kind: "strides",
            zone: "vo2",
            reps: STRIDE_REPS,
            durationSec: STRIDE_SEC,
            recoverySec: STRIDE_REC_SEC,
            recoveryNote: "full recovery",
            effortNote: z.run.strides,
          },
        ],
        text: `${mm(easy)} min easy @ ${z.run.easy}\nthen ${STRIDE_REPS} × strides @ ${z.run.strides}, full recovery`,
      };
    },
    why: "Easy volume plus neuromuscular touch: turnover stays sharp while the aerobic system does the work.",
  },
  "run-long": {
    discipline: "run",
    intensity: 0.72,
    title: (m) => `Long run ${m}`,
    build: (z, sec) => {
      const first = Math.round(sec * 0.3);
      const last = Math.round(sec * 0.15);
      const middle = sec - first - last; // takes the remainder, so the three are exact
      return {
        blocks: [
          { kind: "segment", zone: "easy", durationSec: first, ...rp(z.runSec.easy) },
          { kind: "segment", zone: "easy", durationSec: middle, ...rp(z.runSec.easy), effortNote: "settling into rhythm" },
          { kind: "segment", zone: "easy", durationSec: last, ...rp(z.runSec.steady), effortNote: "may drift to steady if form holds" },
        ],
        text: `${mm(sec)} min continuous:\n· first ${mm(first)} min @ ${z.run.easy}\n· middle @ ${z.run.easy} settling into rhythm\n· last ${mm(last)} min may drift to ${z.run.steady} if form holds`,
      };
    },
    why: "The week's cornerstone: durability, fuel economy, and time on feet.",
  },
  "run-tempo": {
    discipline: "run",
    intensity: 0.8,
    title: () => "Tempo intervals",
    build: (z, sec) => {
      // The 15-minute work floor is a coaching constraint, not a licence to
      // overrun: it applies where the budget allows it and yields where it
      // does not. A 25-minute slot used to build 31 minutes because the floor
      // simply ignored the room available.
      const room = Math.max(0, sec - MIN_WARM_SEC - MIN_COOL_SEC);
      const wantWork = Math.max(TEMPO_MIN_WORK_SEC, Math.round(sec * 0.4));
      let reps = Math.min(6, Math.max(2, Math.round(wantWork / TEMPO_REP_SEC)));
      const setRoom = Math.min(room, wantWork + TEMPO_REC_SEC * (reps - 1));
      let repSec = Math.max(120, Math.floor((setRoom - TEMPO_REC_SEC * (reps - 1)) / reps));
      let set = reps * repSec + TEMPO_REC_SEC * (reps - 1);
      if (set > room) {
        reps = repsWithin(room, repSec, TEMPO_REC_SEC, 2, reps);
        repSec = Math.max(120, Math.floor((room - TEMPO_REC_SEC * (reps - 1)) / reps));
        set = reps * repSec + TEMPO_REC_SEC * (reps - 1);
      }
      const { warmSec, coolSec } = fitAround(sec, set, 0.6);
      return {
        blocks: [
          { kind: "warmup", zone: "easy", durationSec: warmSec, ...rp(z.runSec.easy), effortNote: "+ 2 strides" },
          { kind: "main", zone: "tempo", reps, durationSec: repSec, ...rp(z.runSec.tempo), recoverySec: TEMPO_REC_SEC, recoveryNote: "easy" },
          { kind: "cooldown", zone: "easy", durationSec: coolSec, ...rp(z.runSec.easy) },
        ],
        text: `WARMUP ${mm(warmSec)} min easy @ ${z.run.easy} + 2 strides\nMAIN ${reps} × ${mm(repSec)} min @ ${z.run.tempo} on ${mm(TEMPO_REC_SEC)} min easy\nCOOLDOWN ${mm(coolSec)} min easy`,
      };
    },
    why: "Raises the sustainable-pace ceiling: the engine's race-day workhorse.",
  },
  "run-vo2": {
    discipline: "run",
    intensity: 0.84,
    title: () => "VO2 set",
    build: (z, sec) => {
      // Reps are 3 minutes by definition, so the rep COUNT is what absorbs a
      // short budget. Three reps in a 24-minute slot is a short VO2 session;
      // four reps in a slot that cannot hold them was a 30-minute session
      // wearing a 24-minute label.
      const room = Math.max(0, sec - MIN_WARM_SEC - MIN_COOL_SEC);
      const want = Math.max(VO2_MIN_REPS, Math.round((sec * 0.3) / VO2_REP_SEC));
      const reps = Math.min(want, repsWithin(room, VO2_REP_SEC, VO2_REC_SEC, VO2_MIN_REPS, 8));
      const set = reps * VO2_REP_SEC + VO2_REC_SEC * (reps - 1);
      const { warmSec, coolSec } = fitAround(sec, set, 0.57);
      return {
        blocks: [
          { kind: "warmup", zone: "easy", durationSec: warmSec, ...rp(z.runSec.easy), effortNote: "+ 2 strides" },
          { kind: "main", zone: "vo2", reps, durationSec: VO2_REP_SEC, ...rp(z.runSec.vo2), recoverySec: VO2_REC_SEC, recoveryNote: "easy" },
          { kind: "cooldown", zone: "easy", durationSec: coolSec, ...rp(z.runSec.easy) },
        ],
        text: `WARMUP ${mm(warmSec)} min easy @ ${z.run.easy} + 2 strides\nMAIN ${reps} × ${mm(VO2_REP_SEC)} min @ ${z.run.vo2} on ${VO2_REC_SEC}s easy\nCOOLDOWN ${mm(coolSec)} min easy`,
      };
    },
    why: "Touches the aerobic ceiling so threshold has somewhere to grow.",
  },
  "bike-z2": {
    discipline: "bike",
    intensity: 0.65,
    title: (m) => `Zone 2 ride ${m}`,
    build: (z, sec) => {
      const main = Math.max(300, sec - 900);
      const { warmSec, coolSec } = fitAround(sec, main, 2 / 3); // 10 min ramp / 5 min spin at the nominal 15
      return {
        blocks: [
          { kind: "warmup", zone: "easy", durationSec: warmSec, effortNote: `ramp to ${z.bike.z2}` },
          { kind: "main", zone: "easy", durationSec: main, effortNote: `steady @ ${z.bike.z2}` },
          { kind: "cooldown", zone: "recovery", durationSec: coolSec, effortNote: "easy spin" },
        ],
        text: `WARMUP ${mm(warmSec)} min ramp to ${z.bike.z2}\nMAIN ${mm(main)} min steady @ ${z.bike.z2}\nCOOLDOWN ${mm(coolSec)} min easy spin`,
      };
    },
    why: "Aerobic load with zero impact: volume the legs don't have to pay for.",
  },
  "bike-threshold": {
    discipline: "bike",
    intensity: 0.8,
    title: () => "Threshold intervals",
    build: (z, sec) => {
      // Was fixed at 2–3 reps regardless of duration: 1.80x a 25-minute slot
      // and 0.44x a 150-minute one. Both the rep length and the rep count now
      // come from the room available.
      const room = Math.max(0, sec - MIN_WARM_SEC * 2 - MIN_COOL_SEC * 2);
      const nominal = sec >= 4500 ? 720 : 600;
      const repSec = Math.max(240, Math.min(nominal, Math.floor((room - BIKE_THR_REC_SEC) / 2)));
      const reps = repsWithin(room, repSec, BIKE_THR_REC_SEC, 2, 5);
      const set = reps * repSec + BIKE_THR_REC_SEC * (reps - 1);
      const { warmSec, coolSec } = fitAround(sec, set, 0.6);
      return {
        blocks: [
          { kind: "warmup", zone: "easy", durationSec: warmSec, effortNote: `ramp + 3 × 30s @ ${z.bike.vo2}` },
          { kind: "main", zone: "threshold", reps, durationSec: repSec, recoverySec: BIKE_THR_REC_SEC, recoveryNote: "easy", effortNote: `@ ${z.bike.threshold}` },
          { kind: "cooldown", zone: "recovery", durationSec: coolSec, effortNote: "spin" },
        ],
        text: `WARMUP ${mm(warmSec)} min ramp + 3 × 30s @ ${z.bike.vo2}\nMAIN ${reps} × ${mm(repSec)} min @ ${z.bike.threshold} on ${mm(BIKE_THR_REC_SEC)} min easy\nCOOLDOWN ${mm(coolSec)} min spin`,
      };
    },
    why: "FTP work: moves the number every other bike target hangs off.",
  },
  "bike-vo2": {
    discipline: "bike",
    intensity: 0.83,
    title: () => "VO2 bike set",
    build: (z, sec) => {
      // This one ignored its argument entirely and built a fixed 47 minutes —
      // 1.88x a 25-minute slot, 0.31x a 150-minute one, the worst of the set.
      const room = Math.max(0, sec - MIN_WARM_SEC * 2 - MIN_COOL_SEC * 2);
      const reps = repsWithin(room, BIKE_VO2_REP_SEC, BIKE_VO2_REC_SEC, 4, 10);
      const set = reps * BIKE_VO2_REP_SEC + BIKE_VO2_REC_SEC * (reps - 1);
      const { warmSec, coolSec } = fitAround(sec, set, 0.6);
      return {
        blocks: [
          { kind: "warmup", zone: "easy", durationSec: warmSec, effortNote: "with 4 × 20s openers" },
          { kind: "main", zone: "vo2", reps, durationSec: BIKE_VO2_REP_SEC, recoverySec: BIKE_VO2_REC_SEC, recoveryNote: "easy", effortNote: `@ ${z.bike.vo2}` },
          { kind: "cooldown", zone: "recovery", durationSec: coolSec, effortNote: "spin" },
        ],
        text: `WARMUP ${mm(warmSec)} min with 4 × 20s openers\nMAIN ${reps} × ${mm(BIKE_VO2_REP_SEC)} min @ ${z.bike.vo2} on ${mm(BIKE_VO2_REC_SEC)} min easy\nCOOLDOWN ${mm(coolSec)} min spin`,
      };
    },
    why: "Short hard repeats lift aerobic power without wrecking the week.",
  },
  "bike-long": {
    discipline: "bike",
    intensity: 0.68,
    title: (m) => `Long ride ${Math.round((m / 60) * 10) / 10}h`,
    build: (z, sec) => {
      // The 2 × 20 min tempo happens INSIDE the ride. It used to be appended
      // to a main block that already spanned the whole duration, so a ride
      // structured at 2.60x its declared length at the short end.
      const insert = BIKE_LONG_TEMPO_REPS * BIKE_LONG_TEMPO_SEC;
      const { leadSec, tailSec, fits } = splitAround(sec, insert);
      const blocks: Block[] = fits
        ? [
            { kind: "main", zone: "easy", durationSec: leadSec, effortNote: `mostly @ ${z.bike.z2}` },
            { kind: "segment", zone: "tempo", reps: BIKE_LONG_TEMPO_REPS, durationSec: BIKE_LONG_TEMPO_SEC, effortNote: `@ ${z.bike.tempo} if legs agree` },
            { kind: "main", zone: "easy", durationSec: tailSec, effortNote: `mostly @ ${z.bike.z2}` },
          ]
        : [{ kind: "main", zone: "easy", durationSec: sec, effortNote: `mostly @ ${z.bike.z2}` }];
      // The fuel line is coaching prose, not a training block; it lives in the
      // derived text only (see docs/workout-structure.md).
      const tempoLine = fits
        ? `\ninclude ${BIKE_LONG_TEMPO_REPS} × ${mm(BIKE_LONG_TEMPO_SEC)} min @ ${z.bike.tempo} in the middle if legs agree`
        : "";
      return {
        blocks,
        text: `${mm(sec)} min mostly @ ${z.bike.z2}${tempoLine}\nfuel: 60–90g carbs/hr from minute 20`,
      };
    },
    why: "Race-day durability and fueling practice in one session.",
  },
  // The two swim templates are DISTANCE-defined and carry no block durations:
  // swimmers train in metres, and a block's seconds cannot be derived without
  // the athlete's pace, which a Block does not carry. They therefore declare
  // no structured time to disagree with, and the fresh-session duration
  // assertion skips them by construction rather than by exception. Classifying
  // their intensity is engine/readiness.ts's job, not a duration question.
  "swim-endurance": {
    discipline: "swim",
    intensity: 0.6,
    title: (m) => `Endurance swim ${m}`,
    build: (z, sec) => {
      const main = Math.max(3, Math.round((sec / 60 - 20) / 8));
      return {
        blocks: [
          { kind: "warmup", zone: "easy", distanceM: 400, effortNote: "easy mixed" },
          { kind: "main", zone: "easy", reps: main, distanceM: 300, recoverySec: 30, recoveryNote: "rest", effortNote: `@ ${z.swim.easy}` },
          { kind: "cooldown", zone: "recovery", distanceM: 200, effortNote: "choice" },
        ],
        text: `WARMUP 400 easy mixed\nMAIN ${main} × 300 @ ${z.swim.easy} on 30s rest\nCOOLDOWN 200 choice`,
      };
    },
    why: "Feel for the water is rented, never owned: frequency keeps the lease.",
  },
  "swim-threshold": {
    discipline: "swim",
    intensity: 0.7,
    title: () => "CSS swim set",
    build: (z) => ({
      blocks: [
        { kind: "warmup", zone: "easy", distanceM: 400, effortNote: "as 50 drill/50 swim" },
        { kind: "main", zone: "cv", reps: 10, distanceM: 100, recoverySec: 20, recoveryNote: "rest", effortNote: `@ ${z.swim.threshold}` },
        { kind: "main", zone: "vo2", reps: 4, distanceM: 50, recoverySec: 30, effortNote: `@ ${z.swim.vo2}` },
        { kind: "cooldown", zone: "recovery", distanceM: 200, effortNote: "easy" },
      ],
      text: `WARMUP 400 as 50 drill/50 swim\nMAIN 10 × 100 @ ${z.swim.threshold} on 20s rest\n4 × 50 @ ${z.swim.vo2} on 30s\nCOOLDOWN 200 easy`,
    }),
    why: "Critical-swim-speed work: open-water pace without open-water chaos.",
  },
};

/**
 * Build every duration-bearing field of a session from ONE duration, so the
 * stored duration, the title and the blocks cannot disagree.
 *
 * `hr` must already be quantised the way the caller intends to store it (the
 * long-run rail FLOORS rather than rounds, deliberately — see its call site),
 * because the budget is derived from the stored value, not the other way
 * round. Five sites used to repeat this by hand and all five computed the
 * title from mins(), a nearest-5 rounding of a duration they then stored to
 * two decimals.
 */
function fitSession(t: Template, zones: Zones, hr: number): { title: string; structure: string; blocks: Block[] } {
  const sec = Math.round(hr * 3600);
  const built = t.build(zones, sec);
  return { title: t.title(Math.round(sec / 60)), structure: built.text, blocks: built.blocks };
}

// ——— weekly slot layout ————————————————————————————————————————

interface Slot {
  weekdayIdx: number; // 0 = Monday
  kind: Kind;
  weight: number;
}

// Priority to KEEP when a template yields more slots than daysPerWeek
// (highest first): long ride, long run, the quality run, bike work, then
// fillers and swims. Applied generically so future template edits cannot
// silently exceed the athlete's chosen days.
const KEEP_PRIORITY: Kind[] = [
  "bike-long",
  "run-long",
  "run-vo2",
  "run-tempo",
  "bike-vo2",
  "bike-threshold",
  "bike-z2",
  "run-strides",
  "run-easy",
  "swim-threshold",
  "swim-endurance",
];

/** Drop lowest-priority slots until the week fits daysPerWeek. Survivors
 * keep their original weekdayIdx — no redistribution. */
function capToDays(slots: Slot[], daysPerWeek: number): Slot[] {
  const out = [...slots];
  while (out.length > daysPerWeek) {
    let drop = 0;
    for (let i = 1; i < out.length; i++) {
      if (KEEP_PRIORITY.indexOf(out[i].kind) >= KEEP_PRIORITY.indexOf(out[drop].kind)) drop = i;
    }
    out.splice(drop, 1);
  }
  return out;
}

const DEFAULT_MAX_SESSIONS = 5;

// Representative intensity zone per slot kind, for the tissue maxSessionIntensity
// cap (feature 4). Easy/long/z2/swim kinds are absent ⇒ never capped.
const KIND_ZONE: Partial<Record<Kind, Zone>> = {
  "run-tempo": "tempo",
  "run-vo2": "vo2",
  "run-strides": "vo2",
  "bike-threshold": "threshold",
  "bike-vo2": "vo2",
};
const ZONE_RANK: Zone[] = ["recovery", "easy", "tempo", "threshold", "cv", "vo2", "race"];
const zRank = (z: Zone) => ZONE_RANK.indexOf(z);

/** Downgrade a quality slot when an active tissue maxSessionIntensity cap forbids
 *  its zone (feature 4): vo2→tempo→easy, strides (inherently fast) drop to easy,
 *  bike quality steps down. Identity when uncapped or the slot is already legal. */
function capKindIntensity(kind: Kind, cap: Zone | undefined): Kind {
  const z = cap ? KIND_ZONE[kind] : undefined;
  if (!cap || z === undefined || zRank(z) <= zRank(cap)) return kind;
  switch (kind) {
    case "run-vo2":
      return zRank("tempo") <= zRank(cap) ? "run-tempo" : "run-easy";
    case "run-tempo":
      return "run-easy";
    case "run-strides":
      return "run-easy";
    case "bike-vo2":
      return zRank("threshold") <= zRank(cap) ? "bike-threshold" : "bike-z2";
    case "bike-threshold":
      return "bike-z2";
    default:
      return kind;
  }
}

function slotsFor(req: PlanRequest, phase: Phase): Slot[] {
  const longIdx = req.longDay === "saturday" ? 5 : 6;
  const otherWeekend = req.longDay === "saturday" ? 6 : 5;
  const quality: Kind = phase === "base" || phase === "offseason" ? "run-tempo" : "run-vo2";
  // Sessions/week is the tighter of the athlete's available days and the
  // maxSessions cap (default 5). Applies to TRAINING slots only: the race
  // session is protocol, appended downstream, and exempt from the count.
  // capToDays drops lowest-priority slots and the fixed weekly TSS then
  // redistributes over the survivors' weights, so the long session keeps
  // its (largest) share of the volume.
  const cap = Math.min(
    req.daysPerWeek,
    Math.max(3, Math.round(req.maxSessions ?? DEFAULT_MAX_SESSIONS))
  );

  if (!isTri(req.raceType)) {
    // Intensity distribution is a first-class constraint (feature 1): base and
    // recovery phases lay aerobic VOLUME and carry a single quality touch, so
    // the week lands near the elite 88–92% Z1 mark. Build/taper/race earn a
    // second quality session for race-specific sharpening. The midweek slot is
    // therefore easy in base/recovery/offseason and tempo only once building.
    const midweekQuality = phase === "build";
    const slots: Slot[] = [
      { weekdayIdx: 1, kind: quality, weight: 1.15 },
      { weekdayIdx: 3, kind: midweekQuality ? "run-tempo" : "run-easy", weight: 1.1 },
      { weekdayIdx: 4, kind: "run-strides", weight: 0.75 },
      { weekdayIdx: longIdx, kind: "run-long", weight: 1.7 },
    ];
    if (req.daysPerWeek >= 5) slots.push({ weekdayIdx: 2, kind: "run-easy", weight: 0.8 });
    if (req.daysPerWeek >= 6) slots.push({ weekdayIdx: otherWeekend, kind: "run-easy", weight: 0.85 });
    if (req.daysPerWeek >= 7) slots.push({ weekdayIdx: 0, kind: "bike-z2", weight: 0.6 });
    return capToDays(slots, cap);
  }

  const slots: Slot[] = [
    { weekdayIdx: 1, kind: quality, weight: 1.0 },
    { weekdayIdx: 2, kind: "swim-threshold", weight: 0.6 },
    { weekdayIdx: 3, kind: phase === "build" || phase === "taper" ? "bike-threshold" : "bike-z2", weight: 1.05 },
    { weekdayIdx: longIdx, kind: "bike-long", weight: 1.6 },
    { weekdayIdx: otherWeekend, kind: "run-long", weight: 1.25 },
  ];
  if (req.daysPerWeek >= 6) slots.push({ weekdayIdx: 4, kind: "swim-endurance", weight: 0.55 });
  if (req.daysPerWeek >= 7) slots.push({ weekdayIdx: 0, kind: "run-easy", weight: 0.6 });
  return capToDays(slots, cap);
}

// ——— date helpers ————————————————————————————————————————————

const DAY = 86400000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

function mondayOnOrAfter(dateStr: string): number {
  const t = Date.parse(dateStr + "T12:00:00Z");
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return dow === 0 ? t : t + (7 - dow) * DAY;
}

function mondayOnOrBefore(dateStr: string): number {
  const t = Date.parse(dateStr + "T12:00:00Z");
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return t - dow * DAY;
}

// ——— generation ————————————————————————————————————————————————

export function generatePlan(
  req: PlanRequest,
  initialState: AthleteState,
  history: Array<{ state: AthleteState; actualTss: number; weekStart?: string }>,
  zones: Zones
): Plan {
  // Anchor-v2 is the default; anchorLegacy (or env ANCHOR_LEGACY=1) opts out.
  // anchorV2 is threaded through only as the accepted no-op alias.
  const engine = new TaperV1({
    anchorLegacy: req.anchorLegacy,
    anchorV2: req.anchorV2,
    priorWeights: req.priorWeights,
    eras: req.eras,
  });
  for (const h of history) engine.observe(h.state, h.actualTss, h.weekStart);

  // Race goal → required-CTL target (engine/goal.ts). Parsed once. Only run
  // distances carry a goal target (raceDistanceKm is undefined for tri types),
  // so goalTime is inert for a triathlon. An unparseable/empty string leaves
  // `goal` undefined and the whole feature dormant — the plan is byte-identical
  // to a goal-less plan. `goalPeakCtl` is threaded onto each week's state below;
  // it is the SOLE trigger for the learned-layer goal floor and never touches
  // the backtest (which never calls generatePlan) — see engine/types.ts.
  // Refinements 3+4 (hoisted above the goal model for E4): every km-priced
  // and km-timed quantity — INCLUDING the goal's required CTL — derives from
  // the ATHLETE's threshold speed.
  const vTmps = thresholdMpsFromZones(zones);
  const cvol = cvolFor(vTmps);
  const easyKmh = easyKmhFor(vTmps);
  const qualityKmh = qualityKmhFor(vTmps);

  const goalDistanceKm = raceDistanceKm(req.raceType);
  const parsedGoalSec = req.goalTime ? parseGoalTime(req.goalTime) : undefined;
  // Plausibility guard (invalid ⇒ inert): reject a superhuman implied pace — e.g.
  // "1:24" parsed as 84 s (MM:SS) for a half is 4 s/km, which would otherwise
  // yield a ~65,000 km/wk target. Anything faster than ~2:20/km (140 s/km, well
  // inside any world record) is treated as a mis-entered time and left dormant.
  const goalSec =
    parsedGoalSec !== undefined && goalDistanceKm !== undefined && parsedGoalSec / goalDistanceKm < 140
      ? undefined
      : parsedGoalSec;
  const goal: GoalCtl | undefined =
    goalSec !== undefined && goalDistanceKm !== undefined
      ? goalCtlTarget(goalDistanceKm, goalSec, cvol)
      : undefined;
  const isRunRace = goalDistanceKm !== undefined;
  // Active tissue caps (feature 4). Null when none declared/inferred ⇒ every cap
  // site below takes its pre-existing path, so a healthy plan is byte-identical
  // whether the field is absent or []. The long-run ceiling is the ONLY blanket
  // cap that used to exist (INJURY_CAP_KM); it now arrives here, justified.
  const caps: TissueCaps | null = activeTissueCaps(req.tissueConstraints);
  const longPeakKm = peakLongKm(req.raceType, caps?.longRunKm ?? Infinity);
  // Feature 2: peak weekly-VOLUME floor (as TSS) driving the plan directly. The
  // goal term uses goal.peakCtl·7 — the exact expression the learned goal floor
  // uses — so when the goal dominates this equals the goal floor and goal plans
  // stay byte-identical; the evidence km floor only lifts a modest-goal/goal-less
  // plan. A tissue weekly cap pulls it down (may go below the evidence floor →
  // the goal-gap surfaces the shortfall).
  const tissueWeeklyCapTss = caps?.weeklyKm != null ? caps.weeklyKm * cvol : Infinity;
  const peakWeeklyTssFloor = isRunRace
    ? Math.min(Math.max(EVIDENCE_FLOOR[req.raceType].weeklyKm * cvol, goal ? goal.peakCtl * 7 : 0), tissueWeeklyCapTss)
    : 0;
  const peakWeeklyKmTarget = isRunRace
    ? peakWeeklyKm(req.raceType, goal ? goal.weeklyTss : 0, caps?.weeklyKm ?? Infinity, thresholdMpsFromZones(zones))
    : 0;
  // Feature 3: base-richness → per-athlete ramp ceiling. Logged history plus a
  // demonstrated historical peak from the race anchors (a prior season's CTL
  // that predates the weekly window — how the calibration athlete's 2023 base is
  // seen). Empty history ⇒ undefined ⇒ the default +20% rail stands (synthetic
  // seeds & the backtest). Never above an active tissue rampCeiling.
  // E6: anchors arrive on the request — generatePlan does no file I/O itself.
  const richnessAnchors = req.raceAnchors ?? [];
  const peakHistHint = richnessAnchors.length ? Math.max(0, ...richnessAnchors.map((a) => a.ctlAtRace)) : 0;
  const richness = deriveBaseRichness(history, initialState.ctl, peakHistHint);
  const planRampCap = richness
    ? Math.min(rampCapFromRichness(richness.richness), caps?.rampCeiling ?? Infinity)
    : caps?.rampCeiling; // no richness signal: only a tissue ramp cap (if any) binds
  let prevLongKm: number | undefined;
  // Set by the fraction-rail enforcement below when it actually shortens a
  // long run — an explicit signal, so the honesty flag never has to infer it
  // by comparing peaks measured on DIFFERENT weeks (which read false while
  // the rail was plainly binding).
  let fractionRailBound = false; // tracked across the week loop (like prevPrescribed)

  const raceT = Date.parse(req.raceDate + "T12:00:00Z");
  const startDateStr = req.startDate ?? iso(Date.now());
  if (req.raceDate < startDateStr) throw new Error("race date is in the past");

  // Tune-up races (B-races): validate the window up front, then precompute the
  // dates each one softens. The final 10 days belong to the goal race's taper.
  const tuneups = req.tuneups ?? [];
  for (const t of tuneups) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) throw new Error(`tune-up date "${t.date}" must be YYYY-MM-DD`);
    if (t.date < startDateStr)
      throw new Error(`tune-up ${t.date} is before the plan starts (${startDateStr}) — outside the plan window`);
    if (Date.parse(t.date + "T12:00:00Z") > raceT - 10 * DAY)
      throw new Error(`tune-up ${t.date} is too close to the goal race — the final 10 days are its taper`);
  }
  const tuneupDates = new Set(tuneups.map((t) => t.date));
  const tuneupDayBefore = new Set(tuneups.map((t) => iso(Date.parse(t.date + "T12:00:00Z") - DAY)));
  const tuneupDayAfter = new Set(tuneups.map((t) => iso(Date.parse(t.date + "T12:00:00Z") + DAY)));
  // Mid-week signup for a race that same week (e.g. Tue signup, Sat race):
  // next Monday would overshoot the race, so anchor on the CURRENT week's
  // Monday instead and filter pre-startDate sessions out of the emitted week.
  let start = mondayOnOrAfter(startDateStr);
  if (start > raceT) start = mondayOnOrBefore(startDateStr);

  let ctl = initialState.ctl;
  let atl = initialState.atl;
  // Seed the trailing window from the fuller trailingWeeksTss when the caller
  // supplied it (the replan re-baseline passes up to 8 real executed weeks);
  // otherwise fall back to the 4-week signal. Normal seeds carry only
  // last4WeeksTss, so this is byte-identical for regular generation.
  const seedTrailing =
    initialState.trailingWeeksTss && initialState.trailingWeeksTss.length > initialState.last4WeeksTss.length
      ? initialState.trailingWeeksTss
      : initialState.last4WeeksTss;
  const last8: number[] = [...seedTrailing];
  let weeksSinceStart = initialState.weeksSinceStart;
  let raceMorning: { ctl: number; tsb: number } | null = null;
  // Feature 5: a SECOND, run-only PMC accumulator (same τ=42/7 recursion) so
  // running-specific CTL is never conflated with total (run + cross-training)
  // CTL. Seeded from the all-discipline current state — exact for the run-primary
  // calibration athlete, a documented approximation for a multi-sport athlete.
  let runCtl = initialState.ctl;
  let runAtl = initialState.atl;
  let raceMorningRun: { ctl: number; tsb: number } | null = null;
  let prevPrescribed: number | undefined; // week 1 has none (see AthleteState)

  const weeks: PlanWeek[] = [];

  for (let wStart = start; wStart <= raceT; wStart += 7 * DAY) {
    const daysToRace = Math.round((raceT - wStart) / DAY);
    const last4 = last8.slice(-4);
    const state: AthleteState = {
      ctl,
      atl,
      tsb: ctl - atl,
      last4WeeksTss: last4,
      trailingWeeksTss: [...last8],
      prevPrescribedTss: prevPrescribed,
      // The opening week of the plan (and only it) — the sole trigger for the
      // anchor-v2 week-1 base floor. weeks[] is pushed at the end of each
      // iteration, so length 0 is exactly week index 0.
      isFirstPlanWeek: weeks.length === 0,
      // Plan-only goal target (see above / engine/types.ts). Drives the
      // learned-layer goal floor; absent on the backtest path.
      goalPeakCtl: goal?.peakCtl,
      // Plan-only evidence weekly-volume floor as TSS (feature 2). Set only when
      // a GOAL is present — it SUPPLEMENTS the goal floor (lifting a modest-goal
      // HM toward the ≥32 km evidence target), and the goal term uses goal.peakCtl·7
      // so when the goal dominates this equals the goal floor and those plans are
      // byte-unchanged. A goal-less plan carries no periodization target, so the
      // floor stays off there (and off the backtest — no goal, no signal).
      peakWeeklyTssFloor: isRunRace && goal ? peakWeeklyTssFloor : undefined,
      // Plan-only per-athlete ramp ceiling (feature 3). Undefined ⇒ learned layer
      // uses the default +20% rail (backtest byte-identical).
      rampCap: planRampCap,
      last4Shares: initialState.last4Shares,
      daysToNextRace: daysToRace,
      weeksSinceStart,
      breakRatio:
        last8.length >= 2
          ? mean(last8.slice(-2)) / Math.max(1, mean(last8))
          : 1,
      daysSinceLastSession: 1,
    };
    const p = engine.prescribeWeek(state);
    const raceWeek = daysToRace <= 6;

    // The tune-up falling inside THIS week, if any (validation keeps them out
    // of the goal race's final 10 days, so raceWeek and tuneup never overlap).
    const tuneup = tuneups.find((t) => {
      const d = Date.parse(t.date + "T12:00:00Z");
      return d >= wStart && d < wStart + 7 * DAY;
    });
    const tuneupTss = tuneup ? RACE_TSS[tuneup.raceType] : 0;

    // Race day consumes part of a race week's budget; a tune-up week's budget
    // absorbs the B-race load the same way — never stacked on top.
    const raceTss = RACE_TSS[req.raceType];
    const trainableTss = raceWeek
      ? Math.max(40, p.weekTss * 0.55)
      : tuneup
        ? Math.max(40, p.weekTss - tuneupTss)
        : p.weekTss;

    const slots = slotsFor(req, p.phase)
      .filter((s) => iso(wStart + s.weekdayIdx * DAY) < req.raceDate)
      .sort((a, b) => a.weekdayIdx - b.weekdayIdx);
    // Race weeks keep only short sharpeners.
    const active = raceWeek
      ? slots.filter((s) => !s.kind.includes("long")).map((s) => ({ ...s, weight: s.weight * 0.6 }))
      : slots;

    // NOTE: computed from `active`, not `placed` — the pre-race long-run drop
    // below deliberately does NOT redistribute (race proximity makes the week
    // lighter). Tune-up weeks are the exception: their dropped race-day slot
    // renormalizes so the trainable budget still lands (`tuneupWeightScale`).
    // No "long" session inside the final 6 days before the gun, even when the
    // race falls early in a week (a Monday race makes the preceding taper week
    // NOT a race week, yet its weekend long slots land the day before the
    // start line). The dropped share is NOT redistributed — race proximity
    // simply makes the week lighter, which is correct.
    const placed = active
      .filter((s) => !(s.kind.includes("long") && wStart + s.weekdayIdx * DAY >= raceT - 6 * DAY))
      // Feature 4: a tissue maxSessionIntensity cap downgrades over-cap quality
      // slots to legal ones (byte-identical when no such cap is active).
      .map((s) => ({ ...s, kind: capKindIntensity(s.kind, caps?.maxSessionIntensity) }))
      // Tune-up shaping (checked against DATES, so a Monday race also softens
      // the Sunday before, across the week boundary): the race day itself is
      // protocol, not a slot; the day before drops to openers; the day after
      // to recovery; and everything else in a tune-up week goes easy — the
      // race IS the week's quality.
      .filter((s) => !tuneupDates.has(iso(wStart + s.weekdayIdx * DAY)))
      .map((s) => {
        const dIso = iso(wStart + s.weekdayIdx * DAY);
        const isRun = TEMPLATES[s.kind].discipline === "run";
        if (tuneupDayBefore.has(dIso))
          return isRun
            ? { ...s, kind: "run-strides" as Kind, weight: Math.min(s.weight, 0.5) }
            : { ...s, kind: capKindIntensity(s.kind, "easy"), weight: Math.min(s.weight, 0.5) };
        if (tuneupDayAfter.has(dIso))
          return isRun
            ? { ...s, kind: "run-easy" as Kind, weight: Math.min(s.weight, 0.6) }
            : { ...s, kind: capKindIntensity(s.kind, "easy"), weight: Math.min(s.weight, 0.6) };
        if (tuneup) return { ...s, kind: capKindIntensity(s.kind, "easy") };
        return s;
      });
    // Tune-up weeks renormalize over the surviving slots (the race-day slot's
    // share must not vanish — its load returns as the race session). All other
    // weeks keep the `active` basis, byte-identical to before tuneups existed.
    const totalWeight =
      (tuneup ? placed.reduce((s, x) => s + x.weight, 0) : active.reduce((s, x) => s + x.weight, 0)) || 1;
    // Long-run distance-tied floor (goal plans only, base/build/recovery —
    // docs/periodization-spec.md §5). The reference taper/race weeks defer 100%
    // to their own decay (rule 2), so the floor is skipped there. It sets the
    // run-long DURATION from the injury-capped distance progression (≤ +2 km &
    // ≤ +8%/week, cap 24 km / 130 min, flat on cutbacks) and lets that session's
    // TSS track the duration, then redistributes the remainder over the other
    // sessions so the WEEK total stays = trainableTss (the rail-bound
    // prescription). Decoupling long-run distance from week volume this way is
    // what keeps the +20% ramp ceiling / TSB floor intact while the long run
    // grows: CTL rises from the goal FLOOR on p.weekTss (§2.2), not from
    // inflating the long session. The long run is capped at 60% of the week so
    // the other sessions never fall under their minimums.
    const longSlot = placed.find((s) => s.kind === "run-long");
    const LONG_IF2 = TEMPLATES["run-long"].intensity * TEMPLATES["run-long"].intensity * 100;
    let longFloorHr: number | undefined;
    // The fraction rail is an INJURY rail, so it applies to every run plan
    // with a long slot — the matrix found it conditioned on `goal &&`, which
    // left goal-less athletes with no rail at all (a latent gap: their
    // weight-based share happened to stay under the cap, but protection must
    // not depend on having typed a goal time).
    if (isRunRace && longSlot && (p.phase === "base" || p.phase === "build" || p.phase === "recovery")) {
      const baseLongHr = (trainableTss * longSlot.weight) / totalWeight / LONG_IF2;
      const capHr = (trainableTss * 0.6) / LONG_IF2; // long run ≤ 60% of the week
      // Refinement 5: the long run may not exceed ~35% of the week's running
      // km — the volume-FRACTION overuse pattern the absolute caps miss. The
      // other days' km are computed at the SAME per-kind speeds the
      // achieved-km measurement uses (a TSS-bridge estimate understates
      // easy-heavy weeks ~1.8×), using the closed form long ≤ f/(1−f)·others.
      //
      // Self-consistency is the part the matrix caught missing: the cap used
      // to be computed against the other days' UNSCALED km, and when the
      // goal progression pushed the long above its natural share, the
      // redistribution then SHRANK those days — the realized fraction landed
      // at up to 39% while the cap believed 35%. The rail outranks the
      // progression floor, so the cap now iterates against the km the other
      // days will actually have AFTER redistribution (fixed point in ≤3
      // rounds; duration floors only make it conservative).
      const kmOfSlot = (s: Slot, scale: number) => {
        const t = TEMPLATES[s.kind];
        if (t.discipline !== "run") return 0;
        const tss = ((trainableTss * s.weight) / totalWeight) * scale;
        const dur = Math.min(1.6, Math.max(0.4, tss / (t.intensity * t.intensity * 100)));
        return dur * (KIND_ZONE[s.kind] ? qualityKmh : easyKmh);
      };
      const otherSlots = placed.filter((s) => s.kind !== "run-long");
      const otherBase = otherSlots.reduce((a, s) => a + (trainableTss * s.weight) / totalWeight, 0);
      const othersKmAt = (scale: number) => otherSlots.reduce((a, s) => a + kmOfSlot(s, scale), 0);
      // The pre-cap candidate the caps act on: the goal progression when a
      // goal exists (week-1 opens near ~13 km, later weeks step ≤ +2 km,
      // cutbacks hold), else the slot's natural weight-based share.
      // The 60% budget cap belongs to the goal progression — it stops a
      // low-volume early week over-weighting a progression-driven long run.
      // A goal-less week's long run is already its natural share, so only the
      // INJURY rail (the fraction) applies there.
      let candidateHr: number;
      if (goal) {
        const startKm = Math.min(13, longPeakKm * 0.6);
        const targetKm =
          prevLongKm === undefined
            ? Math.min(longPeakKm, Math.max(baseLongHr * easyKmh, startKm))
            : longRunKm(prevLongKm, longPeakKm, p.phase === "recovery");
        // 2.6 h is the universal session-length sanity bound.
        candidateHr = Math.min(Math.max(Math.min(targetKm / easyKmh, 2.6), baseLongHr), capHr);
      } else {
        candidateHr = baseLongHr;
      }
      // The fraction a given long duration ACTUALLY realizes, measured after
      // the redistribution that duration itself causes. The old closed form
      // divided by the other days' UNSCALED km, so when the progression
      // pushed the long above its natural share the redistribution shrank
      // those days underneath it and the realized fraction reached 39%.
      const realizedFrac = (lHr: number): number => {
        // Mirrors otherScale below EXACTLY, including that it is unclamped:
        // when the long sits below its natural share the other days grow, and
        // clamping that away here would over-tighten the rail in precisely
        // the region the bisection explores.
        const scale = otherBase > 0 ? Math.max(0, trainableTss - LONG_IF2 * lHr) / otherBase : 1;
        const oKm = othersKmAt(scale);
        const lKm = lHr * easyKmh;
        return lKm + oKm > 0 ? lKm / (lKm + oKm) : 0;
      };
      // Largest duration whose realized fraction clears the rail. realizedFrac
      // is monotone in lHr (a longer long run adds its own km AND removes the
      // other days'), so bisection lands exactly on the rail — a relaxation
      // loop here oscillates and settles below it, costing an established
      // athlete ~0.6 km of peak long run for no safety gain.
      let capped = candidateHr;
      if (realizedFrac(capped) > LONG_FRACTION_MAX) {
        let lo = 0;
        let hi = capped;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          if (realizedFrac(mid) > LONG_FRACTION_MAX) hi = mid;
          else lo = mid;
        }
        capped = lo;
      }
      // Goal plans always carry the floor (the progression is theirs); a
      // goal-less plan takes it ONLY when the injury rail actually binds below
      // the natural share — otherwise longFloorHr stays undefined and the week
      // is byte-identical to the pre-rail construction.
      if (goal || capped < baseLongHr - 1e-9) longFloorHr = capped;
    }
    const longFinalTss = longFloorHr !== undefined ? LONG_IF2 * longFloorHr : undefined;
    const otherBaseSum =
      longFinalTss !== undefined && longSlot
        ? placed.filter((s) => s !== longSlot).reduce((s, x) => s + (trainableTss * x.weight) / totalWeight, 0)
        : 0;
    const otherScale =
      longFinalTss !== undefined && otherBaseSum > 0
        ? Math.max(0, trainableTss - longFinalTss) / otherBaseSum
        : 1;

    // The rail-bound TSS and (for run-long) the tissue-capped duration a slot
    // carries — shared by the km-cap decision and the session build so they agree.
    const slotLoad = (slot: Slot) => {
      const t = TEMPLATES[slot.kind];
      const isLong = slot === longSlot;
      let tss = (trainableTss * slot.weight) / totalWeight;
      if (longFinalTss !== undefined) tss = isLong ? longFinalTss : tss * otherScale;
      let durationHr = tss / (t.intensity * t.intensity * 100);
      if (isLong && longFloorHr !== undefined) durationHr = longFloorHr;
      const ceil =
        slot.kind === "run-long" && caps?.longRunKm != null
          ? Math.min(2.6, longPeakKm / easyKmh)
          : slot.kind === "run-long" ? 2.6 : slot.kind === "bike-long" ? 4.5 : 1.6;
      return { tss, durationHr: Math.min(ceil, Math.max(0.4, durationHr)) };
    };
    const slotRunKm = (slot: Slot) =>
      TEMPLATES[slot.kind].discipline === "run" ? slotLoad(slot).durationHr * (KIND_ZONE[slot.kind] ? qualityKmh : easyKmh) : 0;

    // Feature 4/5: a tissue WEEKLY-KM cap caps RUNNING in km (not TSS — easy-heavy
    // weeks cost fewer TSS/km than CVOL assumes, so a TSS budget under-binds).
    // Convert the lowest-priority easy run days to non-impact cross-training —
    // preserving the DAY and its load — until running km fits the cap. This binds
    // the km ceiling AND respects daysPerWeek (replace a day, never add one). The
    // long run and quality days are protected. Inert when no weekly cap.
    const crossDays = new Set<number>();
    let protectedScale = 1; // extra shrink of the kept run days if quality+long alone overshoot
    if (caps?.weeklyKm != null && !raceWeek) {
      const droppable = () =>
        placed
          .filter((s) => (s.kind === "run-easy" || s.kind === "run-strides") && !crossDays.has(s.weekdayIdx))
          .sort((a, b) => KEEP_PRIORITY.indexOf(b.kind) - KEEP_PRIORITY.indexOf(a.kind));
      const keptRunKm = () => placed.filter((s) => !crossDays.has(s.weekdayIdx)).reduce((a, s) => a + slotRunKm(s), 0);
      for (let guard = 0; guard < placed.length && keptRunKm() > caps.weeklyKm; guard++) {
        const drop = droppable()[0];
        if (!drop) break;
        crossDays.add(drop.weekdayIdx);
      }
      // If the protected quality + long days still overshoot (their km alone
      // exceeds the cap), shrink them to fit; the freed load moves to the cross days.
      const km = keptRunKm();
      if (km > caps.weeklyKm) protectedScale = caps.weeklyKm / km;
    }
    // Freed running TSS (from the protected-day shrink) is redistributed over the
    // cross days so TOTAL aerobic load holds while running impact drops.
    const isRunSlot = (s: Slot) => TEMPLATES[s.kind].discipline === "run";
    const freedTss =
      protectedScale < 1
        ? placed.filter((s) => !crossDays.has(s.weekdayIdx) && isRunSlot(s)).reduce((a, s) => a + slotLoad(s).tss, 0) * (1 - protectedScale)
        : 0;
    const crossBoost = crossDays.size > 0 ? freedTss / crossDays.size : 0;
    const site = req.tissueConstraints?.[0]?.site.replace("-", " ") ?? "the tissue";

    const sessionKinds: Kind[] = [];
    let weekZ1FloorAction: PlanWeek["z1FloorAction"];
    const sessions: PlannedSessionOut[] = placed.map((slot) => {
      const substituted = crossDays.has(slot.weekdayIdx);
      // Kept run days shrink to the km cap; substituted days carry their load plus
      // a share of the freed running load, delivered impact-free.
      const tss = substituted
        ? slotLoad(slot).tss + crossBoost
        : isRunSlot(slot) && protectedScale < 1
          ? slotLoad(slot).tss * protectedScale
          : slotLoad(slot).tss;
      // A substituted day becomes a non-impact bike/pool session carrying the same
      // load, so total aerobic volume holds while running impact drops. Its duration
      // is re-derived at the cross template's intensity so the card is consistent.
      const kind = substituted ? crossKindFor(tss) : slot.kind;
      const t = TEMPLATES[kind];
      const isLong = slot === longSlot && !substituted;
      let durationHr = tss / (t.intensity * t.intensity * 100);
      // The long-run floor sets the duration UNLESS a tissue weekly cap is
      // shrinking the kept run days (then the scaled tss drives it — cap wins).
      if (isLong && longFloorHr !== undefined && protectedScale >= 1) durationHr = longFloorHr;
      const runLongCeilHr =
        !substituted && slot.kind === "run-long" && caps?.longRunKm != null
          ? Math.min(2.6, longPeakKm / easyKmh)
          : kind === "run-long" ? 2.6 : kind === "bike-long" ? 4.5 : substituted ? 2.5 : 1.6;
      durationHr = Math.min(runLongCeilHr, Math.max(0.4, durationHr));
      const date = iso(wStart + slot.weekdayIdx * DAY);
      // Quantise FIRST: the blocks are budgeted from the duration that gets
      // stored, so the two agree by construction rather than by luck.
      const storedHr = Math.round(durationHr * 100) / 100;
      const fit = fitSession(t, zones, storedHr);
      return {
        date,
        weekday: WEEKDAYS[slot.weekdayIdx],
        discipline: t.discipline,
        title: substituted ? `${fit.title} · cross-train` : fit.title,
        durationHr: storedHr,
        tss: Math.round(tss),
        structure: fit.structure,
        workout: { blocks: fit.blocks },
        why: substituted
          ? `Non-impact aerobic volume replacing a run your ${site} can't absorb — holds total aerobic load while running impact drops. Builds the engine, not the legs (it does not count toward running fitness).`
          : t.why,
        ...(substituted ? { substituted: true } : {}),
      };
    });
    placed.forEach((slot) => sessionKinds.push(crossDays.has(slot.weekdayIdx) ? crossKindFor(0) : slot.kind));

    // Feature-1 refinement: base/build run weeks are CONSTRUCTED to the phase
    // Z1 target (rct tier: Muñoz 2014 — polarized beat threshold-emphasis at
    // equal load), not merely checked against the floor afterwards. Time
    // transfers between the week's quality session and an easy day at
    // ~constant weekly TSS: too hard ⇒ the quality session shrinks and easy
    // volume grows; too easy ⇒ the reverse, bounded. The long run is never
    // donor or recipient (its distance progression is its own rail), and
    // cross-train/race sessions are protocol. A week with no quality touch
    // (tissue intensity cap) has nothing to transfer and is left as built —
    // all-easy already clears the floor. Runs before the long-run km tracking
    // and the PMC simulation, so both see the shaped week.
    if (isRunRace && (p.phase === "base" || p.phase === "build")) {
      const z1Target = targetDistribution(p.phase).z1;
      const z1Floor = z1FloorFor(p.phase);
      // The floor's last resort when the TSS transfer cannot act (donor pinned
      // at the duration floor, no donor/recipient pair, no representable
      // progress): rebuild the hardest session as easy AT THE SAME TSS — less
      // intensity, more easy volume, the week conserved. The rail outranks
      // the ±2% construction band; a demoted micro-week may sit above the
      // band, and says so via z1FloorAction. Returns false when nothing is
      // demotable (the week is then surfaced as unreachable).
      const demoteForFloor = (qi: number, easyKind: Kind): boolean => {
        if (qi < 0) return false;
        const q = sessions[qi];
        const t = TEMPLATES[easyKind];
        const rate = t.intensity * t.intensity * 100;
        const durationHr = Math.min(1.6, Math.max(0.4, q.tss / rate));
        q.durationHr = Math.round(durationHr * 100) / 100;
        const fit = fitSession(t, zones, q.durationHr);
        q.title = fit.title;
        q.structure = fit.structure;
        q.workout = { blocks: fit.blocks };
        sessionKinds[qi] = easyKind;
        weekZ1FloorAction = "demoted-quality";
        return true;
      };
      for (let round = 0; round < 5; round++) {
        const d = weekDistribution(sessions);
        if (d.totalSec <= 0 || Math.abs(d.z1Pct - z1Target) <= 0.02) break;
        let qi = -1;
        let qHard = 0;
        let ei = -1;
        let eZ1 = 0;
        for (let i = 0; i < sessions.length; i++) {
          const s = sessions[i];
          if (s.discipline !== "run" || s.substituted || !s.workout) continue;
          if (sessionKinds[i] === "run-long") continue;
          const zs = sessionZoneSeconds(s.workout);
          const hard = zs.z2 + zs.z3;
          if (hard > qHard) {
            qHard = hard;
            qi = i;
          }
          if (hard / Math.max(1, zs.z1 + hard) < 0.2 && zs.z1 > eZ1) {
            eZ1 = zs.z1;
            ei = i;
          }
        }
        const underFloor = d.z1Pct < z1Floor - 1e-9;
        if (qi < 0 || ei < 0 || qi === ei) {
          if (underFloor && demoteForFloor(qi, ei >= 0 ? sessionKinds[ei] : "run-easy")) continue;
          if (underFloor && qi < 0) weekZ1FloorAction = "unreachable";
          break;
        }
        const q = sessions[qi];
        const e = sessions[ei];
        const qKind = sessionKinds[qi];
        const eKind = sessionKinds[ei];
        const rateOf = (k: Kind) => TEMPLATES[k].intensity * TEMPLATES[k].intensity * 100;
        // The transfer works in TSS space and CONSERVES the week: whatever the
        // donor sheds the recipient absorbs, and duration follows tss with the
        // same 0.4–1.6 h clamps the original build used. A session already
        // pinned at the duration floor can't donate — its built structure (and
        // therefore its zone seconds) would not actually shrink, so tiny
        // floored weeks break out here byte-identical instead of pretending.
        const hardWant = (1 - z1Target) * d.totalSec;
        const hardRest = d.z2Sec + d.z3Sec - qHard;
        const scale = Math.min(1.5, Math.max(0.45, (hardWant - hardRest) / Math.max(60, qHard)));
        let qTssNew = q.tss * scale;
        let eTssNew = e.tss + (q.tss - qTssNew);
        if (qTssNew < q.tss) {
          if (q.durationHr <= 0.4 + 1e-6) {
            // Donor pinned at the duration floor — the break-out the matrix
            // caught breaching the 0.85 floor on CTL-20 weeks. Demote instead
            // of pretending, but only when the FLOOR (not the band) demands.
            if (d.z1Pct < z1Floor - 1e-9 && demoteForFloor(qi, sessionKinds[ei])) continue;
            break;
          }
          const eCap = rateOf(eKind) * 1.6;
          if (eTssNew > eCap) {
            eTssNew = eCap;
            qTssNew = q.tss - (eTssNew - e.tss);
          }
        } else {
          if (e.durationHr <= 0.4 + 1e-6) break; // easy pinned; over-band is not a rail breach
          const qCap = rateOf(qKind) * 1.6;
          const eFloor = rateOf(eKind) * 0.4;
          if (qTssNew > qCap) qTssNew = qCap;
          if (e.tss + (q.tss - qTssNew) < eFloor) qTssNew = q.tss - (eFloor - e.tss);
          eTssNew = e.tss + (q.tss - qTssNew);
        }
        if (Math.round(qTssNew) === q.tss) {
          if (d.z1Pct < z1Floor - 1e-9 && demoteForFloor(qi, sessionKinds[ei])) continue;
          break; // no representable progress and the floor holds
        }
        const rebuildInto = (s: PlannedSessionOut, kind: Kind, tss: number) => {
          const t = TEMPLATES[kind];
          const durationHr = Math.min(1.6, Math.max(0.4, tss / rateOf(kind)));
          s.durationHr = Math.round(durationHr * 100) / 100;
          s.tss = Math.round(tss);
          const fit = fitSession(t, zones, s.durationHr);
          s.title = fit.title;
          s.structure = fit.structure;
          s.workout = { blocks: fit.blocks };
        };
        rebuildInto(q, qKind, qTssNew);
        rebuildInto(e, eKind, eTssNew);
      }
    }
    // ——— Refinement 5, ENFORCED: the long run ≤ ~35% of the week's running
    // km, measured with the SAME ruler the plan, the tests and the UI use
    // (sessionRunKm/weekRunKm) — not a pre-construction model of it. The
    // matrix caught realized fractions reaching 39% because the closed form
    // above divides by the other days' pre-redistribution km, and the
    // intensity shaping then moves load around underneath it. Rails outrank
    // floors (§5.6), so when the goal progression and this rail disagree the
    // rail wins and the shortfall is surfaced through volumeTargets.
    if (isRunRace && longSlot) {
      const li = sessions.findIndex((x, i) => sessionKinds[i] === "run-long" && x.discipline === "run");
      if (li >= 0) {
        for (let round = 0; round < 4; round++) {
          const lKm = sessionRunKm(sessions[li], easyKmh, qualityKmh);
          const wKm = weekRunKm(sessions, easyKmh, qualityKmh);
          if (wKm <= 0 || lKm <= LONG_FRACTION_MAX * wKm + 1e-9) break;
          // Closed form against the other days' REAL km, so one pass usually
          // lands it; the loop only mops up the duration clamps.
          const allowedKm = (LONG_FRACTION_MAX / (1 - LONG_FRACTION_MAX)) * (wKm - lKm);
          const newHr = Math.max(0.4, allowedKm / easyKmh);
          if (newHr >= sessions[li].durationHr - 1e-6) break;
          fractionRailBound = true;
          const t = TEMPLATES["run-long"];
          const rate = t.intensity * t.intensity * 100;
          const freed = sessions[li].tss - Math.round(rate * (Math.floor(newHr * 100) / 100));
          // FLOOR, not round: the stored duration is what sessionRunKm
          // measures, and rounding up would put the week back over the rail
          // by a hair — a rail that rounds against itself is not a rail.
          const capHrRounded = Math.floor(newHr * 100) / 100;
          const fit = fitSession(t, zones, capHrRounded);
          sessions[li].durationHr = capHrRounded;
          sessions[li].tss = Math.round(rate * capHrRounded);
          sessions[li].title = fit.title;
          sessions[li].structure = fit.structure;
          sessions[li].workout = { blocks: fit.blocks };
          // The week is conserved: freed load goes to the easiest non-long
          // EASY run day, the safest place to put volume. Except when a tissue
          // weekly-RUNNING-km cap is active — then adding running km is
          // exactly what the cap forbids, so the load goes to a cross-training
          // day instead, and if there is none it is simply not re-added
          // (running volume is the constrained resource, not total load).
          if (freed > 0) {
            const runCapped = caps?.weeklyKm != null;
            let ei = -1;
            let eTss = Infinity;
            for (let i = 0; i < sessions.length; i++) {
              if (i === li || sessions[i].substituted) continue;
              const isRun = sessions[i].discipline === "run";
              if (runCapped ? isRun : !isRun) continue;
              if (isRun && KIND_ZONE[sessionKinds[i]]) continue; // quality day — leave the polarity alone
              if (sessions[i].tss < eTss) { eTss = sessions[i].tss; ei = i; }
            }
            if (ei >= 0) {
              const ek = sessionKinds[ei];
              const et = TEMPLATES[ek];
              const erate = et.intensity * et.intensity * 100;
              const eHr = Math.min(1.6, Math.max(0.4, (sessions[ei].tss + freed) / erate));
              sessions[ei].durationHr = Math.round(eHr * 100) / 100;
              sessions[ei].tss = Math.round(erate * eHr);
              const efit = fitSession(et, zones, sessions[ei].durationHr);
              sessions[ei].title = efit.title;
              sessions[ei].structure = efit.structure;
              sessions[ei].workout = { blocks: efit.blocks };
            }
          }
        }
      }
    }

    // Track the emitted long-run distance for next week's progression (like
    // prevPrescribed). Only base/build/recovery weeks carry a run-long here.
    const emittedLong = sessions.find((s) => longSlot && s.date === iso(wStart + longSlot.weekdayIdx * DAY) && s.discipline === "run");
    if (goal && isRunRace && emittedLong && (p.phase === "base" || p.phase === "build" || p.phase === "recovery")) {
      prevLongKm = emittedLong.durationHr * easyKmh;
    }

    if (tuneup) {
      const tDow = Math.round((Date.parse(tuneup.date + "T12:00:00Z") - wStart) / DAY);
      const distLabel = tuneup.raceType.startsWith("run-")
        ? tuneup.raceType.slice(4).toUpperCase()
        : tuneup.raceType;
      sessions.push({
        date: tuneup.date,
        weekday: WEEKDAYS[tDow],
        discipline: "race",
        title: tuneup.name?.trim() || `${distLabel} tune-up`,
        durationHr: Math.round((tuneupTss / 81) * 100) / 100, // ≈ IF 0.9
        tss: tuneupTss,
        structure:
          "Tune-up race. Full warm-up, honest effort, jog down. It calibrates pacing under race stress — the plan absorbs the load.",
        workout: {
          blocks: [
            {
              kind: "segment",
              zone: "race",
              effortNote:
                "Tune-up race — full warm-up, honest effort, jog down. Calibrates pacing under race stress.",
            },
          ],
        },
        why: "A rehearsal under race stress: pacing, fueling, nerves. This week's quality lives here, not on top of it.",
        tuneup: true,
      });
      sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }

    if (raceWeek) {
      const raceDow = (new Date(raceT).getUTCDay() + 6) % 7;
      sessions.push({
        date: req.raceDate,
        weekday: WEEKDAYS[raceDow],
        discipline: "race",
        title: req.raceName,
        durationHr: Math.round((raceTss / 81) * 100) / 100, // ≈ IF 0.9
        tss: raceTss,
        structure: `Race day. Pacing pack ships with the final taper revision; execute, don't improvise.`,
        workout: {
          blocks: [
            {
              kind: "segment",
              zone: "race",
              effortNote: `Race day. Pacing pack ships with the final taper revision; execute, don't improvise.`,
            },
          ],
        },
        why: "Everything above this line existed for today.",
      });
    }

    // Simulate PMC through the week, day by day. Two accumulators: total (all
    // sessions) and run-only (run + race discipline) — cross-training lifts the
    // former, never the latter (only running load predicts running performance).
    const tssByDate = new Map(sessions.map((s) => [s.date, s.tss] as [string, number]));
    const runTssByDate = new Map(
      sessions.filter((s) => s.discipline === "run" || s.discipline === "race").map((s) => [s.date, s.tss] as [string, number])
    );
    for (let d = 0; d < 7; d++) {
      const dayIso = iso(wStart + d * DAY);
      if (dayIso === req.raceDate) {
        raceMorning = { ctl: r1(ctl), tsb: r1(ctl - atl) };
        raceMorningRun = { ctl: r1(runCtl), tsb: r1(runCtl - runAtl) };
      }
      const dayTss = tssByDate.get(dayIso) ?? 0;
      ctl = ctl + (dayTss - ctl) / 42;
      atl = atl + (dayTss - atl) / 7;
      const dayRunTss = runTssByDate.get(dayIso) ?? 0;
      runCtl = runCtl + (dayRunTss - runCtl) / 42;
      runAtl = runAtl + (dayRunTss - runAtl) / 7;
    }
    // Projected = the state at the week's END, i.e. after the loop has
    // absorbed the week's sessions. (Snapshotting before the loop shipped
    // every card one week stale: week 1 showed the untouched seed.) TSB keeps
    // the yesterday-CTL−ATL convention: Sunday night's CTL/ATL are exactly
    // "yesterday" to the Monday morning the athlete wakes into.
    // run-only CTL/TSB attach ONLY when a tissue WEEKLY cap drove cross-training
    // substitution (feature 5) — never for a healthy all-running plan (byte-
    // identical) nor for a normal tri whose run<total is just the sport mix.
    const runDiverged = caps?.weeklyKm != null && Math.abs(runCtl - ctl) > 0.05;
    const projected = {
      ctl: r1(ctl),
      atl: r1(atl),
      tsb: r1(ctl - atl),
      ...(runDiverged ? { runCtl: r1(runCtl), runTsb: r1(runCtl - runAtl) } : {}),
    };

    // A plan may start mid-week (see the mondayOnOrBefore fallback): the PMC
    // simulation above still runs the full Monday-anchored week, but sessions
    // dated before the start are never emitted — don't prescribe the past.
    const emitted = sessions.filter((s) => s.date >= startDateStr);

    weeks.push({
      ...(weekZ1FloorAction ? { z1FloorAction: weekZ1FloorAction } : {}),
      weekStart: iso(wStart),
      phase: p.phase,
      targetTss: Math.round(emitted.reduce((s, x) => s + x.tss, 0)),
      projected,
      sessions: emitted,
    });

    last8.push(p.weekTss);
    if (last8.length > 8) last8.shift();
    prevPrescribed = p.weekTss;
    weeksSinceStart++;
  }

  const projectedRaceCtl = raceMorning ? raceMorning.ctl : r1(ctl);
  // Running-specific race-day CTL (feature 5). Present only when cross-training
  // made it diverge from total — then the finish is read from running fitness,
  // not the cross-training-inflated total (cross-training builds the engine, not
  // race-specific running). Byte-identical when there's no cross-training.
  const raceRunCtl = raceMorningRun ? raceMorningRun.ctl : r1(runCtl);
  const projectedRaceRunCtl =
    caps?.weeklyKm != null && Math.abs(raceRunCtl - projectedRaceCtl) > 0.05 ? raceRunCtl : undefined;

  // Honest goal-vs-reachable gap (spec §4). The reachable figure is literally
  // the plotted trajectory's race-morning CTL — computed under the rails, never
  // by loosening them — so the surfaced gap matches the emitted curve. The
  // finish is a load-limited BOUND (clamped no faster than the goal pace),
  // never a hard prediction (§1.3): a naturally fast runner can beat it.
  // Direct volume/long-run targets vs achieved (feature 2). The evidence floors
  // are the Fokkema minimum viable; a plan may fall below only when a tissue cap
  // legitimately holds it there (flagged, and named in the goal-gap copy).
  const floor = isRunRace ? EVIDENCE_FLOOR[req.raceType] : { weeklyKm: 0, longRunKm: 0 };
  const actualWeeklyKm = peakWeekRunKm(weeks, easyKmh, qualityKmh);
  const actualLongKm = peakLongRunKm(weeks, easyKmh);
  const volumeTargets = isRunRace
    ? {
        peakWeeklyKmTarget: r1(peakWeeklyKmTarget),
        peakWeeklyKmActual: r1(actualWeeklyKm),
        peakLongKmTarget: r1(longPeakKm),
        peakLongKmActual: r1(actualLongKm),
        weeklyFloorKm: floor.weeklyKm,
        longFloorKm: floor.longRunKm,
        meetsWeeklyFloor: actualWeeklyKm >= floor.weeklyKm - 0.5,
        meetsLongFloor: actualLongKm >= floor.longRunKm - 0.5,
        tissueActive: caps != null,
        // Refinement 5: true when the ~35% volume-fraction rail — not a
        // tissue cap — is what holds the long run under its evidence floor.
        // Drives the honest-tradeoff copy; never silently resolved.
        longCappedByFraction:
          actualLongKm < floor.longRunKm - 0.5 &&
          fractionRailBound &&
          (caps?.longRunKm == null || caps.longRunKm >= floor.longRunKm),
      }
    : undefined;

  // Only name a tissue long-run limit in the gap copy when one is actually
  // active — never prophylactically (feature 4). Label from the declared site(s).
  const tissueLongCapped = caps?.longRunKm != null;
  const tissueLabel = req.tissueConstraints?.[0]?.site.replace("-", " ") ?? "tissue";
  // The ramp % named in the copy is the athlete's ACTUAL ceiling (feature 3):
  // +20% by default, higher for a base-rich rebuild, clamped to [10,30]%.
  const effectiveRampCap = planRampCap === undefined ? 1.2 : Math.min(1.3, Math.max(1.1, planRampCap));
  const rampPct = Math.round((effectiveRampCap - 1) * 100);
  const baseRich = richness !== undefined && effectiveRampCap > 1.2;
  // Feature 2: when a floor is missed, the gap copy must SAY why (tissue cap, or
  // the ramp/runway still warming the volume up) — the target is not silently dropped.
  const volumeShortfall = (() => {
    if (!volumeTargets || (volumeTargets.meetsWeeklyFloor && volumeTargets.meetsLongFloor)) return "";
    const weeklyMissed = !volumeTargets.meetsWeeklyFloor;
    const longMissed = !volumeTargets.meetsLongFloor;
    // The tissue is the cause ONLY if every missed floor is a lever it actually
    // caps (feature 6 honesty) — a runway-limited weekly miss under a long-run-only
    // cap must NOT be blamed on the tissue, and cross-training is promised only
    // when the WEEKLY lever is what the tissue caps.
    const weeklyByTissue = weeklyMissed && caps?.weeklyKm != null;
    const longByTissue = longMissed && caps?.longRunKm != null;
    const tissueIsCause = (!weeklyMissed || weeklyByTissue) && (!longMissed || longByTissue) && (weeklyByTissue || longByTissue);
    if (tissueIsCause) {
      const xtrain = caps?.weeklyKm != null ? " Cross-training holds the aerobic side without the impact." : "";
      return ` Peak volume runs below the ${floor.weeklyKm} km / ${floor.longRunKm} km evidence floor because your ${tissueLabel} constraint caps it — not by choice.${xtrain}`;
    }
    // Refinement 5: the fraction rail vs the Fokkema long-run floor is a real
    // tradeoff — name it, with the numbers, instead of silently picking a side.
    if (longMissed && volumeTargets.longCappedByFraction) {
      return ` Weekly volume (~${Math.round(volumeTargets.peakWeeklyKmActual)} km) can't yet support a ${floor.longRunKm} km long run safely — the long run is held to ~${Math.round(LONG_FRACTION_MAX * 100)}% of the week (${Math.round(LONG_FRACTION_MAX * volumeTargets.peakWeeklyKmActual)} km) and grows as weekly volume does. The ${floor.longRunKm} km floor is the target, not tonight's assignment.`;
    }
    return ` Peak volume is still short of the ${floor.weeklyKm} km / ${floor.longRunKm} km evidence floor — the ramp needs more runway to build there safely.`;
  })();
  const goalGap =
    goal && goalDistanceKm !== undefined && goalSec !== undefined && req.goalTime
      ? buildGoalGap(req.goalTime, goal, projectedRaceRunCtl ?? projectedRaceCtl, goalDistanceKm, goalSec, r1(initialState.ctl), weeks.length, tissueLongCapped, tissueLabel, volumeShortfall, rampPct, baseRich, cvol, req.raceAnchors ?? [])
      : undefined;

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      engine: engine.name + (history.length ? `(${history.length}w)` : "(cold)"),
      raceName: req.raceName,
      raceDate: req.raceDate,
      raceType: req.raceType,
      daysPerWeek: req.daysPerWeek,
      longDay: req.longDay,
      startCtl: r1(initialState.ctl),
      projectedRaceCtl,
      projectedRaceTsb: raceMorning ? raceMorning.tsb : r1(ctl - atl),
      ...(projectedRaceRunCtl !== undefined ? { projectedRaceRunCtl } : {}),
      ...(goalGap ? { goalGap } : {}),
      ...(caps ? { tissue: { caps, why: tissueReasons(req.tissueConstraints) } } : {}),
      ...(volumeTargets ? { volumeTargets } : {}),
    },
    weeks,
  };
}

/** "H:MM" clock from seconds (rounds to the nearest minute, carries to hours). */
function fmtClock(totalSec: number): string {
  const totalMin = Math.round(totalSec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function buildGoalGap(
  goalTime: string,
  goal: GoalCtl,
  reachableRaceDayCtl: number,
  distanceKm: number,
  goalSec: number,
  startCtl: number,
  planWeeks: number,
  tissueLongCapped = false,
  tissueLabel = "tissue",
  volumeShortfall = "",
  rampPct = 20,
  baseRich = false,
  /** Athlete km↔TSS bridge for the anchorless finish curve (E4). */
  cvol: number = CVOL,
  /** Demonstrated races for the personal finish curve (E6) — explicit. */
  raceAnchors: RaceAnchor[] = []
): NonNullable<Plan["meta"]["goalGap"]> {
  const requiredPeakCtl = r1(goal.raceDayCtl); // the race-relevant "~50" figure
  const reachablePeakCtl = r1(reachableRaceDayCtl);
  const gapCtl = r1(Math.max(0, requiredPeakCtl - reachablePeakCtl));
  // Load-limited finish from the reachable CTL, anchored to demonstrated races
  // (personal ceiling-saturating curve + hard invariant clamp, engine/goal.ts)
  // and clamped no faster than the goal. Anchors come from the gitignored
  // corpus; absent ⇒ generic fallback.
  const finishSec = Math.max(goalSec, finishEstimate(reachableRaceDayCtl, distanceKm, raceAnchors, Date.now(), cvol));
  const realisticFinish = fmtClock(finishSec);
  // The tissue long-run limit is named ONLY when a constraint is active — a
  // healthy runner's rails are just the ramp + form floor (feature 4). The ramp
  // % is the athlete's own ceiling (feature 3: higher for a base-rich rebuild).
  const railClause = tissueLongCapped
    ? `the +${rampPct}% weekly ramp, the −25 form floor, and your ${tissueLabel} long-run limit`
    : `the +${rampPct}% weekly ramp and the −25 form floor`;
  const rampLever = tissueLongCapped
    ? `or — only once the ${tissueLabel} fully clears — ramp nearer (never above) the +${rampPct}% ceiling`
    : `or ramp nearer (never above) the +${rampPct}% ceiling`;
  const baseRichNote = baseRich
    ? ` Your logged training base lets you rebuild faster than a first-timer — that's why the safe ramp here runs to +${rampPct}%, not the standard +20%.`
    : "";
  const message =
    (gapCtl > 1
      ? `Goal ${goalTime} implies a race-day CTL around ${Math.round(requiredPeakCtl)}. A safe progression from your current ~${Math.round(startCtl)} over ${planWeeks} weeks — held under ${railClause} — reaches about ${Math.round(reachablePeakCtl)}. That projects to roughly ${realisticFinish} here (load-limited; sharp legs can beat it). To close the ~${Math.round(gapCtl)}-CTL gap: extend the timeline (a 26–30 week build), treat ${realisticFinish} as the honest target for this race and ${goalTime} as a multi-season goal, ${rampLever}. Re-test threshold pace mid-block to refine.`
      : `Goal ${goalTime} (race-day CTL ~${Math.round(requiredPeakCtl)}) is within reach of your projected ~${Math.round(reachablePeakCtl)} — hold the ramp and the taper and it stays on the table (~${realisticFinish} load-limited).`) +
    baseRichNote +
    volumeShortfall;
  return { goalTime, requiredPeakCtl, reachablePeakCtl, realisticFinish, gapCtl, message, loadLimited: true };
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const r1 = (n: number) => Math.round(n * 10) / 10;
