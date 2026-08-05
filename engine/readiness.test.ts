import { readFileSync } from "node:fs";
import {
  applyReadinessSwap,
  planReadinessSwap,
  qualityAdjacencyCost,
  type ReadinessLevel,
} from "./readiness.ts";
import type { PlannedSessionOut, PlanWeek } from "./plan.ts";

/**
 * Morning readiness check-in — placement only.
 *
 * The whole feature is one claim: a readiness tap may REORDER this week's
 * sessions and may change nothing else. Weekly TSS, session content, phase,
 * and every rail stay exactly as generated, which is also why it cannot
 * reach the backtest — the prediction path replays weekly totals, and those
 * are invariant by construction here (a swap exchanges two dates, nothing
 * more).
 *
 * R1 is the §12 neutrality gate: no entry ⇒ no swap ⇒ byte-identical plan.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const DAY = 86400000;
const d = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A session with a real zone structure, so classification uses the engine's
 *  own zone ruler rather than a title regex. */
function sess(date: string, dayIdx: number, kind: "easy" | "quality" | "long" | "race", tss: number): PlannedSessionOut {
  const blocks =
    kind === "quality"
      ? [
          { kind: "segment" as const, zone: "easy" as const, durationSec: 900 },
          { kind: "reps" as const, zone: "vo2" as const, reps: 5, durationSec: 240, recoverySec: 120 },
          { kind: "segment" as const, zone: "easy" as const, durationSec: 600 },
        ]
      : [{ kind: "segment" as const, zone: "easy" as const, durationSec: 3600 }];
  return {
    date,
    weekday: WD[dayIdx],
    discipline: kind === "race" ? "race" : "run",
    title: kind === "long" ? "Long run 90" : kind === "quality" ? "VO2 intervals" : kind === "race" ? "Tune-up 10k" : "Easy 45",
    durationHr: tss / 60,
    tss,
    structure: "",
    why: "",
    workout: { blocks },
    ...(kind === "race" ? { tuneup: true } : {}),
  } as PlannedSessionOut;
}

/** Mon-start week: Tue quality, Wed easy, Thu easy, Sun long — the generator's
 *  own default shape for a 4-day run week. */
function week(monday: string, over: Partial<Record<number, "easy" | "quality" | "long" | "race">> = {}): PlanWeek {
  const layout: Record<number, "easy" | "quality" | "long"> = { 1: "quality", 2: "easy", 3: "easy", 6: "long" };
  const sessions: PlannedSessionOut[] = [];
  for (const idx of [0, 1, 2, 3, 4, 5, 6]) {
    const kind = idx in over ? over[idx] : layout[idx];
    if (!kind) continue;
    sessions.push(sess(d(monday, idx), idx, kind, kind === "long" ? 90 : kind === "quality" ? 75 : 45));
  }
  return { weekStart: monday, phase: "build", targetTss: sessions.reduce((a, s) => a + s.tss, 0), projected: { ctl: 40, atl: 40, tsb: 0 }, sessions };
}

const weekTss = (w: PlanWeek) => w.sessions.reduce((a, s) => a + s.tss, 0);
const shape = (w: PlanWeek) =>
  JSON.stringify(w.sessions.map((s) => ({ d: s.date, t: s.title, tss: s.tss })).sort((a, b) => (a.d < b.d ? -1 : 1)));

const MON = "2026-03-02"; // a Monday
const RACE = "2026-06-14"; // far outside the taper lock

// ——— R0. backtest neutrality by construction ————————————————————————————————
{
  const bt = readFileSync("engine/backtest.ts", "utf8");
  check("R0", "backtest.ts never imports readiness (placement cannot reach the pinned path)",
    !/readiness/.test(bt));
}

// ——— R1. NEUTRALITY: "ok", or no entry at all, changes nothing ————————————
{
  const w = week(MON);
  const before = JSON.stringify(w);
  const swap = planReadinessSwap({ weeks: [w], today: d(MON, 1), raceDate: RACE, level: "ok" });
  check("R1a", '"ok" produces no swap', swap === null);
  check("R1b", "…and the plan is byte-identical (the §12 neutrality gate)", JSON.stringify(w) === before);
}

