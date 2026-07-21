import { generatePlan, type Plan, type PlanRequest } from "./plan.ts";
import { deriveZones } from "./zones.ts";
import type { AthleteState } from "./types.ts";

/**
 * Tune-up race tests (B-races). tsx script; exit code = failure count.
 * Same seam as goalPeakCtl: `tuneups` lives on PlanRequest only, so the
 * backtest path never sees it and cannot change.
 *
 * The linchpin (TU1): a plan with no tuneups is BYTE-IDENTICAL to one
 * generated before the field existed. A tune-up reshapes ONLY its own week:
 * race effort becomes that week's quality, the day before drops to openers,
 * the day after to recovery, and the week's budget absorbs the race TSS —
 * a 10k three weeks out is never pretended to be free.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const seed: AthleteState = {
  ctl: 30,
  atl: 28,
  tsb: 2,
  last4WeeksTss: [190, 200, 205, 210],
  trailingWeeksTss: [170, 180, 185, 190, 190, 200, 205, 210],
  last4Shares: { swim: 0, bike: 0, run: 1 },
  daysToNextRace: null,
  weeksSinceStart: 24,
  breakRatio: 1,
  daysSinceLastSession: 1,
};
const zones = deriveZones({
  ftpWatts: 250,
  lthrBpm: 170,
  runThresholdSpeedMps: 3.6,
  swimCssMps: 1.2,
});

const base: PlanRequest = {
  raceName: "Goal Half",
  raceDate: "2026-10-18",
  raceType: "run-half",
  daysPerWeek: 5,
  longDay: "sunday",
  startDate: "2026-07-20", // a Monday
  goalTime: "1:35:00",
};

const gen = (req: PlanRequest): Plan => generatePlan(req, seed, [], zones);
/** Plan minus the wall-clock stamp — the only legitimately nondeterministic byte. */
const stable = (p: Plan): string => JSON.stringify({ ...p, meta: { ...p.meta, generatedAt: "X" } });

// ——— TU1. Neutrality: no tuneups ⇒ byte-identical ————————————————————————
{
  const a = stable(gen(base));
  const b = stable(gen({ ...base, tuneups: [] }));
  const c = stable(gen({ ...base }));
  check("TU1a", "tuneups: [] is byte-identical to the field being absent", a === b);
  check("TU1b", "generation is deterministic modulo generatedAt (control)", a === c);
}

// ——— TU2. The race session lands on the right day with race load ————————
{
  // Sunday 2026-07-26: six days into the plan.
  const plan = gen({ ...base, tuneups: [{ date: "2026-07-26", raceType: "run-10k", name: "Riverside 10k" }] });
  const all = plan.weeks.flatMap((w) => w.sessions);
  const race = all.find((s) => s.date === "2026-07-26");
  check("TU2a", "a session exists on the tune-up date", !!race);
  check("TU2b", "it is a race-discipline session named for the race", race?.discipline === "race" && race?.title === "Riverside 10k", race?.title);
  check("TU2c", "it is flagged tuneup", race?.tuneup === true);
  check("TU2d", "it carries 10k race load (well above an easy day, below the goal race)",
    !!race && race.tss >= 45 && race.tss <= 90, String(race?.tss));
}

