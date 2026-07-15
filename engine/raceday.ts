import { finishEstimate, vdot, type RaceAnchor } from "./goal.ts";

/**
 * Race-day EXECUTION plan — pure, presentation-oriented, physiology-honest.
 *
 * Reuses the corrected finish model (goal.ts finishEstimate) for the target
 * time, then derives a negative-split pacing table, a fuelling schedule, and a
 * heat adjustment. Touches NO PMC math and is never consulted by the backtest —
 * this is a forward, race-week artifact.
 *
 * The whole point vs. competitors' race predictors: the target is the athlete's
 * HONEST reachable finish (anchored to their real races), and every number is
 * explained, not asserted.
 */

export interface PaceSplit {
  label: string; // "0–5 km", "Final 1.1 km"
  fromKm: number;
  toKm: number;
  paceSecPerKm: number;
  cumulativeSec: number; // elapsed at the end of this split
}

export interface FuelCue {
  atMin: number; // minutes into the race
  label: string; // "Gel", "Drink", "Gel + electrolyte"
  detail: string;
}

export interface RaceDayPlan {
  distanceKm: number;
  targetSec: number; // honest reachable finish
  avgPaceSecPerKm: number;
  weatherAdjusted: boolean;
  tempC: number | null;
  splits: PaceSplit[];
  strategy: string; // one-line pacing intent
  carbsPerHourG: [number, number]; // recommended range
  fluidPerHourMl: number;
  fuel: FuelCue[];
  notes: string[]; // honest caveats / explanations
}

/** Heat penalty on sustainable pace. Endurance pace degrades roughly linearly
 *  above ~15 °C. Conservative ~1.5 % per 5 °C over 15, capped at 8 %. */
export function heatPenaltyFrac(tempC: number | null): number {
  if (tempC == null || tempC <= 15) return 0;
  return Math.min(0.08, ((tempC - 15) / 5) * 0.015);
}

/** Negative-split shape: run the first third a touch conservative, settle to
 *  average, finish under. Fractions multiply the average pace (lower = faster).
 *  Sums to 1.0 across equal thirds so total time == target. */
const SPLIT_SHAPE: [number, number, number] = [1.02, 1.0, 0.98];

function fmtKm(k: number): string {
  return Number.isInteger(k) ? String(k) : k.toFixed(1);
}

/**
 * Build the execution plan. `projectedRaceCtl` is the plan's honest race-day
 * CTL; `anchors` are the athlete's real races (loadRaceAnchors()). `tempC` is an
 * optional race-day forecast high (from Open-Meteo) — when present the target
 * pace is heat-adjusted and a note explains it.
 */
