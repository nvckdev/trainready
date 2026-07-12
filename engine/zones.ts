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

function per100(mps: number): string {
  const s = 100 / mps;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}/100m`;
}

export function deriveZones(t: Thresholds): Zones {
  const rt = t.runThresholdSpeedMps;
  const css = t.swimCssMps;
  const ftp = t.ftpWatts;
  const w = (lo: number, hi: number) => `${Math.round(ftp * lo)}–${Math.round(ftp * hi)}W`;
  return {
    run: {
      easy: runRange(rt, 0.76, 0.84),
      steady: runRange(rt, 0.85, 0.9),
      tempo: runRange(rt, 0.91, 0.96),
      threshold: runRange(rt, 0.97, 1.02),
      vo2: runRange(rt, 1.05, 1.1),
      strides: `${paceKm(rt * 1.15)}/km feel, 20s`,
    },
    bike: {
      z2: w(0.62, 0.75),
      tempo: w(0.8, 0.88),
      threshold: w(0.95, 1.03),
      vo2: w(1.08, 1.2),
    },
    swim: {
      easy: `${per100(css * 0.88)}`,
      threshold: `${per100(css)}`,
      vo2: `${per100(css * 1.04)}`,
    },
  };
}
