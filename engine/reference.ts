import type { AthleteState, Engine, Phase, WeekPrescription } from "./types.ts";

/**
 * Reference engine: classical periodization from first principles.
 *
 * Load math: holding daily TSS t for a week moves CTL by ≈ (t − CTL)/6.
 * So a target CTL gain of g points/week implies weekly TSS = 7·(CTL + 6g).
 * Phases pick g; guardrails cap it; taper overrides it.
 *
 * This is deliberately transparent and un-tuned: it is the baseline the
 * proprietary/learned engine must beat, and the safety scaffold it runs in.
 */

const CFG = {
  gBase: 1.2, // CTL pts/week in general prep
  gBuild: 1.7, // race-specific block
  gRecovery: -1.5, // cutback weeks
  cutbackEvery: 4, // 3:1 loading rhythm
  tsbFloor: -25, // deeper than this → force recovery
  tsbFresh: 12, // fresher than this outside taper → nudge load up
  rampCap: 1.15, // weekly TSS ≤ trailing mean × cap
  taper: {
    threeOut: 0.8, // fraction of trailing mean, 15–21 days out
    twoOut: 0.65, // 8–14 days out
    raceWeek: 0.45, // 0–7 days out (excluding the race itself)
  },
  tssPerSession: 62, // corpus median-ish, for session-count estimates
  minWeekTss: 60,
};

function phaseFor(state: AthleteState, cutback: boolean): Phase {
  const d = state.daysToNextRace;
  if (d !== null && d <= 7) return "race";
  if (d !== null && d <= 21) return "taper";
  if (state.tsb < CFG.tsbFloor) return "recovery";
  if (cutback) return "recovery";
  if (d !== null && d <= 84) return "build";
  return "base";
}

export const referenceEngine: Engine = {
  name: "reference-v0",

  prescribeWeek(state: AthleteState): WeekPrescription {
    const trailingMean =
      state.last4WeeksTss.reduce((s, x) => s + x, 0) /
      Math.max(1, state.last4WeeksTss.length);
    const cutback =
      state.weeksSinceStart % CFG.cutbackEvery === CFG.cutbackEvery - 1;
    const phase = phaseFor(state, cutback);

    let weekTss: number;
    let rationale: string;

    switch (phase) {
      case "race": {
        weekTss = trailingMean * CFG.taper.raceWeek;
        rationale = `Race week: sharpen, don't build. Volume cut to ${Math.round(CFG.taper.raceWeek * 100)}% of the trailing month; the fitness is already in the bank.`;
        break;
      }
      case "taper": {
        const frac = state.daysToNextRace! <= 14 ? CFG.taper.twoOut : CFG.taper.threeOut;
        weekTss = trailingMean * frac;
        rationale = `Taper, ${state.daysToNextRace} days out: shed fatigue faster than fitness (ATL τ=7 vs CTL τ=42) by holding ${Math.round(frac * 100)}% of trailing load.`;
        break;
      }
      case "recovery": {
        weekTss = 7 * (state.ctl + 6 * CFG.gRecovery);
        rationale =
          state.tsb < CFG.tsbFloor
            ? `TSB ${state.tsb.toFixed(0)} is past the safe floor (${CFG.tsbFloor}): absorb the block before adding to it.`
            : "Scheduled cutback (3:1 rhythm): consolidate the last three weeks of load.";
        break;
      }
      default: {
        let g = phase === "build" ? CFG.gBuild : CFG.gBase;
        if (state.tsb > CFG.tsbFresh) g += 0.3; // fresh: absorb a touch more
        weekTss = 7 * (state.ctl + 6 * g);
        rationale = `${phase === "build" ? "Build" : "Base"}: +${g.toFixed(1)} CTL/week from CTL ${state.ctl.toFixed(0)} → ${(7 * (state.ctl + 6 * g)).toFixed(0)} TSS.`;
      }
    }

    // Guardrails: never out-ramp the trailing month by more than the cap,
    // never below the floor that keeps the habit alive.
    const cap = trailingMean * CFG.rampCap;
    if (phase !== "race" && phase !== "taper" && weekTss > cap) {
      weekTss = cap;
      rationale += ` Capped at +${Math.round((CFG.rampCap - 1) * 100)}% over the trailing month.`;
    }
    weekTss = Math.max(CFG.minWeekTss, weekTss);

    // Discipline mix: follow the athlete's demonstrated mix, gently pulled
    // toward a balanced tri split during build (race demands all three).
    const s = state.last4Shares;
    const total = Math.max(0.01, s.swim + s.bike + s.run);
    const norm = { swim: s.swim / total, bike: s.bike / total, run: s.run / total };
    const triTarget = { swim: 0.15, bike: 0.45, run: 0.4 };
    const pull = phase === "build" || phase === "taper" ? 0.25 : 0.1;
    const isTri = norm.swim > 0.04 && norm.bike > 0.1; // multisport blocks only
    const shares = isTri
      ? {
          swim: lerp(norm.swim, triTarget.swim, pull),
          bike: lerp(norm.bike, triTarget.bike, pull),
          run: lerp(norm.run, triTarget.run, pull),
        }
      : norm;

    return {
      phase,
      weekTss: Math.round(weekTss),
      sessions: Math.min(13, Math.max(3, Math.round(weekTss / CFG.tssPerSession))),
      shares: {
        swim: round2(shares.swim),
        bike: round2(shares.bike),
        run: round2(shares.run),
      },
      rationale,
    };
  },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const round2 = (n: number) => Math.round(n * 100) / 100;
