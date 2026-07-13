import type { PainEntry, PainRegion } from "./strength-protocols";
import { INJURY_AREAS, INJURY_LABEL } from "./athlete-context";
import { addDays } from "./strength-schedule";

/**
 * Pain surface rules (docs/strength-module.md §4). Pure functions over the
 * pain log — presentation-layer like week-insights.ts. Consequences are
 * advisory only: a banner, a session-conversion suggestion, and a scheduler
 * hold. The engine and the PMC never see pain data, and the app diagnoses
 * nothing.
 */

export interface PainAlert {
  region: PainRegion;
  rule: "consecutive" | "at-rest" | "rising-trend";
  /** One line, plain language. */
  detail: string;
}

/** Max reported score per calendar day for one region's entries. */
function dailyMax(entries: PainEntry[]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const e of entries) {
    byDay.set(e.date, Math.max(byDay.get(e.date) ?? 0, e.score0to10));
  }
  return byDay;
}

/**
 * Evaluate the three surface rules per region, athlete-local dates. At most
 * one alert per region, first matching rule wins (consecutive is the
 * strongest signal, trend the weakest).
 *
 * 1. Consecutive — 3 consecutive days with max daily score ≥ 4, window
 *    ending today or yesterday. Missing days break the streak.
 * 2. At rest — any at-rest entry ≥ 3 in the last 7 days.
 * 3. Rising trend — OLS over the trailing 7 days' daily maxima (≥ 3 data
 *    points): slope > 0 AND last > first + 1 (the level test filters noise).
 */
export function surfaceAlerts(entries: PainEntry[], today: string): PainAlert[] {
  const alerts: PainAlert[] = [];
  for (const region of INJURY_AREAS) {
    const regionEntries = entries.filter((e) => e.region === region && e.date <= today);
    if (regionEntries.length === 0) continue;
    const byDay = dailyMax(regionEntries);
    const label = INJURY_LABEL[region];

    // Rule 1 — consecutive days at 4+
    const consecutive = [today, addDays(today, -1)].some((end) =>
      [end, addDays(end, -1), addDays(end, -2)].every((d) => (byDay.get(d) ?? 0) >= 4)
    );
    if (consecutive) {
      alerts.push({
        region,
        rule: "consecutive",
        detail: `${label}: 4+/10 on three consecutive days.`,
      });
      continue;
    }

    // Rule 2 — pain at rest in the last 7 days
    const weekAgo = addDays(today, -6);
    const atRest = regionEntries.find(
      (e) => e.date >= weekAgo && e.context === "at-rest" && e.score0to10 >= 3
    );
    if (atRest) {
      alerts.push({
        region,
        rule: "at-rest",
        detail: `${label}: ${atRest.score0to10}/10 at rest within the last 7 days — a lower bar than loading pain.`,
      });
      continue;
    }

    // Rule 3 — rising trend over the trailing 7 days
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 7; i++) {
      const v = byDay.get(addDays(today, i - 6));
      if (v !== undefined) pts.push([i, v]);
    }
    if (pts.length >= 3) {
      const n = pts.length;
      const meanX = pts.reduce((a, [x]) => a + x, 0) / n;
      const meanY = pts.reduce((a, [, y]) => a + y, 0) / n;
      const cov = pts.reduce((a, [x, y]) => a + (x - meanX) * (y - meanY), 0);
      const varX = pts.reduce((a, [x]) => a + (x - meanX) ** 2, 0);
      const slope = varX > 0 ? cov / varX : 0;
      const first = pts[0][1];
      const last = pts[n - 1][1];
      if (slope > 0 && last > first + 1) {
        alerts.push({
          region,
          rule: "rising-trend",
          detail: `${label}: climbing over the last 7 days (${first} → ${last}/10).`,
        });
      }
    }
  }
  return alerts;
}

/**
 * Scheduler hold (docs/strength-module.md §4): a non-rehab protocol whose
 * targets intersect an alerted region is held until the rule clears; rehab
 * work is exempt (daily-eligible). Shared by the Today page (skip
 * scheduling) and the strength server actions — "pain-held sessions do not
 * feed the machine" must hold server-side too, so a stale form (pain logged
 * in another tab after render) or crafted POST cannot record a completion
 * that replayProgression would count.
 */
export function isPainHeld(
  protocol: { rehab?: boolean; targets?: PainRegion[] },
  alerts: PainAlert[]
): boolean {
  if (protocol.rehab) return false;
  const regions = new Set(alerts.map((a) => a.region));
  return (protocol.targets ?? []).some((t) => regions.has(t));
}

/**
 * Weekly pain averages for charting against weekly TSS: for each week
 * (Monday `weekStart`, 7 days), the mean of daily max scores across all
 * regions — i.e. the 7-day average pain for that week. Weeks with no
 * entries are null, never zero (no data is not "no pain").
 */
export function weeklyPainAverages(
  entries: PainEntry[],
  weekStarts: string[]
): Array<number | null> {
  const byDay = dailyMax(entries);
  return weekStarts.map((ws) => {
    const vals: number[] = [];
    for (let i = 0; i < 7; i++) {
      const v = byDay.get(addDays(ws, i));
      if (v !== undefined) vals.push(v);
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
}
