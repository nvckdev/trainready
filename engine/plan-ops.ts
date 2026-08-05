import type { Plan, PlanWeek } from "./plan.ts";

/**
 * Pure plan operations shared by both surfaces.
 *
 * Every mobile-lags-dashboard incident in this repo's history lived in a
 * duplicated copy of one of these functions: the authoritative-zero bug, the
 * `??`-vs-`||` ramp reference, the nested RE-PLANNED stamp. Wave 1 hoisted
 * buildLedger and the sync merge for the same reason; this file finishes the
 * job. Nothing here touches I/O, React, or the PMC recursion — a surface that
 * needs one of these behaviors imports it rather than re-typing it, and the
 * two apps cannot drift apart again by editing one copy.
 */

const DAY = 86400000;

/** ISO date + n days, DST-safe via noon-UTC anchoring (rule 7). */
export function addDaysIso(date: string, days: number): string {
  return new Date(Date.parse(date + "T12:00:00Z") + days * DAY).toISOString().slice(0, 10);
}

/**
 * Index of the plan week CONTAINING `today`, or -1.
 *
 * The strict contract, deliberately. Two versions of this existed under one
 * name: the dashboard's treated the final week as running to "9999-12-31" and
 * returned 0 — the FIRST week — when nothing matched, so a date before the
 * plan began reported "you are in week 1" and a date after the race reported
 * the race week forever. Mobile's bounded the last week and returned -1.
 * Callers that want a fallback should say so at the call site (mobile's Today
 * and Fitness tabs both do, clamping to week 1 only when today precedes the
 * plan) rather than inheriting a silent one.
 */
export function weekIndexContaining(weeks: Array<{ weekStart: string }>, today: string): number {
  for (let i = 0; i < weeks.length; i++) {
    const end = weeks[i + 1]?.weekStart ?? addDaysIso(weeks[i].weekStart, 7);
    if (today >= weeks[i].weekStart && today < end) return i;
  }
  return -1;
}

/**
 * Copy done/skipped marks from the old plan onto matching sessions in the new
 * one. Keyed (date, discipline) — titles change when durations shift, so
 * matching on title would silently drop the athlete's log on every reflow.
 */
export function carryStatusForward(prev: Plan, next: Plan): void {
  const marks = new Map<string, "done" | "skipped">();
  for (const w of prev.weeks) {
    for (const s of w.sessions) {
      if (s.status === "done" || s.status === "skipped") marks.set(`${s.date}|${s.discipline}`, s.status);
    }
  }
  for (const w of next.weeks) {
    for (const s of w.sessions) {
      const m = marks.get(`${s.date}|${s.discipline}`);
      if (m) s.status = m;
    }
  }
}

/**
 * Re-attach the completed weeks a reflow dropped.
 *
 * generatePlan returns only the weeks from `asOf` forward, so without this
 * every reconcile truncates the season to its remainder. That costs the
 * athlete their training log, collapses the ledger to one row (making the
 * 3-overshoot re-baseline and 2-undershoot recalibration unreachable), and on
 * mobile re-seeds the fitness recursion from the pairing-era state every
 * single week, because it anchors on plan.weeks[0].
 */
export function preserveCompletedWeeks(previous: Plan, reflowed: Plan): void {
  const firstNew = reflowed.weeks[0]?.weekStart;
  if (!firstNew) return;
  const past = previous.weeks.filter((w) => w.weekStart < firstNew);
  if (past.length) reflowed.weeks = [...past, ...reflowed.weeks];
}

/** What the reconcile observed, for the fallback note. */
export interface ObservedChange {
  deltaPct: number;
  executedTss: number;
  plannedTss: number;
}

/**
 * Honest fallback copy when a reflow changed the plan but no engine rule
 * produced a note. States the observation and the consequence, nothing
 * stronger — a silent rewrite is the one outcome the reconcile must never
 * have, and two hand-maintained copies of this sentence is how the two
 * surfaces start telling athletes different stories about the same week.
 */
export function describeChange(d: ObservedChange): string {
  const pct = Math.round(Math.abs(d.deltaPct) * 100);
  const dir = d.deltaPct < 0 ? "under" : "over";
  return `last week came in ${pct}% ${dir} plan (${d.executedTss} vs ${d.plannedTss} TSS) → the remaining weeks were recalculated from your current fitness`;
}

/**
 * The comparison that decides whether a reflow is a real change. Weeks plus
 * the note: meta.generatedAt and stamps move on every run, so comparing whole
 * plans would make every no-op look like a change and stamp "Re-planned" on a
 * week the athlete executed perfectly.
 */
export function planShape(p: Plan): string {
  return JSON.stringify({ weeks: p.weeks, note: p.meta.replanNote ?? null });
}

/**
 * Fill weeks the importers never saw with the sum of their done-marked
 * sessions — POSITIVE-ONLY.
 *
 * A tap proves training happened; the absence of a tap proves nothing, so a
 * week with no marks stays absent from the map (unknown) rather than becoming
 * an authoritative zero. Both surfaces need exactly this precedence, and both
 * had their own copy of it.
 */
export function withDoneMarkFallback(
  weeks: Array<Pick<PlanWeek, "weekStart" | "sessions">>,
  executed: Map<string, number>
): Map<string, number> {
  const out = new Map(executed);
  for (const w of weeks) {
    if (out.has(w.weekStart)) continue;
    const done = w.sessions.filter((s) => s.status === "done").reduce((a, s) => a + s.tss, 0);
    if (done > 0) out.set(w.weekStart, Math.round(done));
  }
  return out;
}