export function raceDayPlan(opts: {
  distanceKm: number;
  projectedRaceCtl: number;
  anchors?: RaceAnchor[];
  asOf?: string | number | Date;
  tempC?: number | null;
}): RaceDayPlan {
  const { distanceKm, projectedRaceCtl, anchors, asOf } = opts;
  const tempC = opts.tempC ?? null;

  const baseSec = finishEstimate(projectedRaceCtl, distanceKm, anchors, asOf);
  const penalty = heatPenaltyFrac(tempC);
  const targetSec = baseSec * (1 + penalty);
  const avgPaceSecPerKm = targetSec / distanceKm;

  // Thirds by distance; last segment carries any remainder.
  const third = distanceKm / 3;
  const bounds = [0, third, 2 * third, distanceKm];
  const splits: PaceSplit[] = [];
  let cumulative = 0;
  for (let i = 0; i < 3; i++) {
    const fromKm = bounds[i];
    const toKm = bounds[i + 1];
    const segKm = toKm - fromKm;
    const pace = avgPaceSecPerKm * SPLIT_SHAPE[i];
    cumulative += pace * segKm;
    splits.push({
      label: `${fmtKm(fromKm)}–${fmtKm(toKm)} km`,
      fromKm,
      toKm,
      paceSecPerKm: pace,
      cumulativeSec: cumulative,
    });
  }
  // Normalize rounding drift so the last cumulative equals target exactly.
  splits[splits.length - 1].cumulativeSec = targetSec;

  // Fuelling — scale carbohydrate to duration; hydrate more in heat.
  const durMin = targetSec / 60;
  let carbs: [number, number];
  if (durMin < 75) carbs = [0, 30];
  else if (durMin < 150) carbs = [30, 60];
  else carbs = [60, 90];
  const fluidPerHourMl = tempC != null && tempC >= 22 ? 750 : 500;

  const fuel: FuelCue[] = [];
  if (durMin >= 75) {
    // First gel ~15 min in, then every ~35 min; drink every ~20 min.
    for (let t = 15; t < durMin - 5; t += 35) fuel.push({ atMin: Math.round(t), label: "Gel", detail: `~${carbs[1] >= 60 ? 25 : 22} g carbs` });
    for (let t = 20; t < durMin - 5; t += 20) fuel.push({ atMin: t, label: "Drink", detail: tempC != null && tempC >= 22 ? "few sips + electrolyte" : "few sips" });
    fuel.sort((a, b) => a.atMin - b.atMin || (a.label === "Gel" ? -1 : 1));
  }

  const strategy =
    "Start controlled, settle to goal pace by a third in, and let the last third come down — even effort, negative split.";

  const notes: string[] = [];
  notes.push(
    `Target ${fmtHMS(targetSec)} is your honest reachable finish at projected race-day CTL ${projectedRaceCtl.toFixed(0)} — anchored to your real races, not an optimistic predictor.`
  );
  if (penalty > 0) {
    notes.push(
      `Adjusted +${(penalty * 100).toFixed(0)}% for ~${Math.round(tempC!)}°C heat: race by effort, not the watch — the pace table already bakes the heat in.`
    );
  }
  if (durMin >= 75) {
    notes.push(`Fuel ${carbs[0] === 0 ? "up to " : `${carbs[0]}–`}${carbs[1]} g carbs/hr and ~${fluidPerHourMl} mL fluid/hr; practise it on long runs first.`);
  } else {
    notes.push("Under ~75 min: water to taste, no fuelling needed for most athletes.");
  }

  return {
    distanceKm,
    targetSec,
    avgPaceSecPerKm,
    weatherAdjusted: penalty > 0,
    tempC,
    splits,
    strategy,
    carbsPerHourG: carbs,
    fluidPerHourMl,
    fuel,
    notes,
  };
}

/* ---- formatting helpers (shared with the UI) ---- */

export function fmtHMS(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
}

export function fmtPace(secPerKm: number): string {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}/km`;
}

/* ---- Capability profile: PR-equivalents + % toward peak-era ceiling ---- */

export interface CapabilityDistance {
  label: string;
  km: number;
  finishSec: number;
  paceSecPerKm: number;
}

export interface CapabilityProfile {
  currentCtl: number;
  vdotNow: number;
  vdotPeak: number | null;
  pctOfPeak: number | null; // vdotNow / vdotPeak, 0..1
  distances: CapabilityDistance[];
}

const STANDARD_DISTANCES: { label: string; km: number }[] = [
  { label: "5K", km: 5 },
  { label: "10K", km: 10 },
  { label: "Half", km: 21.0975 },
  { label: "Marathon", km: 42.195 },
];

/**
 * What the athlete could run TODAY across standard distances, from current CTL
 * through the same honest finish model — plus how close their current fitness
 * sits to their demonstrated peak (best race anchor VDOT). Reframes CTL as
 * capability-vs-ceiling, which no competitor surfaces.
 */
export function capabilityProfile(
  currentCtl: number,
  anchors: RaceAnchor[],
  asOf: string | number | Date = Date.now()
): CapabilityProfile {
  const distances: CapabilityDistance[] = STANDARD_DISTANCES.map((d) => {
    const finishSec = finishEstimate(currentCtl, d.km, anchors, asOf);
    return { label: d.label, km: d.km, finishSec, paceSecPerKm: finishSec / d.km };
  });

  // vdotNow from the current half-equivalent; vdotPeak from the best anchor.
  const half = distances.find((d) => d.label === "Half")!;
  const vdotNow = vdot(half.km, half.finishSec / 60);
  let vdotPeak: number | null = null;
  for (const a of anchors) {
    if (a.distanceKm > 0 && a.timeSec > 0) {
      const v = vdot(a.distanceKm, a.timeSec / 60);
      if (vdotPeak == null || v > vdotPeak) vdotPeak = v;
    }
  }
  const pctOfPeak = vdotPeak && vdotPeak > 0 ? Math.min(1, vdotNow / vdotPeak) : null;

  return { currentCtl, vdotNow, vdotPeak, pctOfPeak, distances };
}
