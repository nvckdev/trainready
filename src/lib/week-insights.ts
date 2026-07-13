import type { Plan, PlannedSessionOut, PlanWeek } from "../../engine/plan.ts";

/**
 * Presentation-layer insights derived from the stored plan + PMC state.
 * Pure functions only — the engine's numbers are never altered here (the
 * taper is protocol, not preference), we only explain and bracket them.
 */

/** Rough km estimate for a run session: duration at zone-blended speed.
 *  Quality sessions blend tempo work with easy running; easy/long days sit
 *  at easy pace. Labeled an estimate wherever shown. */
const QUALITY = /tempo|interval|threshold|vo2|strides/i;
export function estimateRunKm(s: PlannedSessionOut): number {
  if (s.discipline !== "run") return 0;
  const kmh = QUALITY.test(s.title) ? 12.4 : 11.6; // ~4:50–5:10/km blended
  return s.durationHr * kmh;
}

export interface WeekBrief {
  weekStart: string;
  phase: string;
  index: number; // 1-based week number in plan
  total: number;
  targetTss: number;
  prevTargetTss: number | null;
  rampPct: number | null;
  plannedHours: number;
  plannedRunKm: number;
  doneTss: number;
  doneCount: number;
  sessionCount: number;
  projectedTsb: number;
  why: string[];
}

/** Find the plan week containing `today` (or the next upcoming week). */
export function currentWeek(plan: Plan, today: string): { week: PlanWeek; index: number } | null {
  const weeks = plan.weeks;
  for (let i = 0; i < weeks.length; i++) {
    const start = weeks[i].weekStart;
    const end = weeks[i + 1]?.weekStart ?? "9999-12-31";
    if (today >= start && today < end) return { week: weeks[i], index: i };
  }
  if (weeks.length && today < weeks[0].weekStart) return { week: weeks[0], index: 0 };
  return null;
}

const PHASE_GOAL: Record<string, string> = {
  base: "building the aerobic floor — volume over intensity",
  build: "converting the base into race-specific fitness",
  peak: "sharpening at full fitness — highest quality of the season",
  taper: "trading a little fitness for a lot of freshness",
  race: "protocol week — nothing left to build, only to protect",
};

export function briefForWeek(plan: Plan, today: string, raceName: string): WeekBrief | null {
  const found = currentWeek(plan, today);
  if (!found) return null;
  const { week, index } = found;
  const prev = index > 0 ? plan.weeks[index - 1] : null;

  const rampPct = prev ? ((week.targetTss - prev.targetTss) / prev.targetTss) * 100 : null;
  const plannedHours = week.sessions.reduce((a, s) => a + s.durationHr, 0);
  const plannedRunKm = week.sessions.reduce((a, s) => a + estimateRunKm(s), 0);
  const done = week.sessions.filter((s) => s.status === "done");

  const why: string[] = [];
  why.push(
    `Week ${index + 1} of ${plan.weeks.length} · ${week.phase} phase: ${PHASE_GOAL[week.phase] ?? "progressing toward race day"}.`
  );
  if (rampPct !== null) {
    const dir = rampPct >= 0 ? `+${rampPct.toFixed(0)}%` : `${rampPct.toFixed(0)}%`;
    why.push(
      rampPct > 0
        ? `${week.targetTss} TSS is ${dir} over last week — inside the +15% ramp cap the engine never exceeds.`
        : rampPct < -5
          ? `${week.targetTss} TSS is ${dir} vs last week — a planned absorption week, not lost fitness.`
          : `${week.targetTss} TSS holds steady vs last week while intensity does the work.`
    );
  } else {
    why.push(`${week.targetTss} TSS opens the season at a load your trailing month already supports.`);
  }
  why.push(
    week.projected.tsb <= -20
      ? `Projected form ${week.projected.tsb.toFixed(0)} TSB — deliberately deep, but above the −25 recovery floor.`
      : `Projected form ${week.projected.tsb.toFixed(0)} TSB by week's end — hard enough to adapt, safe enough to absorb.`
  );
  why.push(`Every number backs out of ${raceName}: the race defines the season, not the other way round.`);

  return {
    weekStart: week.weekStart,
    phase: week.phase,
    index: index + 1,
    total: plan.weeks.length,
    targetTss: week.targetTss,
    prevTargetTss: prev?.targetTss ?? null,
    rampPct,
    plannedHours,
    plannedRunKm,
    doneTss: done.reduce((a, s) => a + s.tss, 0),
    doneCount: done.length,
    sessionCount: week.sessions.length,
    projectedTsb: week.projected.tsb,
    why,
  };
}

/* ---------------- Feeling-based session adjustments ---------------- */

export interface Adjustment {
  feeling: string;
  advice: string;
}

const LONG = /long/i;

/** Acceptable same-day tweaks. Brackets around the prescription — the
 *  structure itself stays the engine's. TSB sharpens the default choice. */
export function sessionAdjustments(s: PlannedSessionOut, tsb: number | null): { options: Adjustment[]; nudge: string | null } {
  const options: Adjustment[] = [];

  if (s.discipline === "race") return { options, nudge: null };

  if (QUALITY.test(s.title)) {
    options.push(
      {
        feeling: "Feeling strong",
        advice: "Add one rep or +1 min per rep — cap the upgrade at ~10% TSS. Hold the pace window; faster than prescribed changes the adaptation.",
      },
      {
        feeling: "A bit flat",
        advice: "Trim the MAIN set by a third and keep the warmup + strides. Showing up beats nailing it.",
      },
      {
        feeling: "Rough day",
        advice: "Convert MAIN to steady easy running, same duration. You keep the aerobic stimulus and lose nothing that matters this far out.",
      }
    );
  } else if (LONG.test(s.title)) {
    options.push(
      {
        feeling: "Feeling strong",
        advice: "Hold the plan — long-day progression is pre-built. Spend the extra energy on a steadier final third, not extra distance.",
      },
      {
        feeling: "A bit flat",
        advice: "Shorten by ~25% and keep the finish controlled. The long-run stimulus survives a shorter day.",
      },
      {
        feeling: "Rough day",
        advice: "Split it: half now at easy effort, or swap with tomorrow's session and re-flow.",
      }
    );
  } else {
    options.push(
      {
        feeling: "Feeling strong",
        advice: "Up to +10 min at the same effort — nothing faster. Easy days buy adaptation; they don't prove fitness.",
      },
      {
        feeling: "Rough day",
        advice: "Cut to 20 easy minutes or rest outright. One skipped easy day re-flows automatically; dug holes don't.",
      }
    );
  }

  let nudge: string | null = null;
  if (tsb !== null && tsb <= -15) {
    nudge = `Form is ${tsb.toFixed(0)} TSB today — the conservative option is the smart default.`;
  } else if (tsb !== null && tsb >= 10 && QUALITY.test(s.title)) {
    nudge = `Form is +${tsb.toFixed(0)} TSB — you're fresh; the full session (or the strong option) is well supported.`;
  }

  return { options, nudge };
}
