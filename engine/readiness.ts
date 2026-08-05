import type { PlannedSessionOut, PlanWeek } from "./plan.ts";
import { blockWorkSec, ZONE3 } from "./intensity.ts";
import { TAPER_LOCK_DAYS } from "./reconcile.ts";
import { weekIndexContaining } from "./plan-ops.ts";

/**
 * Morning readiness — PLACEMENT ONLY.
 *
 * One tap says how the athlete woke up, and the plan may answer by reordering
 * this week's sessions. It may do nothing else. Weekly TSS, session content,
 * phase, duration, structure and every rail are exactly as generated; a swap
 * exchanges two sessions' DATES and nothing more, so the week's totals are
 * invariant by construction. That is also why this cannot reach the pinned
 * prediction path: the backtest replays weekly totals, and those never move
 * (pinned by R0/R2d).
 *
 * Deliberately manual. A sensor-driven version (HRV, sleep) is the obvious
 * next step, and ReadinessEntry is shaped for it — timestamped, sourced,
 * append-only — but a noisy signal shuffling an athlete's week would spend
 * trust the mechanism has not earned yet. The athlete's own answer first.
 */

export type ReadinessLevel = "rough" | "ok" | "good";

/** Where the reading came from. Manual today; the field exists so a future
 *  sensor reading is distinguishable in the log rather than retrofitted. */
export type ReadinessSource = "manual";

/**
 * A single morning's reading. Structured and timestamped rather than
 * transient UI state: this log is the training data a sensor-driven version
 * would calibrate against, and the record of what the athlete was told.
 */
export interface ReadinessEntry {
  /** Athlete-local calendar day (YYYY-MM-DD). One entry per day. */
  date: string;
  level: ReadinessLevel;
  /** ISO instant the athlete answered — provenance, and the ordering key if a
   *  future source ever writes more than one reading a day. */
  at: string;
  source: ReadinessSource;
  /** What the reading actually did, or null when it changed nothing. Recorded
   *  so the log explains the plan the athlete is looking at. */
  swap: ReadinessSwap | null;
}

export interface ReadinessSwap {
  /** The date the quality session moves OFF. */
  qualityFrom: string;
  /** The date it moves ON to (the easy session takes the vacated day). */
  qualityTo: string;
  /** Athlete-facing sentence. Names both days and the unchanged load. */
  note: string;
}

/**
 * A session counts as EASY below this share of hard (z2+z3) work — the same
 * threshold engine/plan.ts's intensity shaping uses to pick its easy
 * recipient, so "easy day" means one thing across the engine.
 */
export const EASY_HARD_FRACTION = 0.2;

const DAY = 86400000;
const at = (iso: string) => Date.parse(iso + "T12:00:00Z");
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayIndex = (weekStart: string, date: string) => Math.round((at(date) - at(weekStart)) / DAY);

/**
 * Hard share of a session's work. 0 for anything without a structure.
 *
 * Measured in whatever unit the session is actually WRITTEN in. Runs and rides
 * state seconds; the swim templates state metres and carry no pace on their
 * blocks, so nothing in a CSS threshold set is measurable in time and the only
 * seconds present are its rest periods — all easy. That reported hardFraction
 * 0.000 for a threshold swim, which classified it as an easy day and made it
 * eligible to RECEIVE a quality session swapped onto it: two hard sessions
 * stacked on one day, by a feature whose entire promise is not doing that.
 *
 * Zone is intensity. It does not depend on which unit a block happens to use,
 * so neither does this.
 *
 * Falling back only when NOTHING is measurable in seconds keeps the timed path
 * byte-identical (R9c): a session that could already be measured gets exactly
 * the answer it got before.
 */
export function hardFraction(s: PlannedSessionOut): number {
  const blocks = s.workout?.blocks ?? [];
  if (!blocks.length) return 0;
  const workSec = blocks.map(blockWorkSec);
  const timed = workSec.some((x) => x > 0);
  let hard = 0;
  let total = 0;
  blocks.forEach((b, i) => {
    const amount = timed ? workSec[i] : (b.distanceM ?? 0) * (b.reps ?? 1);
    if (amount > 0) {
      total += amount;
      if (ZONE3[b.zone] !== "z1") hard += amount;
    }
    // Rest between reps is easy time — countable only while the session is
    // being measured in time. Metres of swimming and seconds of rest do not
    // add up, and pretending they do is how this went wrong the first time.
    if (timed) total += (b.recoverySec ?? 0) * Math.max(0, (b.reps ?? 1) - 1);
  });
  return total > 0 ? hard / total : 0;
}

const isLongRun = (s: PlannedSessionOut) => /long/i.test(s.title);
const isRace = (s: PlannedSessionOut) => s.discipline === "race";
/** Movable = a normal training day. Races are protocol and the long run is the
 *  week's anchor; neither is ever repositioned by a readiness tap. */
const isMovable = (s: PlannedSessionOut) => !isRace(s) && !isLongRun(s) && s.discipline !== "rest";
const isQuality = (s: PlannedSessionOut) => isMovable(s) && hardFraction(s) >= EASY_HARD_FRACTION;
const isEasy = (s: PlannedSessionOut) => isMovable(s) && hardFraction(s) < EASY_HARD_FRACTION;

/**
 * How structurally crowded a week's hard days are: quality days sitting next
 * to each other, plus quality days sitting next to the long run.
 *
 * Used as a NEVER-WORSE test rather than a hard rule. The generator itself
 * emits adjacent quality in some shapes (a Thursday tempo beside Friday
 * strides), so forbidding adjacency outright would reject swaps that are no
 * worse than the plan they came from. Requiring the cost not to rise keeps
 * the guarantee honest and self-consistent with the generator.
 */
