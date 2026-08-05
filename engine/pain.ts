import { addDaysIso } from "./plan-ops.ts";

/**
 * The pain log and its surface rules — ONE implementation, both surfaces.
 *
 * This lived in src/lib (strength-protocols.ts for the types and parsers,
 * pain-rules.ts for the rules) and was therefore dashboard-only. Mobile is
 * where a daily input actually gets used — someone standing outside after a
 * run — so the model moves here rather than being reimplemented there. Every
 * mobile-lags-dashboard incident in this repo's history lived in a duplicated
 * function, and a duplicated ALERT rule would mean the two surfaces disagreeing
 * about whether an athlete is injured.
 *
 * Pure: no I/O, no storage, no React, no node:fs. The surfaces own persistence
 * (data/app/pain-log.json on the dashboard, AsyncStorage on mobile) and both
 * read the same series through the same functions.
 *
 * Consequences are advisory by design (docs/strength-module.md §4): a banner, a
 * session-conversion suggestion, a scheduler hold. The engine's plan and the
 * PMC never see pain data, and the app diagnoses nothing.
 */

/** The body regions an athlete can report against. Shared with the intake's
 *  injury vocabulary — one list, so a region cannot exist in one surface's
 *  picker and be unrecognised by the other's rules. */
export const PAIN_REGIONS = ["calf-achilles", "knee", "hip", "itb", "shoulder", "back"] as const;
export type PainRegion = (typeof PAIN_REGIONS)[number];

export const PAIN_REGION_LABEL: Record<PainRegion, string> = {
  "calf-achilles": "Calf / achilles",
  knee: "Knee",
  hip: "Hip",
  itb: "ITB",
  shoulder: "Shoulder",
  back: "Back",
};

// "specific-movement" is separate from during/after a session on purpose: pain
// that only appears on one movement localises a tissue in a way session-timing
// does not, and it is what an athlete reaches for when nothing in a run hurts
// but a particular load does.
export const PAIN_CONTEXTS = ["at-rest", "during-session", "after-session", "specific-movement", "morning"] as const;
export type PainContext = (typeof PAIN_CONTEXTS)[number];

export const PAIN_CONTEXT_LABEL: Record<PainContext, string> = {
  "at-rest": "At rest",
  "during-session": "During session",
  "after-session": "After session",
  "specific-movement": "A specific movement",
  morning: "Morning",
};

export interface PainEntry {
  /** YYYY-MM-DD, athlete-local (localToday — never a UTC "today"). */
  date: string;
  region: PainRegion;
  /** Integer 0–10, NRS scale. */
  score0to10: number;
  context: PainContext;
}

// Input is untrusted on both surfaces — a server action's FormData and a
// mobile picker are equally capable of supplying nonsense.
export function parsePainRegion(v: unknown): PainRegion | null {
  return PAIN_REGIONS.includes(v as PainRegion) ? (v as PainRegion) : null;
}

export function parsePainScore(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(0, Math.round(n)));
}

export function parsePainContext(v: unknown): PainContext {
  return PAIN_CONTEXTS.includes(v as PainContext) ? (v as PainContext) : "after-session";
}

/** Shape-validate a stored entry. A log is health data an athlete has been
 *  adding to for months; one malformed row must not discard the series, so
 *  this filters rather than refuses — the opposite of the tissue-declaration
 *  boundary, where a dropped row means a dropped safety cap. */
export function isPainEntry(e: unknown): e is PainEntry {
  if (typeof e !== "object" || e === null) return false;
  const x = e as Record<string, unknown>;
  return (
    typeof x.date === "string" &&
    PAIN_REGIONS.includes(x.region as PainRegion) &&
    typeof x.score0to10 === "number" &&
    Number.isFinite(x.score0to10) &&
    PAIN_CONTEXTS.includes(x.context as PainContext)
  );
}

/**
 * Upsert one entry into a log, keyed (date, region, context).
 *
 * Re-logging the same slot overwrites: an athlete correcting "actually it was
 * a 6" must not leave the 3 behind for the rules to average against. Returns a
 * new array — callers persist it.
 */
export function upsertPainEntry(log: PainEntry[], entry: PainEntry): PainEntry[] {
  return [
    ...log.filter((e) => !(e.date === entry.date && e.region === entry.region && e.context === entry.context)),
    entry,
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

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
  for (const region of PAIN_REGIONS) {
    const regionEntries = entries.filter((e) => e.region === region && e.date <= today);
    if (regionEntries.length === 0) continue;
    const byDay = dailyMax(regionEntries);
    const label = PAIN_REGION_LABEL[region];

    // Rule 1 — consecutive days at 4+
    const consecutive = [today, addDaysIso(today, -1)].some((end) =>
      [end, addDaysIso(end, -1), addDaysIso(end, -2)].every((d) => (byDay.get(d) ?? 0) >= 4)
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
    const weekAgo = addDaysIso(today, -6);
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
      const v = byDay.get(addDaysIso(today, i - 6));
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
 * work is exempt (daily-eligible).
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
      const v = byDay.get(addDaysIso(ws, i));
      if (v !== undefined) vals.push(v);
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
}