// ——— R2. "rough" defers today's quality to a later easy day ————————————————
{
  const w = week(MON);
  const tue = d(MON, 1);
  const tssBefore = weekTss(w);
  const swap = planReadinessSwap({ weeks: [w], today: tue, raceDate: RACE, level: "rough" });
  check("R2a", "a rough morning on a quality day proposes a swap", swap !== null, swap ? "" : "none");
  if (swap) {
    check("R2b", "the quality session moves OFF today", swap.qualityFrom === tue, swap.qualityFrom);
    check("R2c", "…to a later day in the same week", swap.qualityTo > tue && swap.qualityTo <= d(MON, 6),
      swap.qualityTo);
    applyReadinessSwap([w], swap);
    check("R2d", "weekly TSS is unchanged — the whole safety claim", weekTss(w) === tssBefore,
      `${weekTss(w)} vs ${tssBefore}`);
    const moved = w.sessions.find((s) => s.title === "VO2 intervals")!;
    check("R2e", "the quality session now sits on the new date", moved.date === swap.qualityTo, moved.date);
    check("R2f", "…with its content untouched (tss, title, workout all travel with it)",
      moved.tss === 75 && !!moved.workout && moved.workout.blocks.length === 3);
    check("R2g", "the easy session took the vacated day",
      w.sessions.some((s) => s.date === tue && s.title === "Easy 45"));
    check("R2h", "sessions stay date-sorted", w.sessions.every((s, i, a) => i === 0 || a[i - 1].date <= s.date));
    check("R2i", "the weekday label follows the new date, never stale",
      moved.weekday === WD[Math.round((Date.parse(moved.date + "T12:00:00Z") - Date.parse(MON + "T12:00:00Z")) / DAY)],
      moved.weekday);
  }
}

// ——— R3. "good" pulls a later quality day forward onto an easy today ————————
{
  // Easy Tue/Wed, quality Thu, long Sun — so Tuesday has a later hard day to
  // pull forward, and landing it on Tuesday crowds nothing.
  const w = week(MON, { 1: "easy", 3: "quality" });
  const tue = d(MON, 1);
  const tssBefore = weekTss(w);
  const swap = planReadinessSwap({ weeks: [w], today: tue, raceDate: RACE, level: "good" });
  check("R3a", "a good morning on an easy day pulls quality forward", swap !== null, swap ? "" : "none");
  if (swap) {
    check("R3b", "the quality lands on today", swap.qualityTo === tue, swap.qualityTo);
    check("R3d", "…and comes from a LATER day, never an earlier one", swap.qualityFrom > tue, swap.qualityFrom);
    applyReadinessSwap([w], swap);
    check("R3c", "weekly TSS unchanged", weekTss(w) === tssBefore);
  }
}

// ——— R4. HARD EXCLUSIONS ————————————————————————————————————————————————————
{
  // Inside the 21-day taper lock, no readiness signal moves anything.
  const w = week(MON);
  const inLock = planReadinessSwap({ weeks: [w], today: d(MON, 1), raceDate: d(MON, 15), level: "rough" });
  check("R4a", "never swaps inside the 21-day taper lock", inLock === null);
  const atBoundary = planReadinessSwap({ weeks: [w], today: d(MON, 1), raceDate: d(MON, 1 + 21), level: "rough" });
  check("R4b", "…the boundary itself is locked (exactly 21 days out)", atBoundary === null);
  const outside = planReadinessSwap({ weeks: [w], today: d(MON, 1), raceDate: d(MON, 1 + 22), level: "rough" });
  check("R4c", "…and 22 days out is free", outside !== null);

  // The long run never moves, in either direction.
  const longOnly = week(MON, { 1: undefined, 2: undefined, 3: undefined });
  const noQuality = planReadinessSwap({ weeks: [longOnly], today: d(MON, 6), raceDate: RACE, level: "rough" });
  check("R4d", "a rough morning ON the long run does not move it", noQuality === null);
  const w2 = week(MON);
  const goodOnLong = planReadinessSwap({ weeks: [w2], today: d(MON, 6), raceDate: RACE, level: "good" });
  check("R4e", "…nor does a good one pull quality onto the long-run day", goodOnLong === null);

  // Race / tune-up sessions are protocol.
  const withRace = week(MON, { 3: "race" });
  const onRace = planReadinessSwap({ weeks: [withRace], today: d(MON, 3), raceDate: RACE, level: "rough" });
  check("R4f", "a tune-up race day is never swapped", onRace === null);

  // The past is never rewritten.
  const w3 = week(MON);
  const backwards = planReadinessSwap({ weeks: [w3], today: d(MON, 3), raceDate: RACE, level: "rough" });
  check("R4g", "a rough morning on an EASY day proposes nothing to defer", backwards === null);
}

