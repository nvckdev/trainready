import type { PlanWeek } from "../../engine/plan.ts";
import type { AthleteContext } from "./athlete-context";
import { activeInjuryAreas } from "./athlete-context";
import type { Protocol } from "./strength-protocols";
import { SEED_PROTOCOLS } from "./strength-seed";
import type { ProtocolsState } from "./strength-io";
import { QUALITY } from "./week-insights";

/**
 * Strength scheduler — places protocol days around the engine plan
 * (docs/strength-module.md §3). Presentation-layer like week-insights.ts:
 * pure functions over the stored plan, never mutating it; strength days are
 * never written into plan.json. Deterministic — same inputs, same calendar.
 */

/* ——— date helpers (calendar arithmetic on athlete-local YYYY-MM-DD
 *     strings; "today" itself always arrives from localToday()) ——— */

function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function weekdayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`)
  );
}

/* ——— protocol activation ——— */

/**
 * Which protocols are live for this athlete. An explicit activation set in
 * protocols-state.json wins; otherwise defaults derive from the intake
 * context: nothing without strength access, rehab protocols only when a
 * targeted injury area is on file. No context, no protocols — the page's
 * empty states are untouched.
 */
export function activeProtocols(
  ctx: AthleteContext | null,
  state: ProtocolsState | null
): Protocol[] {
  if (state?.activeProtocolIds) {
    const ids = new Set(state.activeProtocolIds);
    return SEED_PROTOCOLS.filter((p) => ids.has(p.id));
  }
  const access = ctx?.intake?.strengthAccess;
  if (!ctx || !access || access === "none") return [];
  const areas = activeInjuryAreas(ctx);
  return SEED_PROTOCOLS.filter((p) => {
    if (p.access && !p.access.includes(access)) return false;
    if (p.rehab) return (p.targets ?? []).some((t) => areas.includes(t));
    return true;
  });
}

/* ——— week scheduling ——— */

export interface ScheduledStrengthDay {
  date: string;
  weekday: string; // short label, e.g. "Tue"
  protocol: Protocol;
  /** Race week: non-rehab sets are halved and progression is frozen. */
  deload: boolean;
}

export interface StrengthSchedule {
  days: ScheduledStrengthDay[]; // date asc; non-rehab before rehab within a day
  notes: string[]; // e.g. "1 of 2 Upper body days placed — week is intensity-dense"
}

/** Sets to prescribe for a block on a deload (race-week) day. */
export function deloadSets(sets: number): number {
  return Math.max(1, Math.floor(sets / 2));
}

/** A protected session: strength never lands <24h before it. */
function isProtected(s: { title: string; discipline: string }): boolean {
  return s.discipline === "race" || (s.discipline !== "rest" && QUALITY.test(s.title));
}

/**
 * Place this week's strength days from `today` forward.
 *
 * Rules (docs/strength-module.md §3):
 * - Non-rehab days are excluded when the NEXT calendar day holds a quality
 *   or race session (date-granularity 24h rule) — `nextWeek`'s first two
 *   days are consulted so a Sunday placement can't precede a Monday quality
 *   session. Race day itself is excluded, and a day carries at most one
 *   non-rehab protocol.
 * - Preference order: quality days first (hard-day-hard-day), then easy
 *   days, then rest days; earliest date breaks ties.
 * - Rehab protocols are daily-eligible (therapeutic dose, not training
 *   stress); their only exclusion is race day itself.
 * - Race week: non-rehab sets halve (`deloadSets`); rehab keeps full dose.
 */
export function scheduleStrengthWeek(
  week: PlanWeek,
  nextWeek: PlanWeek | null,
  protocols: Protocol[],
  today: string
): StrengthSchedule {
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(week.weekStart, i));
  const weekEnd = addDays(week.weekStart, 6);

  const protectedDates = new Set<string>();
  for (const s of week.sessions) if (isProtected(s)) protectedDates.add(s.date);
  for (const s of nextWeek?.sessions ?? []) {
    // Lookahead: only the first two days of next week can sit <24h after
    // a strength day placed in this week.
    if (s.date <= addDays(weekEnd, 2) && isProtected(s)) protectedDates.add(s.date);
  }

  const raceDates = new Set(week.sessions.filter((s) => s.discipline === "race").map((s) => s.date));
  const isRaceWeek = raceDates.size > 0;

  // quality 0 < easy 1 < rest 2 — strength stacks onto hard days first.
  const kindRank = (date: string): number => {
    const sessions = week.sessions.filter((s) => s.date === date && s.discipline !== "rest");
    if (sessions.some((s) => QUALITY.test(s.title))) return 0;
    return sessions.length > 0 ? 1 : 2;
  };

  const days: ScheduledStrengthDay[] = [];
  const notes: string[] = [];
  const taken = new Set<string>(); // dates already holding a non-rehab protocol

  for (const protocol of protocols.filter((p) => !p.rehab)) {
    const needed = Math.max(0, ...protocol.blocks.map((b) => b.freqPerWeek));
    const candidates = weekDates
      .filter(
        (d) =>
          d >= today &&
          !protectedDates.has(addDays(d, 1)) &&
          !raceDates.has(d) &&
          !taken.has(d)
      )
      .sort((a, b) => kindRank(a) - kindRank(b) || a.localeCompare(b));
    const placed = candidates.slice(0, needed);
    for (const date of placed) {
      taken.add(date);
      days.push({ date, weekday: weekdayLabel(date), protocol, deload: isRaceWeek });
    }
    if (placed.length < needed && today <= weekDates[0]) {
      notes.push(
        `${placed.length} of ${needed} ${protocol.name} day${needed > 1 ? "s" : ""} placed — week is intensity-dense`
      );
    }
  }

  for (const protocol of protocols.filter((p) => p.rehab)) {
    for (const date of weekDates) {
      if (date < today || raceDates.has(date)) continue;
      days.push({ date, weekday: weekdayLabel(date), protocol, deload: false });
    }
  }

  days.sort(
    (a, b) => a.date.localeCompare(b.date) || Number(!!a.protocol.rehab) - Number(!!b.protocol.rehab)
  );
  return { days, notes };
}
