import { existsSync, readFileSync } from "node:fs";
import { generatePlan, type Plan, type PlanRequest, type RaceType } from "./plan.ts";
import { deriveZones } from "./zones.ts";
import type { AthleteState } from "./types.ts";

/**
 * Plan-generation acceptance harness. Encodes DESIRED behavior, including
 * cases known to fail today; the failure list is the hardening work order
 * (.claude/skills/taper-plan-hardening). Exit code = number of failures,
 * so `npm run engine:invariants` doubles as a CI gate once hardened.
 *
 * Runs against the real corpus state when data/ exists, otherwise a
 * synthetic athlete, so it works on any checkout.
 */

function loadState(): { state: AthleteState; zones: ReturnType<typeof deriveZones> } {
  if (existsSync("data/datasets/weekly-examples.jsonl")) {
    const a = JSON.parse(readFileSync("data/raw/athlete.json", "utf8"));
    const ex = readFileSync("data/datasets/weekly-examples.jsonl", "utf8")
      .split("\n")
      .filter(Boolean);
    return {
      state: JSON.parse(ex[ex.length - 1]).features,
      zones: deriveZones({
        ftpWatts: a.thresholds.ftpWatts,
        lthrBpm: a.thresholds.lthrBpm,
        runThresholdSpeedMps: a.thresholds.runThresholdSpeedMpsAlt ?? a.thresholds.runThresholdSpeedMps,
        swimCssMps: a.thresholds.swimCssMps,
      }),
    };
  }
  return {
    state: {
      ctl: 45, atl: 40, tsb: 5,
      last4WeeksTss: [300, 320, 310, 330],
      last4Shares: { swim: 0.15, bike: 0.35, run: 0.5 },
      daysToNextRace: null, weeksSinceStart: 40, breakRatio: 1, daysSinceLastSession: 1,
    },
    zones: deriveZones({ ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: 4.0, swimCssMps: 1.1 }),
  };
}

const { state, zones } = loadState();
const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

function gen(req: Partial<PlanRequest> & { raceDate: string; raceType: RaceType }): Plan | Error {
  try {
    return generatePlan(
      {
        raceName: "Invariant race",
        daysPerWeek: 6,
        longDay: "saturday",
        startDate: "2026-07-14", // a Tuesday, fixed for determinism
        ...req,
      },
      state,
      [],
      zones
    );
  } catch (e) {
    return e as Error;
  }
}

const fullWeeks = (p: Plan) => p.weeks.slice(0, -1); // last week is race week

// ——— I1: nothing scheduled after the gun; race appears exactly once ———
{
  const p = gen({ raceDate: "2026-10-18", raceType: "run-half" });
  if (p instanceof Error) check("I1", "half plan generates", false, p.message);
  else {
    const all = p.weeks.flatMap((w) => w.sessions);
    check("I1a", "no session dated after race day", all.every((s) => s.date <= "2026-10-18"));
    check("I1b", "race session exactly once, on race day",
      all.filter((s) => s.discipline === "race").length === 1 &&
      all.find((s) => s.discipline === "race")!.date === "2026-10-18");
  }
}

// ——— I2: daysPerWeek is a hard cap, all race types ———
for (const [rt, dpw] of [["olympic", 4], ["half-ironman", 5], ["run-marathon", 4]] as Array<[RaceType, number]>) {
  const p = gen({ raceDate: "2026-10-18", raceType: rt, daysPerWeek: dpw });
  if (p instanceof Error) check("I2", `${rt}@${dpw}d generates`, false, p.message);
  else {
    const worst = Math.max(...fullWeeks(p).map((w) => new Set(w.sessions.map((s) => s.date)).size));
    check("I2", `${rt} respects daysPerWeek=${dpw}`, worst <= dpw, `worst week uses ${worst} days`);
  }
}

// ——— I3: race inside the current partial week must not throw ———
{
  const p = gen({ raceDate: "2026-07-18", raceType: "run-5k", startDate: "2026-07-14" });
  check("I3", "Tue signup for Sat race generates a runnable race week",
    !(p instanceof Error) && (p as Plan).weeks.length >= 1 &&
      (p as Plan).weeks[0].sessions.some((s) => s.discipline !== "race"),
    p instanceof Error ? `throws: ${p.message}` : undefined);
}

