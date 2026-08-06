import { seedActualState, mobileGapEvidence } from "./fitness-seed";
import { tooSpeculativeToPrescribe } from "../../engine/seed.ts";
import type { Plan } from "../../engine/plan.ts";
import type { AthleteState } from "../../engine/types.ts";

/**
 * The phone's fitness seed — E8's provenance discipline on mobile evidence.
 *
 * The 2026-08-06 verification pass found mobile's two private PMC replays
 * filling every day since pairing with `?? 0` and consulting no coverage, so
 * zeroLoadDays was 0 by construction and E8's refusal could never fire: five
 * untapped training weeks decayed CTL toward a beginner value and the reflow
 * rebuilt the whole season from the fiction (Mobile-1, through the fitness
 * side). Both replays are deleted; this pins the replacement, which routes
 * through engine/seed.ts's own gap loop — the one place the recursion and the
 * provenance accounting live.
 *
 * Runs under tsx from the repo root through the mobile/engine symlink, like
 * health-codec.test.ts.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(Date.parse(d + "T12:00:00Z") + n * DAY);
const localDate = (isoInstant: string) => isoInstant.slice(0, 10);

const ANCHOR = "2026-06-29"; // Monday, pairing day — seed measured here
const ASOF = "2026-08-03"; // Monday five weeks later
const seed: AthleteState = {
  ctl: 50,
  atl: 50,
  tsb: 0,
  last4WeeksTss: [350, 350, 350, 350],
  last4Shares: { swim: 0, bike: 0, run: 1 },
  daysToNextRace: null,
  weeksSinceStart: 30,
  breakRatio: 1,
  daysSinceLastSession: 1,
};

/** A five-week plan from the anchor: 5 sessions/week (Mon Tue Thu Fri Sun),
 *  ~70 TSS each, optionally tapped done. */
function plan(tapped: boolean): Plan {
  const weeks = [];
  for (let w = 0; w < 5; w++) {
    const weekStart = addDays(ANCHOR, w * 7);
    const sessions = [0, 1, 3, 4, 6].map((d) => ({
      date: addDays(weekStart, d),
      weekday: "X",
      discipline: "run",
      title: `Easy ${60 + d}`,
      durationHr: 1,
      tss: 70,
      structure: "",
      why: "",
      ...(tapped ? { status: "done" } : {}),
    }));
    weeks.push({ weekStart, phase: "build", targetTss: 350, sessions, projected: { ctl: 50, atl: 50, tsb: 0 } });
  }
  return { weeks, meta: {} } as unknown as Plan;
}

// ——— M1. THE KILL TEST: five untapped weeks with no coverage REFUSE ————————
{
  const st = seedActualState(seed, ANCHOR, plan(false), ASOF, [], [], {}, localDate);
  check("M1a", "five untapped scheduled weeks are counted as assumptions, not proven rest",
    st.zeroLoadDays >= 24, `${st.zeroLoadDays} assumed`);
  check("M1b", "…so the state is too speculative to prescribe from — E8's refusal can fire on mobile",
    tooSpeculativeToPrescribe(st), `zeroLoadDays=${st.zeroLoadDays}`);
  // The old behaviour, pinned as the disease: rolling 35 days at zero decays
  // CTL toward a beginner value. The state still REPORTS that number (it is a
  // lower bound) — what changed is that it now carries the provenance that
  // forbids prescribing from it.
  check("M1c", "the decayed CTL is still reported as the lower bound it is",
    st.ctl < seed.ctl * 0.6, `ctl ${st.ctl.toFixed(1)} from ${seed.ctl}`);
}

// ——— M2. the tap-everything athlete proceeds ———————————————————————————————
{
  const st = seedActualState(seed, ANCHOR, plan(true), ASOF, [], [], {}, localDate);
  check("M2a", "a fully tapped stretch has zero assumed days — plan rest days are rest by prescription",
    st.zeroLoadDays === 0, `${st.zeroLoadDays} assumed`);
  check("M2b", "…and is not refused", !tooSpeculativeToPrescribe(st));
  check("M2c", "…and the tapped load actually feeds fitness (no decay fiction)",
    st.ctl > 45, `ctl ${st.ctl.toFixed(1)}`);
}

// ——— M3. coverage makes an empty stretch authoritative rest ————————————————
{
  const st = seedActualState(seed, ANCHOR, plan(false), ASOF, [],
    [{ source: "healthkit", from: ANCHOR, to: ASOF }], {}, localDate);
  check("M3a", "a source that covered the window turns untapped days into authoritative rest",
    st.zeroLoadDays === 0 && !tooSpeculativeToPrescribe(st), `${st.zeroLoadDays} assumed`);
  check("M3b", "…which is a REAL zero: fitness decays, and prescribing from it is allowed",
    st.ctl < seed.ctl * 0.6, `ctl ${st.ctl.toFixed(1)}`);
}

// ——— M4. the seams ————————————————————————————————————————————————————————
{
  const st = seedActualState(seed, undefined, plan(false), ASOF, [], [], {}, localDate);
  check("M4a", "no pairing anchor ⇒ the raw seed, nothing to account for",
    st.ctl === seed.ctl && st.zeroLoadDays === 0 && st.anchorDate === null);

  // Morning convention: the state at asOf must not contain asOf itself —
  // the ~12 TSB divergence between mobile's two old replays.
  const dayBefore = seedActualState(seed, ANCHOR, plan(true), addDays(ASOF, -1), [], [], {}, localDate);
  const atAsof = seedActualState(seed, ANCHOR, plan(true), ASOF, [], [], {}, localDate);
  const sunday = addDays(ASOF, -1); // long-run day, tapped 76 TSS
  const g = mobileGapEvidence(plan(true), [], [], {}, localDate);
  check("M4b", "the state at asOf includes yesterday's session but never asOf's own",
    Math.abs(atAsof.ctl - (dayBefore.ctl + ((g.load.get(sunday) ?? 0) - dayBefore.ctl) / 42)) < 1e-9,
    `ctl ${atAsof.ctl.toFixed(2)}`);

  // A day OUTSIDE the plan entirely (anchor precedes the plan) is rest by
  // prescription — the zero-load decay the seed needs, not an assumption.
  const lateStart = plan(false);
  (lateStart.weeks as unknown as Array<{ weekStart: string }>).splice(0, 2);
  const st2 = seedActualState(seed, ANCHOR, lateStart, ASOF, [], [], {}, localDate);
  check("M4c", "days before the plan starts are not assumptions",
    st2.zeroLoadDays <= 15, `${st2.zeroLoadDays} assumed (only the 3 remaining untapped weeks)`);
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nfitness-seed: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