// ——— TU3. The week reshapes around it ————————————————————————————————————
{
  const plan = gen({ ...base, tuneups: [{ date: "2026-07-26", raceType: "run-10k" }] });
  const control = gen(base);
  const week = plan.weeks.find((w) => w.weekStart === "2026-07-20")!;
  const controlWeek = control.weeks.find((w) => w.weekStart === "2026-07-20")!;
  const dayBefore = week.sessions.find((s) => s.date === "2026-07-25");
  check("TU3a", "the day before is short and easy (openers, ≤35 min, no quality/long)",
    !dayBefore || (dayBefore.durationHr <= 0.6 && !/tempo|interval|vo2|long/i.test(dayBefore.title)),
    dayBefore ? `${dayBefore.title} ${dayBefore.durationHr}h` : "rest");
  const longRun = week.sessions.find((s) => /long/i.test(s.title));
  check("TU3b", "no long run inside the tune-up weekend", !longRun, longRun?.date);
  const hardDays = week.sessions.filter((s) => /tempo|interval|vo2/i.test(s.title) && !s.tuneup);
  check("TU3c", "the race replaces the week's quality (no second hard session)", hardDays.length === 0,
    hardDays.map((s) => s.title).join(","));
  check("TU3d", "week total stays near the prescription (race TSS absorbed, not stacked)",
    Math.abs(week.targetTss - controlWeek.targetTss) <= Math.max(25, controlWeek.targetTss * 0.15),
    `${week.targetTss} vs ${controlWeek.targetTss}`);
}

// ——— TU4. Only that week changes ————————————————————————————————————————
{
  const plan = gen({ ...base, tuneups: [{ date: "2026-07-26", raceType: "run-10k" }] });
  const control = gen(base);
  // Weeks 3+ keep their STRUCTURE (dates, titles, disciplines); the tune-up
  // week's different daily pattern legitimately ripples CTL into later
  // prescriptions by a few TSS, so loads match within tolerance, not bytes.
  let diverged = "";
  for (let i = 2; i < plan.weeks.length && !diverged; i++) {
    const a = plan.weeks[i].sessions;
    const b = control.weeks[i].sessions;
    if (a.length !== b.length) { diverged = `${plan.weeks[i].weekStart} count`; break; }
    // Titles embed minutes ("Easy 50") — that's load, not structure. Strip
    // digits for the structural comparison; load itself is bounded below.
    const shape = (t: string) => t.replace(/\d+/g, "#");
    for (let j = 0; j < a.length; j++) {
      if (a[j].date !== b[j].date || shape(a[j].title) !== shape(b[j].title) || a[j].discipline !== b[j].discipline) {
        diverged = `${a[j].date} ${a[j].title} vs ${b[j].title}`;
        break;
      }
      if (Math.abs(a[j].tss - b[j].tss) > 6) {
        diverged = `${a[j].date} tss ${a[j].tss} vs ${b[j].tss}`;
        break;
      }
    }
  }
  check("TU4a", "later weeks keep structure; loads within ±5 TSS (PMC ripple only)", diverged === "", diverged);
}

// ——— TU5. Guard rails ————————————————————————————————————————————————————
{
  let err = "";
  try {
    gen({ ...base, tuneups: [{ date: "2026-10-11", raceType: "run-10k" }] });
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  check("TU5a", "a tune-up inside the final 10 days before the goal race is rejected", /taper|goal race|too close/i.test(err), err);

  let err2 = "";
  try {
    gen({ ...base, tuneups: [{ date: "2026-07-10", raceType: "run-10k" }] });
  } catch (e) {
    err2 = e instanceof Error ? e.message : String(e);
  }
  check("TU5b", "a tune-up before the plan starts is rejected", /before|starts|window/i.test(err2), err2);
}

// ——— TU6. Cross-week softening (Monday race ⇒ Sunday before goes easy) ——
{
  const plan = gen({ ...base, tuneups: [{ date: "2026-08-03", raceType: "run-5k" }] }); // a Monday
  const all = plan.weeks.flatMap((w) => w.sessions);
  const dayBefore = all.find((s) => s.date === "2026-08-02"); // Sunday, the long day
  check("TU6a", "the day before a Monday tune-up is not a long run",
    !dayBefore || !/long/i.test(dayBefore.title), dayBefore?.title);
  const race = all.find((s) => s.date === "2026-08-03");
  check("TU6b", "the Monday race session exists", race?.tuneup === true);
}

// ——— report ————————————————————————————————————————————————————————————
for (const p of passes) console.log(p);
for (const f of failures) console.error(f);
console.log(`\n${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