// ——— I4: the 7 days before any race hold ≥2 sessions, none long ———
{
  const p = gen({ raceDate: "2026-09-14", raceType: "run-10k", startDate: "2026-07-13" }); // Monday race
  if (p instanceof Error) check("I4", "Monday race generates", false, p.message);
  else {
    const pre = p.weeks.flatMap((w) => w.sessions)
      .filter((s) => s.date >= "2026-09-07" && s.date < "2026-09-14");
    check("I4", "Monday race still gets race-week sharpeners",
      pre.length >= 2 && pre.every((s) => !s.title.toLowerCase().includes("long")),
      `${pre.length} sessions in final 7 days`);
  }
}

// ——— I5: the taper tapers, and race morning is fresh ———
{
  const p = gen({ raceDate: "2026-10-18", raceType: "run-half" });
  if (!(p instanceof Error)) {
    const tss = p.weeks.map((w) => w.targetTss);
    const peak = Math.max(...tss.slice(0, -3));
    const lastTwoFull = tss.slice(-3, -1);
    check("I5a", "final two full weeks below peak build week",
      lastTwoFull.every((t) => t < peak), `peak ${peak}, taper ${lastTwoFull.join("/")}`);
    check("I5b", "projected race-morning TSB in the fresh band [0, +20]",
      p.meta.projectedRaceTsb >= 0 && p.meta.projectedRaceTsb <= 20,
      `TSB ${p.meta.projectedRaceTsb}`);
  }
}

// ——— I6/I7: durations and loads stay inside human bounds ———
{
  const p = gen({ raceDate: "2026-11-15", raceType: "ironman", daysPerWeek: 7 });
  if (!(p instanceof Error)) {
    const all = p.weeks.flatMap((w) => w.sessions).filter((s) => s.discipline !== "race");
    const durOk = all.every((s) =>
      s.durationHr >= 0.3 && s.durationHr <= (s.title.toLowerCase().includes("long ride") || s.title.toLowerCase().startsWith("long ride") ? 4.5 : s.discipline === "run" && s.title.toLowerCase().includes("long") ? 2.6 : 4.5));
    check("I6", "every session 20min–4.5h (run long ≤2.6h)", durOk);
    check("I7a", "every session carries ≥5 TSS", all.every((s) => s.tss >= 5));
    check("I7b", "every full week ≥3 sessions and ≥60 TSS",
      fullWeeks(p).every((w) => w.sessions.length >= 3 && w.targetTss >= 60));
  }
}

// ——— I8: session identity unique (status toggles key on date+title) ———
{
  const p = gen({ raceDate: "2026-10-18", raceType: "half-ironman", daysPerWeek: 7 });
  if (!(p instanceof Error)) {
    const keys = p.weeks.flatMap((w) => w.sessions).map((s) => s.date + "␟" + s.title);
    check("I8", "(date,title) unique across the plan", new Set(keys).size === keys.length);
  }
}

// ——— I9: numbers are finite and the plan survives JSON round-trip ———
{
  const p = gen({ raceDate: "2026-10-18", raceType: "olympic" });
  if (!(p instanceof Error)) {
    const clone = JSON.parse(JSON.stringify(p)) as Plan;
    const nums = clone.weeks.flatMap((w) => [w.targetTss, w.projected.ctl, w.projected.tsb,
      ...w.sessions.flatMap((s) => [s.tss, s.durationHr])]);
    check("I9", "all plan numbers finite after JSON round-trip", nums.every(Number.isFinite));
  }
}

console.log(`\nTaper plan invariants · state CTL ${Math.round(state.ctl)} (${existsSync("data") ? "real corpus" : "synthetic"})\n`);
for (const l of [...passes, ...failures].sort()) console.log("  " + l);
console.log(`\n${passes.length} pass, ${failures.length} fail`);
process.exit(failures.length);
