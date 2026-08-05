import {
  addDaysIso,
  carryStatusForward,
  describeChange,
  planShape,
  preserveCompletedWeeks,
  weekIndexContaining,
  withDoneMarkFallback,
} from "./plan-ops.ts";
import type { Plan, PlanWeek } from "./plan.ts";

/**
 * The hoisted shared plan operations. These were parallel copies in
 * src/lib/replan-auto.ts and mobile/src/lib/reconcile.ts — the exact
 * functions every mobile-lags-dashboard bug in this repo lived inside. Now
 * there is one implementation and one set of pins.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const sess = (date: string, discipline: string, tss: number, status?: "done" | "skipped") =>
  ({ date, weekday: "Mon", discipline, title: `${discipline} ${tss}`, durationHr: 1, tss, structure: "", why: "", status }) as unknown as PlanWeek["sessions"][number];

const wk = (weekStart: string, sessions: PlanWeek["sessions"]): PlanWeek =>
  ({ weekStart, phase: "base", targetTss: 100, projected: { ctl: 1, atl: 1, tsb: 0 }, sessions }) as PlanWeek;

const mkPlan = (weeks: PlanWeek[]): Plan =>
  ({ meta: { generatedAt: "x", replanNote: undefined }, weeks }) as unknown as Plan;

// ——— O1. weekIndexContaining: the strict contract ————————————————————————
{
  const weeks = [{ weekStart: "2026-01-05" }, { weekStart: "2026-01-12" }, { weekStart: "2026-01-19" }];
  check("O1a", "a mid-week date finds its week", weekIndexContaining(weeks, "2026-01-14") === 1);
  check("O1b", "the Monday boundary belongs to the new week", weekIndexContaining(weeks, "2026-01-12") === 1);
  check("O1c", "the last week ENDS (does not run to 9999)", weekIndexContaining(weeks, "2026-01-26") === -1,
    String(weekIndexContaining(weeks, "2026-01-26")));
  check("O1d", "a date before the plan is -1, NOT week 0 — no silent fallback",
    weekIndexContaining(weeks, "2025-12-30") === -1, String(weekIndexContaining(weeks, "2025-12-30")));
  check("O1e", "the last week's own days still resolve", weekIndexContaining(weeks, "2026-01-25") === 2);
  check("O1f", "an empty plan is -1", weekIndexContaining([], "2026-01-14") === -1);
}

// ——— O2. addDaysIso is DST-safe ————————————————————————————————————————————
{
  check("O2a", "plain arithmetic", addDaysIso("2026-01-05", 7) === "2026-01-12");
  check("O2b", "backwards", addDaysIso("2026-01-05", -1) === "2026-01-04");
  // US DST starts 2026-03-08; noon anchoring must not lose or gain a day.
  check("O2c", "across a DST boundary the date still advances by exactly one",
    addDaysIso("2026-03-07", 1) === "2026-03-08" && addDaysIso("2026-03-08", 1) === "2026-03-09");
  check("O2d", "across a month/year boundary", addDaysIso("2026-12-31", 1) === "2027-01-01");
}

// ——— O3. carryStatusForward keeps the athlete's log across a reflow ————————
{
  const prev = mkPlan([
    wk("2026-01-05", [sess("2026-01-05", "run", 60, "done"), sess("2026-01-07", "run", 40, "skipped")]),
  ]);
  // The reflow rebuilt the same days with different durations/titles.
  const next = mkPlan([
    wk("2026-01-05", [sess("2026-01-05", "run", 75), sess("2026-01-07", "run", 55), sess("2026-01-09", "run", 30)]),
  ]);
  carryStatusForward(prev, next);
  check("O3a", "a done mark survives a changed session TSS/title", next.weeks[0].sessions[0].status === "done");
  check("O3b", "a skipped mark survives too (the athlete asserted it)",
    next.weeks[0].sessions[1].status === "skipped");
  check("O3c", "a newly added day carries no mark", next.weeks[0].sessions[2].status === undefined);

  // Keyed on (date, discipline): a different discipline on the same day is a
  // different session and must NOT inherit the mark.
  const other = mkPlan([wk("2026-01-05", [sess("2026-01-05", "bike", 50)])]);
  carryStatusForward(prev, other);
  check("O3d", "a different discipline on the same date does not inherit the mark",
    other.weeks[0].sessions[0].status === undefined);
}

// ——— O4. preserveCompletedWeeks — the truncation guard ————————————————————
{
  const previous = mkPlan([wk("2026-01-05", []), wk("2026-01-12", []), wk("2026-01-19", [])]);
  const reflowed = mkPlan([wk("2026-01-19", []), wk("2026-01-26", [])]);
  preserveCompletedWeeks(previous, reflowed);
  check("O4a", "completed weeks are re-attached ahead of the reflow",
    reflowed.weeks.length === 4 && reflowed.weeks[0].weekStart === "2026-01-05",
    reflowed.weeks.map((w) => w.weekStart).join(","));
  check("O4b", "…chronological with no duplicate of the boundary week",
    reflowed.weeks.filter((w) => w.weekStart === "2026-01-19").length === 1);
  const empty = mkPlan([]);
  preserveCompletedWeeks(previous, empty);
  check("O4c", "an empty reflow is left alone (nothing to anchor against)", empty.weeks.length === 0);
}

// ——— O5. describeChange — one sentence, both surfaces ————————————————————
{
  const under = describeChange({ deltaPct: -0.35, executedTss: 130, plannedTss: 200 });
  check("O5a", "an undershoot reads 'under' with both numbers",
    under.includes("35% under plan") && under.includes("130 vs 200 TSS"), under);
  const over = describeChange({ deltaPct: 0.4, executedTss: 280, plannedTss: 200 });
  check("O5b", "an overshoot reads 'over'", over.includes("40% over plan"));
  check("O5c", "it states the consequence, not just the observation",
    under.includes("recalculated from your current fitness"));
}

// ——— O6. planShape ignores stamps, sees load ——————————————————————————————
{
  const a = mkPlan([wk("2026-01-05", [sess("2026-01-05", "run", 60)])]);
  const b = mkPlan([wk("2026-01-05", [sess("2026-01-05", "run", 60)])]);
  (b.meta as Record<string, unknown>).generatedAt = "different";
  (b.meta as Record<string, unknown>).lastRecomputed = "2026-02-01";
  check("O6a", "a differing generatedAt/stamp is NOT a change (no false 'Re-planned')",
    planShape(a) === planShape(b));
  const c = mkPlan([wk("2026-01-05", [sess("2026-01-05", "run", 61)])]);
  check("O6b", "one TSS of real difference IS a change", planShape(a) !== planShape(c));
  const d = mkPlan([wk("2026-01-05", [sess("2026-01-05", "run", 60)])]);
  d.meta.replanNote = "something";
  check("O6c", "a new note is a change (the athlete must see it)", planShape(a) !== planShape(d));
}

// ——— O7. withDoneMarkFallback is POSITIVE-ONLY ————————————————————————————
{
  const weeks = [
    { weekStart: "2026-01-05", sessions: [sess("2026-01-05", "run", 60, "done"), sess("2026-01-07", "run", 40)] },
    { weekStart: "2026-01-12", sessions: [sess("2026-01-12", "run", 60)] }, // nothing tapped
    { weekStart: "2026-01-19", sessions: [sess("2026-01-19", "run", 60, "done")] },
  ];
  const executed = new Map([["2026-01-19", 999]]); // importers already spoke for this week
  const out = withDoneMarkFallback(weeks, executed);
  check("O7a", "an untouched week is filled from its done marks", out.get("2026-01-05") === 60);
  check("O7b", "a week with NO marks stays UNKNOWN — never an authoritative zero",
    !out.has("2026-01-12"), String(out.get("2026-01-12")));
  check("O7c", "import evidence is never overwritten by done marks", out.get("2026-01-19") === 999);
  check("O7d", "the input map is not mutated", executed.size === 1);
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nplan-ops: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