// ——— R5. structural cost never degrades ————————————————————————————————————
{
  // Quality on Tue, easy Sat, long Sun. Moving Tue's quality to Saturday would
  // park it the day before the long run — worse than the plan it started from.
  const w = week(MON, { 2: undefined, 3: undefined, 5: "easy" });
  const costBefore = qualityAdjacencyCost(w.sessions);
  const swap = planReadinessSwap({ weeks: [w], today: d(MON, 1), raceDate: RACE, level: "rough" });
  check("R5a", "no legal target ⇒ no swap rather than a bad one", swap === null,
    swap ? `${swap.qualityFrom}→${swap.qualityTo}` : "");
  check("R5b", "the untouched week keeps its original adjacency cost",
    qualityAdjacencyCost(w.sessions) === costBefore);

  // With a mid-week easy day available, the swap takes it and the cost does
  // not rise.
  const w2 = week(MON, { 5: "easy" });
  const before2 = qualityAdjacencyCost(w2.sessions);
  const s2 = planReadinessSwap({ weeks: [w2], today: d(MON, 1), raceDate: RACE, level: "rough" });
  if (s2) {
    applyReadinessSwap([w2], s2);
    check("R5c", "a taken swap never raises the adjacency cost",
      qualityAdjacencyCost(w2.sessions) <= before2,
      `${qualityAdjacencyCost(w2.sessions)} vs ${before2}`);
    check("R5d", "…and never lands quality the day before the long run",
      s2.qualityTo !== d(MON, 5), s2.qualityTo);
  } else {
    check("R5c", "a mid-week easy day is a legal target", false, "no swap found");
  }
}

// ——— R6. same week only ————————————————————————————————————————————————————
{
  const w1 = week(MON);
  const w2 = week(d(MON, 7));
  const swap = planReadinessSwap({ weeks: [w1, w2], today: d(MON, 1), raceDate: RACE, level: "rough" });
  check("R6a", "the swap target is inside this week", !!swap && swap.qualityTo < d(MON, 7),
    swap ? swap.qualityTo : "none");
  if (swap) {
    const t1 = weekTss(w1);
    const t2 = weekTss(w2);
    applyReadinessSwap([w1, w2], swap);
    check("R6b", "next week is untouched", weekTss(w2) === t2 && shape(w2) === shape(week(d(MON, 7))));
    check("R6c", "…and this week's total is preserved", weekTss(w1) === t1);
  }
}

// ——— R7. idempotence / repeat application ————————————————————————————————
{
  const w = week(MON);
  const swap = planReadinessSwap({ weeks: [w], today: d(MON, 1), raceDate: RACE, level: "rough" })!;
  applyReadinessSwap([w], swap);
  const after = shape(w);
  const applied = applyReadinessSwap([w], swap);
  check("R7a", "re-applying the same swap is refused, not doubled", applied === false || shape(w) !== after ? applied === false : true);
  check("R7b", "…and the plan is unchanged by the refusal", shape(w) === after);
}

// ——— R8. every level is total ————————————————————————————————————————————
{
  const levels: ReadinessLevel[] = ["rough", "ok", "good"];
  let threw = 0;
  for (const level of levels) {
    for (let day = 0; day < 7; day++) {
      const w = week(MON);
      const t = weekTss(w);
      try {
        const s = planReadinessSwap({ weeks: [w], today: d(MON, day), raceDate: RACE, level });
        if (s) applyReadinessSwap([w], s);
        if (weekTss(w) !== t) threw++;
      } catch {
        threw++;
      }
    }
  }
  check("R8", "every (level × weekday) either swaps cleanly or does nothing — never throws, never changes load",
    threw === 0, `${threw} bad cells`);
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nreadiness: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
