/**
 * Training targets from athlete thresholds. Zones are derived, formatted,
 * and versioned with the plan; every session target traces back here.
 */

export interface Thresholds {
  ftpWatts: number;
  lthrBpm: number;
  runThresholdSpeedMps: number;
  swimCssMps: number;
}

/** Numeric run pace window in seconds per km. min = fast end (shown first in
 *  the "M:SS–M:SS/km" string), max = slow end. The workout generator writes
 *  these straight into run Block pace fields (engine/plan.ts), so the visual
 *  renderer never re-parses the display string. Rounded to whole seconds to
 *  match the displayed pace strings. */
export interface PaceRange {
  minSecPerKm: number;
  maxSecPerKm: number;
}

export interface Zones {
  run: {
    /** pace strings per intensity, e.g. "5:05–5:20/km" */
    easy: string;
    steady: string;
    tempo: string;
    threshold: string;
    vo2: string;
    strides: string;
  };
  /** Numeric companions to `run` pace strings (seconds per km). Additive:
   *  the string fields are unchanged and still feed the derived structure text. */
  runSec: {
    easy: PaceRange;
    steady: PaceRange;
    tempo: PaceRange;
    threshold: PaceRange;
    vo2: PaceRange;
  };
  bike: {
    z2: string;
    tempo: string;
    threshold: string;
    vo2: string;
  };
  swim: {
    easy: string;
    threshold: string;
    vo2: string;
  };
}

function paceKm(mps: number): string {
  const sPerKm = 1000 / mps;
  const m = Math.floor(sPerKm / 60);
  const s = Math.round(sPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function runRange(threshold: number, loPct: number, hiPct: number): string {
  // Higher % of threshold speed = faster = lower pace number
  return `${paceKm(threshold * hiPct)}–${paceKm(threshold * loPct)}/km`;
}

/** Numeric twin of runRange: min = fast end (hiPct), max = slow end (loPct),
 *  seconds per km, rounded like paceKm so the numbers match the strings. */
function runRangeSec(threshold: number, loPct: number, hiPct: number): PaceRange {
  return {
    minSecPerKm: Math.round(1000 / (threshold * hiPct)),
    maxSecPerKm: Math.round(1000 / (threshold * loPct)),
  };
}

function per100(mps: number): string {
  const s = 100 / mps;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}/100m`;
}

/** Recover the run threshold speed (m/s) from derived zones — the midpoint of
 *  the threshold pace band (0.97–1.02 of vT), so it inverts deriveZones to
 *  within ~0.5%. Lets zone-consuming code reach the athlete pace model
 *  (cvolFor / easyKmhFor) without re-plumbing raw thresholds. */
export function thresholdMpsFromZones(z: Zones): number {
  const t = z.runSec.threshold;
  const midSecPerKm = (t.minSecPerKm + t.maxSecPerKm) / 2;
  return midSecPerKm > 0 ? 1000 / midSecPerKm : 0;
}

/**
 * The fractional intensity bands, as [lo, hi] multiples of the discipline's
 * threshold. These ARE the zones — deriveZones renders them into pace/watt
 * strings, and anything else that needs a numeric band (the TrainingPeaks
 * export's watch targets) must read THESE rather than transcribe them. The
 * export once carried its own copy of this table; it drifted, and a Zone 2
 * ride reached the watch at 72–85% FTP against the plan's own 62–75% — a
 * ~15% overshoot held for hours, in the same payload whose description
 * printed the correct engine watts.
 */
export const RUN_BANDS = {
  easy: [0.76, 0.84],
  steady: [0.85, 0.9],
  tempo: [0.91, 0.96],
  threshold: [0.97, 1.02],
  vo2: [1.05, 1.1],
} as const satisfies Record<string, readonly [number, number]>;

export const BIKE_BANDS = {
  z2: [0.62, 0.75],
  tempo: [0.8, 0.88],
  threshold: [0.95, 1.03],
  vo2: [1.08, 1.2],
} as const satisfies Record<string, readonly [number, number]>;

export function deriveZones(t: Thresholds): Zones {
  const rt = t.runThresholdSpeedMps;
  const css = t.swimCssMps;
  const ftp = t.ftpWatts;
  const w = (b: readonly [number, number]) => `${Math.round(ftp * b[0])}–${Math.round(ftp * b[1])}W`;
  return {
    run: {
      easy: runRange(rt, ...RUN_BANDS.easy),
      steady: runRange(rt, ...RUN_BANDS.steady),
      tempo: runRange(rt, ...RUN_BANDS.tempo),
      threshold: runRange(rt, ...RUN_BANDS.threshold),
      vo2: runRange(rt, ...RUN_BANDS.vo2),
      strides: `${paceKm(rt * 1.15)}/km feel, 20s`,
    },
    runSec: {
      easy: runRangeSec(rt, ...RUN_BANDS.easy),
      steady: runRangeSec(rt, ...RUN_BANDS.steady),
      tempo: runRangeSec(rt, ...RUN_BANDS.tempo),
      threshold: runRangeSec(rt, ...RUN_BANDS.threshold),
      vo2: runRangeSec(rt, ...RUN_BANDS.vo2),
    },
    bike: {
      z2: w(BIKE_BANDS.z2),
      tempo: w(BIKE_BANDS.tempo),
      threshold: w(BIKE_BANDS.threshold),
      vo2: w(BIKE_BANDS.vo2),
    },
    swim: {
      easy: `${per100(css * 0.88)}`,
      threshold: `${per100(css)}`,
      vo2: `${per100(css * 1.04)}`,
    },
  };
}
