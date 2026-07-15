import type { Plan } from "../../engine/plan.ts";
import type { PmcRow, WeeklyRow } from "./athlete-data";
import { currentWeek } from "./week-insights";

/**
 * Weekly narrative digest — a plain-language "here's your week", grounded
 * entirely in the athlete's own numbers. Deterministic (no LLM): every line is
 * a template over real data, so it can never hallucinate a claim the data
 * doesn't support. This is the explainability play — competitors surface
 * metrics; Taper says what they mean this week.
 */

const PHASE_INTENT: Record<string, string> = {
  base: "lay aerobic base — steady volume, easy intensity",
  build: "convert that base into race-specific fitness",
  taper: "shed fatigue and sharpen — freshness over fitness now",
  race: "nothing left to build; protect what you've banked",
  recovery: "absorb the last block before building again",
  offseason: "rebuild gently, no deadline pressure",
};

export interface WeeklyDigest {
  headline: string;
  lines: string[];
}

function ctlDelta(pmc: PmcRow[], days: number): number | null {
  if (pmc.length < 2) return null;
  const now = pmc[pmc.length - 1].ctl;
  const past = pmc[Math.max(0, pmc.length - 1 - days)]?.ctl;
  return past == null ? null : now - past;
}

/**
 * Build the digest from the daily PMC, weekly load, and the active plan.
 * Null-safe: returns null when there's no plan or no fitness data.
 */
export function weeklyDigest(pmc: PmcRow[], weekly: WeeklyRow[], plan: Plan | null, today: string): WeeklyDigest | null {
  if (!pmc.length || !plan) return null;
  const latest = pmc[pmc.length - 1];
  const found = currentWeek(plan, today);
  if (!found) return null;
  const { week, index } = found;
  const prevWeek = index > 0 ? plan.weeks[index - 1] : null;

  const lines: string[] = [];

  // 1 — what you did last week (executed vs planned).
  if (prevWeek) {
    const actual = weekly.find((r) => r.weekStart === prevWeek.weekStart);
    if (actual) {
      const pct = prevWeek.targetTss > 0 ? Math.round((actual.tss / prevWeek.targetTss - 1) * 100) : 0;
      const verdict =
        Math.abs(pct) <= 8 ? "right on plan" : pct > 8 ? `${pct}% over plan` : `${Math.abs(pct)}% under plan`;
      lines.push(
        `Last week you logged ${Math.round(actual.tss)} TSS against a ${prevWeek.targetTss} target — ${verdict}.`
      );
    }
  }

  // 2 — how fitness actually moved (28-day CTL trend — the real signal).
  const d28 = ctlDelta(pmc, 28);
  if (d28 != null) {
    const dir = d28 >= 1 ? `up ${d28.toFixed(0)}` : d28 <= -1 ? `down ${Math.abs(d28).toFixed(0)}` : "flat";
    lines.push(
      `Fitness sits at CTL ${latest.ctl.toFixed(0)} (${dir} over the last month), form at ${latest.tsb >= 0 ? "+" : ""}${latest.tsb.toFixed(0)} TSB.`
    );
  }

  // 3 — why this week looks the way it does.
  const intent = PHASE_INTENT[week.phase] ?? "progress toward race day";
  const ramp = prevWeek && prevWeek.targetTss > 0 ? Math.round((week.targetTss / prevWeek.targetTss - 1) * 100) : null;
  const rampNote = ramp == null ? "" : ramp > 3 ? ` (+${ramp}% — building)` : ramp < -3 ? ` (${ramp}% — a step back to absorb)` : " (holding steady)";
  lines.push(
    `This week — ${week.phase}, week ${index + 1} of ${plan.weeks.length}: ${week.targetTss} TSS${rampNote}. The job is to ${intent}.`
  );

  // 4 — one honest flag, if the plan carries one.
  if (plan.meta.replanNote) {
    lines.push(`Heads up: ${plan.meta.replanNote}.`);
  } else if (latest.tsb <= -20) {
    lines.push(`Heads up: form is deep at ${latest.tsb.toFixed(0)} TSB — bank the easy days, they're doing real work.`);
  }

  const headline =
    week.phase === "taper" || week.phase === "race"
      ? "Race week is close — trust the taper."
      : d28 != null && d28 >= 1
        ? "You're building — here's the week."
        : "Here's your week.";

  return { headline, lines };
}