export function qualityAdjacencyCost(sessions: PlannedSessionOut[]): number {
  const hard = sessions.filter(isQuality).map((s) => at(s.date)).sort((a, b) => a - b);
  const longs = sessions.filter((s) => isLongRun(s) || isRace(s)).map((s) => at(s.date));
  let cost = 0;
  for (let i = 1; i < hard.length; i++) if (hard[i] - hard[i - 1] <= DAY) cost++;
  for (const h of hard) for (const l of longs) if (Math.abs(h - l) <= DAY) cost++;
  return cost;
}

/** The swap applied to a copy, for costing a candidate before committing. */
function withSwap(sessions: PlannedSessionOut[], fromDate: string, toDate: string): PlannedSessionOut[] {
  return sessions.map((s) =>
    s.date === fromDate ? { ...s, date: toDate } : s.date === toDate ? { ...s, date: fromDate } : s
  );
}

export interface ReadinessInput {
  weeks: PlanWeek[];
  /** Athlete-local today. */
  today: string;
  raceDate: string;
  level: ReadinessLevel;
}

/**
 * Decide what (if anything) this morning's reading should move. Pure — the
 * caller applies the result, so a UI can preview it before committing.
 *
 * Returns null far more often than not, which is the intended bias: no
 * candidate, no legal target, the taper lock, a rest day, an "ok" morning —
 * all mean the plan stands as generated.
 */
export function planReadinessSwap(input: ReadinessInput): ReadinessSwap | null {
  const { weeks, today, raceDate, level } = input;
  // An "ok" morning is the absent signal: byte-identical, always (R1).
  if (level === "ok") return null;
  // The taper is protocol, not preference — the same lock the reconcile gate
  // honours, and for the same reason: inside it the plan is pure schedule.
  if (at(raceDate) - at(today) <= TAPER_LOCK_DAYS * DAY) return null;

  const wi = weekIndexContaining(weeks, today);
  if (wi < 0) return null;
  const week = weeks[wi];

  // Only today and later: a readiness tap never rewrites a day already lived.
  const upcoming = week.sessions.filter((s) => s.date >= today);
  const todays = upcoming.filter((s) => s.date === today);
  if (!todays.length) return null;

  const costBefore = qualityAdjacencyCost(week.sessions);
  const legal = (fromDate: string, toDate: string) =>
    qualityAdjacencyCost(withSwap(week.sessions, fromDate, toDate)) <= costBefore;

  if (level === "rough") {
    // Defer today's hard work to a later easy day. Protective: the athlete
    // still does the session this week, just not while they feel wrecked.
    const q = todays.find(isQuality);
    if (!q) return null;
    const target = upcoming
      .filter((s) => s.date > today && isEasy(s))
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .find((s) => legal(q.date, s.date));
    if (!target) return null;
    return { qualityFrom: q.date, qualityTo: target.date, note: describeSwap(week.weekStart, q.date, target.date, "rough", target) };
  }

  // "good": take the quality while it is there, pulling a later hard day
  // forward onto today's easy slot.
  const e = todays.find(isEasy);
  if (!e) return null;
  const source = upcoming
    .filter((s) => s.date > today && isQuality(s))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .find((s) => legal(s.date, e.date));
  if (!source) return null;
  return { qualityFrom: source.date, qualityTo: e.date, note: describeSwap(week.weekStart, source.date, e.date, "good", e) };
}

/** "easy run" / "easy ride" / "easy swim" — what the athlete is actually being
 *  asked to do. Hardcoding "run" told anyone whose Monday is a bike-z2 (which
 *  is what run-5k at 7 days/week places there) to go running. */
function easyLabel(s: PlannedSessionOut): string {
  return s.discipline === "bike" ? "easy ride" : s.discipline === "swim" ? "easy swim" : s.discipline === "run" ? "easy run" : "easy session";
}

export function describeSwap(
  weekStart: string,
  from: string,
  to: string,
  level: "rough" | "good",
  easy: PlannedSessionOut
): string {
  const name = (dt: string) => WEEKDAY_NAMES[dayIndex(weekStart, dt)] ?? dt;
  const what = easyLabel(easy);
  return level === "rough"
    ? `Rough morning — the hard session moves from ${name(from)} to ${name(to)}, and ${name(to)}'s ${what} comes back to ${name(from)}. The week's load is unchanged.`
    : `Feeling good — ${name(from)}'s hard session comes forward to ${name(to)}, and the ${what} takes ${name(from)}. The week's load is unchanged.`;
}

/**
 * Apply a swap in place: the two sessions exchange dates (and weekday labels,
 * which are derived from the date and would otherwise go stale). Returns
 * false and touches nothing when the swap no longer matches the plan — the
 * guard that makes a repeat tap a no-op instead of a double move.
 */
export function applyReadinessSwap(weeks: PlanWeek[], swap: ReadinessSwap): boolean {
  for (const w of weeks) {
    const a = w.sessions.find((s) => s.date === swap.qualityFrom && isQuality(s));
    const b = w.sessions.find((s) => s.date === swap.qualityTo && isEasy(s));
    if (!a || !b) continue;
    a.date = swap.qualityTo;
    b.date = swap.qualityFrom;
    a.weekday = WEEKDAY_SHORT[dayIndex(w.weekStart, a.date)] ?? a.weekday;
    b.weekday = WEEKDAY_SHORT[dayIndex(w.weekStart, b.date)] ?? b.weekday;
    w.sessions.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    return true;
  }
  return false;
}
