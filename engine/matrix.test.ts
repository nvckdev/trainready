import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePlan, type Plan, type PlanRequest, type RaceType } from "./plan.ts";
import { deriveZones } from "./zones.ts";
import type { AthleteState, Zone } from "./types.ts";
import { targetDistribution, weekDistribution } from "./intensity.ts";
import { easyKmhFor, qualityKmhFor, LONG_FRACTION_MAX } from "./goal.ts";
import { sessionRunKm, weekRunKm } from "./volume.ts";
import { thresholdMpsFromZones } from "./zones.ts";
import { deriveBaseRichness, rampCapFromRichness } from "./history.ts";
import { fitPriorFromExamples } from "./learned.ts";
import { declareTissue } from "./tissue.ts";
import { applyReadinessSwap, planReadinessSwap, qualityAdjacencyCost } from "./readiness.ts";
import { recomputeRemaining, type WeekActual } from "./replan.ts";

/**
 * The synthetic-athlete matrix (audit Part 2's recommended harness).
 *
 * The pinned backtest referees single-athlete weekly PREDICTION; the
 * construction path — generatePlan and the six per-athlete refinements — was
 * guarded only by fixture tests spanning two athletes' worth of parameter
 * space, plus invariants.ts at one configuration production never serves.
 * This file generates full plans across a grid of athletes and asserts the
 * structural invariants on EVERY one, runs a slice in the production
 * configuration (prior + goal + tissue + tune-up threaded simultaneously),
 * pins one dashboard-vs-mobile call-shape parity case, and freezes
 * construction behavior with golden structural digests.
 *
 * Digest = per week: weekStart|phase|targetTss + each session's
 * discipline:tss. Deliberately NOT full JSON — titles, copy, workout text,
 * and meta can change without churn; load structure cannot.
 *
 * Regenerate goldens after an INTENTIONAL construction change:
 *   TAPER_MATRIX_UPDATE=1 npx tsx engine/matrix.test.ts
 *
 * KNOWN DEFECTS: a check listed in KNOWN_DEFECTS that fails prints as CAUGHT
 * and does not fail the suite — but if it ever PASSES, the suite fails until
 * the ledger entry is removed. The ledger cannot rot silently in either
 * direction.
 */

const failures: string[] = [];
const passes: string[] = [];
const caught: string[] = [];

/**
 * Defects the matrix catches TODAY, held for explicit scoping rather than
 * fixed as a side effect of adding the harness. Each carries a BOUND: a
 * violation inside the bound is the known defect (reported as CAUGHT, does
 * not fail); anything WORSE is a new regression and fails loudly. If a class
 * stops occurring entirely, the suite fails until its entry is removed — the
 * ledger cannot rot in either direction.
 */
const KNOWN_DEFECTS: Record<string, string> = {
};

/** Occurrence tally per known class — a class that never fires means the
 *  defect was fixed and its ledger entry must go. */
const knownHits: Record<string, { cells: number; worst: string }> = {};


function check(id: string, desc: string, ok: boolean, detail = "") {
  const known = Object.keys(KNOWN_DEFECTS).find((k) => id.startsWith(k));
  if (known && !ok) {
    caught.push(`${id} CAUGHT — ${desc}${detail ? ` (${detail})` : ""}`);
    return;
  }
  if (known && ok) {
    failures.push(`${id} FAIL — listed as a known defect but now PASSES; remove it from KNOWN_DEFECTS`);
    return;
  }
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

// ——— grid ————————————————————————————————————————————————————————————————

const START = "2026-01-05"; // Monday, fixed for determinism
const PACES = [180, 225, 270, 330]; // sec/km threshold: 3:00, 3:45, 4:30, 5:30
const CTLS = [20, 45, 70, 90];
const HISTORIES = ["none", "sparse", "rich"] as const;
const RACES: Array<{ type: RaceType; date: string; km: number; weeks: number }> = [
  { type: "run-10k", date: "2026-03-15", km: 10, weeks: 10 },
  { type: "run-half", date: "2026-04-12", km: 21.0975, weeks: 14 },
  { type: "run-marathon", date: "2026-05-10", km: 42.195, weeks: 18 },
];
const GOALS = ["ambitious", "modest", "none"] as const;

const fmtPace = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function fmtGoal(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Race goal from threshold pace: race pace ≈ threshold × distance factor,
 *  modest 15% slower than ambitious. Always ≥140 s/km (plausibility guard). */
function goalTime(paceSec: number, km: number, goal: "ambitious" | "modest"): string {
  const factor = km <= 10 ? 0.99 : km <= 22 ? 1.05 : 1.13;
  const perKm = paceSec * factor * (goal === "modest" ? 1.15 : 1);
  return fmtGoal(perKm * km);
}

function athleteState(ctl: number): AthleteState {
  const w = Math.round(ctl * 7);
  return {
    ctl,
    atl: ctl,
    tsb: 0,
    last4WeeksTss: [Math.round(w * 0.95), w, Math.round(w * 0.98), Math.round(w * 1.02)],
    last4Shares: { swim: 0, bike: 0.1, run: 0.9 },
    daysToNextRace: null,
    weeksSinceStart: 30,
    breakRatio: 1,
    daysSinceLastSession: 1,
  };
}

/** Consecutive Mondays ending the week before START. Rich histories carry a
 *  higher historical peak (a returning athlete with reclaimable base). */
function makeHistory(kind: (typeof HISTORIES)[number], ctl: number) {
  const weeks = kind === "none" ? 0 : kind === "sparse" ? 8 : 120;
  const out: Array<{ state: AthleteState; actualTss: number; weekStart: string }> = [];
  const startMs = Date.parse(START + "T12:00:00Z");
  for (let i = weeks; i >= 1; i--) {
    const weekStart = new Date(startMs - i * 7 * 86400000).toISOString().slice(0, 10);
    // Rich history: an older peak ~30% above today's CTL, decaying toward it —
    // deterministic, no randomness (byte-stable goldens).
    const histCtl =
      kind === "rich" ? Math.round(ctl * (1.3 - (0.3 * (weeks - i)) / weeks) * 10) / 10 : ctl;
    out.push({ state: athleteState(histCtl), actualTss: Math.round(histCtl * 7), weekStart });
  }
  return out;
}

interface Case {
  id: string;
  paceSec: number;
  ctl: number;
  history: (typeof HISTORIES)[number];
  race: (typeof RACES)[number];
  goal: (typeof GOALS)[number];
}

const CASES: Case[] = [];
for (const paceSec of PACES)
  for (const ctl of CTLS)
    for (const history of HISTORIES)
      for (const race of RACES)
        for (const goal of GOALS)
          CASES.push({
            id: `${fmtPace(paceSec)}|ctl${ctl}|${history}|${race.type}|${goal}`,
            paceSec,
            ctl,
            history,
            race,
            goal,
          });

// ——— per-plan structural invariants ————————————————————————————————————————

const digest = (p: Plan) =>
  createHash("sha256")
    .update(
      p.weeks
        .map(
          (w) =>
            `${w.weekStart}|${w.phase}|${w.targetTss}|` +
            w.sessions
              .map((s) => `${s.discipline}:${s.tss}`)
              .sort()
              .join(",")
        )
        .join(";")
    )
    .digest("hex")
    .slice(0, 12);

interface CellResult {
  requiredPeakCtl: number | null;
}

function assertStructure(c: Case, plan: Plan, zones: ReturnType<typeof deriveZones>, tag = ""): CellResult {
  const id = (k: string) => `${k}${tag}[${c.id}]`;
  const violations: string[] = [];
  // Violations of a KNOWN class within its bound — the cell reports as caught
  // rather than failed; outside the bound it is a new regression and fails.
  const knownViolations: string[] = [];
  const full = plan.weeks.slice(0, -1); // last week is race week

  // Schedule sanity (invariants I1/I2 generalized to every athlete).
  const all = plan.weeks.flatMap((w) => w.sessions);
  if (!all.every((s) => s.date <= c.race.date)) violations.push("session after race day");
  if (all.filter((s) => s.discipline === "race" && !s.tuneup).length !== 1) violations.push("race count ≠ 1");
  const worstDays = Math.max(...full.map((w) => new Set(w.sessions.map((s) => s.date)).size), 0);
  if (worstDays > 6) violations.push(`daysPerWeek cap broken (${worstDays})`);

  // Ramp rail: adjacent base/build growth never exceeds the 1.30 hard max.
  for (let i = 1; i < full.length; i++) {
    const prev = full[i - 1];
    const next = full[i];
    const buildish = (ph: string) => ph === "base" || ph === "build";
    if (buildish(prev.phase) && buildish(next.phase) && prev.targetTss >= 60) {
      if (next.targetTss > prev.targetTss * 1.302 + 1) {
        violations.push(`ramp ${prev.weekStart} ${prev.targetTss}→${next.targetTss}`);
      }
    }
  }

  // Intensity floor (refinement 1, polarized.test tolerances): base/build run
  // weeks land within ±3% of the phase Z1 target and never under the 0.85
  // floor. Tune-up weeks are exempt from the target band: their slot weights
  // renormalize around the B-race and the remainder is deliberately all-easy.
  for (const w of full) {
    if (w.phase !== "base" && w.phase !== "build") continue;
    if (w.sessions.some((s) => s.discipline === "race" && s.tuneup)) continue;
    const d = weekDistribution(w.sessions);
    if (d.totalSec <= 0) continue;
    const t = targetDistribution(w.phase).z1;
    const msg = `z1 ${w.weekStart} ${(d.z1Pct * 100).toFixed(1)}% action=${w.z1FloorAction ?? "none"}`;
    // The contract after the floor fix: within the ±3% band, OR at/above the
    // floor with the over-band demotion SURFACED (the rail outranks the
    // band on duration-floored micro-weeks), OR explicitly surfaced as
    // unreachable. A silent breach in either direction fails.
    const withinBand = Math.abs(d.z1Pct - t) <= 0.031;
    const demotedOk = d.z1Pct >= 0.85 - 1e-9 && w.z1FloorAction === "demoted-quality";
    const surfacedUnreachable = d.z1Pct < 0.85 - 1e-9 && w.z1FloorAction === "unreachable";
    if (!(withinBand || demotedOk || surfacedUnreachable)) violations.push(msg);
    if (withinBand && d.z1Pct < 0.85 - 1e-9) violations.push(msg + " (band met but floor broken)");
  }

  // Long-run fraction (refinement 5, fraction.test tolerance) at the
  // athlete's own measurement speeds.
  const vT = thresholdMpsFromZones(zones);
  const easy = easyKmhFor(vT);
  const qual = qualityKmhFor(vT);
  for (const w of full) {
    const long = w.sessions.find((s) => s.discipline === "run" && /long/i.test(s.title));
    if (!long) continue;
    const longKm = sessionRunKm(long, easy, qual);
    const weekKm = weekRunKm(w.sessions, easy, qual);
    // No slack: the rail is enforced post-construction against these exact
    // functions, so any excess at all is a real breach.
    if (longKm > LONG_FRACTION_MAX * weekKm + 1e-6) {
      violations.push(`long ${w.weekStart} ${longKm.toFixed(1)}/${weekKm.toFixed(1)}km = ${((longKm / weekKm) * 100).toFixed(1)}%`);
    }
  }

  // Week-1 floor never exceeds demonstrated capacity (refinement 6):
  // capacity = max(maintenance, best recent week) × 1.15.
  if (full.length) {
    const capacity = Math.max(c.ctl * 7, ...athleteState(c.ctl).last4WeeksTss) * 1.15 + 6;
    if (full[0].targetTss > capacity) {
      violations.push(`week1 ${full[0].targetTss} > capacity ${capacity.toFixed(0)}`);
    }
  }

  // The taper tapers: the final full week is never the plan's peak.
  if (full.length >= 3) {
    const peak = Math.max(...full.map((w) => w.targetTss));
    if (full[full.length - 1].targetTss >= peak && peak > 60) violations.push("no taper");
  }

  // Goal gap: whenever a goal parsed, requiredPeakCtl is real (E4's floor).
  let requiredPeakCtl: number | null = null;
  if (c.goal !== "none") {
    const gap = plan.meta.goalGap;
    if (!gap || !(gap.requiredPeakCtl > 0)) violations.push(`goalGap ${gap ? gap.requiredPeakCtl : "absent"}`);
    else requiredPeakCtl = gap.requiredPeakCtl;
  }

  check(id("S"), "structural invariants", violations.length === 0, violations.slice(0, 3).join("; "));
  if (violations.length === 0 && knownViolations.length > 0) {
    // Not a pass — a cell held only by the known-defect bounds.
    caught.push(`S${tag}[${c.id}] CAUGHT — ${knownViolations.slice(0, 2).join("; ")}`);
  }
  return { requiredPeakCtl };
}

// ——— run the grid ————————————————————————————————————————————————————————

const t0 = Date.now();
const digests: Record<string, string> = {};
const results = new Map<string, CellResult>();
/** Generated plans, retained so later sweeps (readiness, damp) can re-derive
 *  from the same grid rather than regenerating it. */
const plans = new Map<string, Plan>();
/** The request each plan came from — the damp sweep reflows through it. */
const requests = new Map<string, PlanRequest>();
type PlanWeekSession = Plan["weeks"][number]["sessions"][number];

/** The zones a grid cell's athlete has — one definition, used by generation
 *  and by every sweep that follows. */
const zonesFor = (c: Case) =>
  deriveZones({ ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: 1000 / c.paceSec, swimCssMps: 1.1 });
let generated = 0;
let thrown = 0;

for (const c of CASES) {
  const zones = zonesFor(c);
  const req: PlanRequest = {
    raceName: "Matrix race",
    raceDate: c.race.date,
    raceType: c.race.type,
    daysPerWeek: 6,
    longDay: "sunday",
    startDate: START,
    ...(c.goal !== "none" ? { goalTime: goalTime(c.paceSec, c.race.km, c.goal) } : {}),
  };
  try {
    const plan = generatePlan(req, athleteState(c.ctl), makeHistory(c.history, c.ctl), zones);
    generated++;
    results.set(c.id, assertStructure(c, plan, zones));
    plans.set(c.id, plan);
    requests.set(c.id, req);
    digests[c.id] = digest(plan);
  } catch (e) {
    thrown++;
    check(`G[${c.id}]`, "generates without throwing", false, e instanceof Error ? e.message : String(e));
  }
}
check("G0", `all ${CASES.length} grid cells generate`, thrown === 0, `${thrown} threw`);

// ——— monotonicities ———————————————————————————————————————————————————————

// M1 — the base-richness inversion (KNOWN DEFECT, held for scoping): learning
// a little must never LOWER the allowed ramp below the ignorance default.
{
  const defaultCap = 1.2; // what an empty history yields (learned.ts rampCapFor default)
  const bad: string[] = [];
  // Every history length, both profiles (flat, and returning-with-reclaimable-
  // base): the derived cap must never fall below the ignorance default, and
  // must be monotone non-decreasing in history depth for a fixed profile.
  for (const reclaim of [false, true]) {
    let prev = defaultCap;
    for (const weeks of [0, 4, 8, 16, 26, 52, 104, 156]) {
      const hist = Array.from({ length: weeks }, (_, i) => ({
        state: athleteState(reclaim ? 60 : 45),
        weekStart: new Date(Date.parse(START + "T12:00:00Z") - (weeks - i) * 7 * 86400000)
          .toISOString()
          .slice(0, 10),
      }));
      const r = deriveBaseRichness(hist, 45);
      const cap = r ? rampCapFromRichness(r.richness) : defaultCap;
      if (cap < defaultCap - 1e-9) bad.push(`${reclaim ? "reclaim" : "flat"}:${weeks}wk→${cap.toFixed(3)}`);
      if (cap < prev - 1e-9) bad.push(`${reclaim ? "reclaim" : "flat"}:${weeks}wk non-monotone`);
      prev = cap;
    }
  }
  check("M1", "rampCap(history) ≥ rampCap(none) for every history level, monotone in depth",
    bad.length === 0, bad.join(", "));
}

// M2 — an ambitious goal always requires more peak CTL than a modest one.
{
  const bad: string[] = [];
  for (const c of CASES) {
    if (c.goal !== "ambitious") continue;
    const modest = results.get(c.id.replace("|ambitious", "|modest"));
    const amb = results.get(c.id);
    if (amb?.requiredPeakCtl != null && modest?.requiredPeakCtl != null) {
      // At 5:30/km both goals imply < MIN_GOAL_WEEKLY_KM and clamp to the
      // same E4 volume floor — equality is the floor working, not a bug.
      // Everywhere above the floor the ordering must be STRICT.
      const strict = c.paceSec <= 270;
      const ok = strict
        ? amb.requiredPeakCtl > modest.requiredPeakCtl
        : amb.requiredPeakCtl >= modest.requiredPeakCtl;
      if (!ok) bad.push(`${c.id}: ${amb.requiredPeakCtl} vs ${modest.requiredPeakCtl}`);
    }
  }
  check("M2", "ambitious ≥ modest requiredPeakCtl, strict above the E4 volume floor", bad.length === 0,
    bad.slice(0, 3).join("; "));
}

// M3 — E4 at plan level: a slower athlete's km cost more, so the same-shape
// goal (same multiple of their own threshold) never requires LESS weekly
// load per km. requiredPeakCtl is priced via cvol·wKm; compare across the
// pace axis with everything else fixed.
{
  const bad: string[] = [];
  for (const c of CASES) {
    if (c.goal === "none" || c.paceSec === PACES[0]) continue;
    const fasterId = c.id.replace(fmtPace(c.paceSec), fmtPace(PACES[PACES.indexOf(c.paceSec) - 1]));
    const slower = results.get(c.id);
    const faster = results.get(fasterId);
    if (slower?.requiredPeakCtl != null && faster?.requiredPeakCtl != null) {
      // Same relative goal, higher km cost, but LOWER VDOT-implied km need —
      // the two move oppositely, so only assert the E4 term keeps the result
      // strictly positive and finite; strict cross-pace ordering is not a
      // documented invariant. Positivity per cell is already asserted; here
      // pin that no slower athlete gets a ~zero requirement (the pre-E4
      // degeneracy resurfacing).
      if (slower.requiredPeakCtl < 5) bad.push(`${c.id}: ${slower.requiredPeakCtl}`);
    }
  }
  check("M3", "no athlete's parsed goal collapses to a ~zero CTL requirement (E4 degeneracy stays dead)",
    bad.length === 0, bad.slice(0, 3).join("; "));
}

// ——— production configuration (the slice invariants.ts never served) ————————

{
  const paceSec = 270;
  const zones = deriveZones({ ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: 1000 / paceSec, swimCssMps: 1.1 });
  const history = makeHistory("rich", 55);
  // An authentic prior: fit on the synthetic population itself.
  const prior = fitPriorFromExamples(history.map((h) => ({ state: h.state, actualTss: h.actualTss })));
  let prodViolations = 0;
  for (const ctl of [45, 70]) {
    for (const race of [RACES[1], RACES[2]]) {
      for (const goal of ["ambitious", "modest"] as const) {
        const c: Case = { id: `PROD|ctl${ctl}|${race.type}|${goal}`, paceSec, ctl, history: "rich", race, goal };
        const tuneupDate = "2026-02-22"; // Sunday, ≥3 weeks in, outside the taper
        const req: PlanRequest = {
          raceName: "Prod race",
          raceDate: race.date,
          raceType: race.type,
          daysPerWeek: 6,
          longDay: "sunday",
          startDate: START,
          goalTime: goalTime(paceSec, race.km, goal),
          priorWeights: prior,
          tissueConstraints: [declareTissue("calf", "tendinopathy", "impact")],
          tuneups: [{ date: tuneupDate, raceType: "run-10k", name: "Tune-up 10k" }],
          eras: [{ span: "2024-2026", startMonth: "2024-01", endMonth: null, weight: 2 }],
        };
        try {
          const plan = generatePlan(req, athleteState(ctl), makeHistory("rich", ctl), zones);
          const before = failures.length;
          assertStructure(c, plan, zones, ":prod");
          if (failures.length > before) prodViolations++;
          const tuneup = plan.weeks.flatMap((w) => w.sessions).find((s) => s.discipline === "race" && s.tuneup);
          check(`P-tuneup[${c.id}]`, "tune-up race lands on its date",
            !!tuneup && tuneup.date === tuneupDate, tuneup?.date ?? "absent");
          digests[c.id] = digest(plan);
        } catch (e) {
          check(`P-gen[${c.id}]`, "production config generates", false, e instanceof Error ? e.message : String(e));
        }
      }
    }
  }
  check("P0", "production configuration (prior+goal+tissue+tune-up+eras simultaneously) holds every invariant",
    prodViolations === 0, `${prodViolations} cells violated`);
}

// ——— dashboard-shape vs mobile-shape parity ————————————————————————————————

{
  const zones = deriveZones({ ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: 1000 / 270, swimCssMps: 1.1 });
  const state = athleteState(50);
  const prior = fitPriorFromExamples(makeHistory("sparse", 50).map((h) => ({ state: h.state, actualTss: h.actualTss })));
  const base: PlanRequest = {
    raceName: "Parity race",
    raceDate: "2026-04-12",
    raceType: "run-half",
    daysPerWeek: 6,
    longDay: "sunday",
    startDate: START,
    goalTime: "1:39:00",
    priorWeights: prior,
  };
  // Mobile idiom: minimal fields absent. Dashboard idiom: the same inputs
  // spelled out (empty history, no eras, no anchors, no tissue).
  const mobile = generatePlan(base, state, [], zones);
  const dashboard = generatePlan(
    { ...base, eras: undefined, raceAnchors: [], tissueConstraints: [], tuneups: [] },
    state,
    [],
    zones
  );
  const strip = (p: Plan) => {
    const q = JSON.parse(JSON.stringify(p)) as Plan;
    delete (q.meta as Record<string, unknown>).generatedAt;
    return JSON.stringify(q);
  };
  check("PAR", "identical inputs through the two surfaces' call idioms ⇒ byte-identical plans",
    strip(mobile) === strip(dashboard),
    strip(mobile) === strip(dashboard) ? "" : `mobile ${digest(mobile)} vs dashboard ${digest(dashboard)}`);
}


// ——— R. readiness swaps hold every rail, on every athlete in the grid ————————
// Placement-only is a claim about EVERY plan, not the fixtures: sweep a
// readiness tap across each grid cell's weeks and levels and assert it can
// never change weekly load, never breach a rail, and never fire inside the
// taper lock.
{
  const bad: string[] = [];
  let swapsFound = 0;
  let tapsTried = 0;
  for (const c of CASES) {
    const plan = plans.get(c.id);
    if (!plan) continue;
    const zones = zonesFor(c);
    for (const w of plan.weeks) {
      // One tap per session-day in the week, at every level.
      for (const level of ["rough", "ok", "good"] as const) {
        for (const s of w.sessions) {
          tapsTried++;
          // planReadinessSwap is pure, so it can be asked about the real plan;
          // only a swap that actually exists is worth cloning for.
          const swap = planReadinessSwap({
            weeks: plan.weeks,
            today: s.date,
            raceDate: c.race.date,
            level,
          });
          if (!swap) continue;
          swapsFound++;
          const weeksCopy: Plan["weeks"] = JSON.parse(JSON.stringify(plan.weeks));
          const tssBefore = plan.weeks.map((x) => x.sessions.reduce((a, y) => a + y.tss, 0));
          // Taper lock — the hardest exclusion.
          const daysOut = Math.round((Date.parse(c.race.date + "T12:00:00Z") - Date.parse(s.date + "T12:00:00Z")) / 86400000);
          if (daysOut <= 21) bad.push(`${c.id}: fired ${daysOut}d out`);
          applyReadinessSwap(weeksCopy, swap);
          // Weekly TSS, every week, unchanged.
          const tssAfter = weeksCopy.map((x) => x.sessions.reduce((a, y) => a + y.tss, 0));
          if (JSON.stringify(tssAfter) !== JSON.stringify(tssBefore)) {
            bad.push(`${c.id}: weekly TSS moved on ${s.date}`);
          }
          // Session content is untouched — only dates may differ.
          const bag = (ws: Plan["weeks"]) =>
            JSON.stringify(ws.flatMap((x) => x.sessions.map((y) => `${y.title}|${y.tss}|${y.durationHr}`)).sort());
          if (bag(weeksCopy) !== bag(plan.weeks)) bad.push(`${c.id}: session content changed on ${s.date}`);
          // The long run never moved.
          const longs = (ws: Plan["weeks"]) =>
            JSON.stringify(ws.flatMap((x) => x.sessions.filter((y) => /long/i.test(y.title)).map((y) => y.date)));
          if (longs(weeksCopy) !== longs(plan.weeks)) bad.push(`${c.id}: long run moved on ${s.date}`);
          // Structural crowding never worsened, per week.
          for (let i = 0; i < weeksCopy.length; i++) {
            if (qualityAdjacencyCost(weeksCopy[i].sessions) > qualityAdjacencyCost(plan.weeks[i].sessions)) {
              bad.push(`${c.id}: adjacency worsened wk${i}`);
            }
          }
          // And the plan still satisfies every structural invariant.
          const before = failures.length;
          assertStructure(c, { ...plan, weeks: weeksCopy }, zones, ":readiness");
          if (failures.length > before) bad.push(`${c.id}: rail broken on ${s.date}`);
        }
      }
    }
  }
  check("R1", `readiness swaps never change load, content, the long run or a rail (${swapsFound} swaps across ${tapsTried} taps)`,
    bad.length === 0, bad.slice(0, 3).join("; "));
  check("R2", "the sweep actually exercised the mechanism (not vacuously green)",
    swapsFound > 200, `${swapsFound} swaps`);
}

// ——— FS. a FRESH session describes itself honestly ——————————————————————————
// The same rule as DS1, one layer up: declared duration and structured content
// are one quantity measured two ways, so they must agree at CONSTRUCTION and
// not merely survive a damp. Before this, six templates could not express
// their own declared duration — bike-vo2 built a fixed 47 minutes whatever it
// was handed, bike-long added its tempo set on top of a ride that already
// spanned the duration, and run-tempo's 15-minute work floor overran a
// 25-minute slot by a quarter. See engine/session-fit.ts.

/** Seconds a block occupies on the clock — reps and inter-rep recovery in. */
const blockSec = (b: { reps?: number; durationSec?: number; recoverySec?: number }) => {
  const reps = b.reps ?? 1;
  return (b.durationSec ?? 0) * reps + (b.recoverySec ?? 0) * Math.max(0, reps - 1);
};
/** The duration the session STATES, in whole seconds. durationHr is stored to
 *  2dp and 3600 × 0.01 is an integer, so this is exact — but the float product
 *  is not (1.11 × 3600 is 3996.0000000000005), which is why the comparison is
 *  made in integer seconds rather than as a ratio. */
const declaredSec = (s: PlanWeekSession) => Math.round(s.durationHr * 3600);
/**
 * The seconds a session's structure actually accounts for, or null when it has
 * none to account for.
 *
 * A session counts as time-defined only if some block carries a durationSec.
 * The swim templates are DISTANCE-defined by design — swimmers train in metres
 * and a Block cannot imply seconds without the athlete's pace — so they state
 * no structured time to disagree with. Note this must test for durationSec
 * specifically and not merely a non-zero total: a CSS swim set's rest periods
 * sum to 4.5 minutes, which would otherwise read as a 24-minute session
 * structured at 0.19x.
 */
const structuredSec = (s: PlanWeekSession): number | null => {
  if (s.discipline === "race") return null;
  const blocks = s.workout?.blocks ?? [];
  if (!blocks.some((b) => b.durationSec) || !(s.durationHr > 0)) return null;
  return blocks.reduce((a, b) => a + blockSec(b), 0);
};
/** The duration a title states, when it states one. Mirrors retitle's pattern:
 *  the LAST standalone number, which may be hours ("Long ride 1.5h"). */
const TITLE_DURATION = /(?<![A-Za-z\d.])(\d+(?:\.\d+)?)(h?)(?=\D*$)/;

{
  const bad: string[] = [];
  let checked = 0;
  let timeDefined = 0;
  for (const c of CASES) {
    const plan = plans.get(c.id);
    if (!plan) continue;
    for (const w of plan.weeks) {
      for (const s of w.sessions) {
        const sec = structuredSec(s);
        if (sec === null) continue;
        timeDefined++;
        // Zero tolerance, in whole seconds: the blocks are budgeted FROM the
        // stored duration, so anything other than equality is a template that
        // cannot express what it was asked for.
        if (sec !== declaredSec(s)) {
          bad.push(`${c.id}: "${s.title}" declares ${declaredSec(s)}s, structures ${sec}s`);
        }
        const m = TITLE_DURATION.exec(s.title);
        if (m && !m[2]) {
          checked++;
          const want = Math.max(1, Math.round(s.durationHr * 60));
          if (Number(m[1]) !== want) bad.push(`${c.id}: "${s.title}" on a ${want}-minute session`);
        }
      }
    }
  }
  check("FS1", `a fresh session's structure and title match its declared duration exactly (${timeDefined} time-defined, ${checked} titled)`,
    bad.length === 0, bad.slice(0, 3).join("; "));
  check("FS2", "the sweep actually saw structured sessions (not vacuously green)",
    timeDefined > 2000, `${timeDefined} time-defined`);
}

// ——— DS. a damped session still describes itself honestly ————————————————————
// scaleWeek rescales tss and durationHr. Until 2026-08-05 it stopped there, so
// title, structure and workout.blocks kept describing the session as first
// built — "Long run 115" scheduled as 22 minutes, a ~5x contradiction live on
// the Today screen that disqualified 36 of 65 stored sessions from watch
// export. One quantity, one ruler.
//
// The control is the SAME reflow with a clean ledger, so nothing damps. That
// isolates the damp's contribution: both runs generate identical remaining
// weeks, and only the shaping differs. Comparing against the ORIGINAL plan
// would be the wrong ruler — a reflow regenerates shorter sessions, and
// run-tempo floors its work segment at 15 minutes, so a 21-minute tempo
// structures at 1.29x before anything is damped. That is a real defect (see
// the report) but it is generation's, and charging it to the damp would hide
// whether the damp itself is honest.
{
  const bad: string[] = [];
  let damped = 0;
  let sessionsChecked = 0;
  /** How far a session's structure disagrees with its own stated duration. */
  const drift = (s: PlanWeekSession): number | null => {
    const sec = structuredSec(s);
    if (sec === null) return null;
    return Math.abs(sec / declaredSec(s) - 1);
  };
  const worstDrift = (weeks: Plan["weeks"]) =>
    Math.max(0, ...weeks.flatMap((w) => w.sessions.map(drift).filter((x): x is number => x !== null)));

  for (const c of CASES) {
    const plan = plans.get(c.id);
    if (!plan || plan.weeks.length < 5) continue;
    const led = (i: number, tss: number): WeekActual => ({
      weekStart: plan.weeks[i].weekStart,
      actualTss: Math.round(tss),
      plannedTss: plan.weeks[i].targetTss,
      rampCapTss: Math.round(plan.weeks[i].targetTss),
      sessionsMissed: 0,
      sessionsPlanned: plan.weeks[i].sessions.length,
    });
    const reflow = (lastWeekTss: number) =>
      recomputeRemaining({
        stored: { request: requests.get(c.id)!, plan },
        actualState: athleteState(c.ctl),
        actualTrailingTss: [c.ctl * 7, c.ctl * 7, c.ctl * 7],
        ledger: [led(0, plan.weeks[0].targetTss), led(1, plan.weeks[1].targetTss), led(2, lastWeekTss)],
        asOf: plan.weeks[3].weekStart,
        history: makeHistory(c.history, c.ctl),
        zones: zonesFor(c),
      });
    let hot, control;
    try {
      // Rule 2: the last completed week ran far over its ramp ceiling, forcing
      // the first remaining week down to maintenance — the damp. The control
      // runs the same week exactly on plan, so no rule fires.
      hot = reflow(plan.weeks[2].targetTss * 1.6);
      control = reflow(plan.weeks[2].targetTss);
    } catch (e) {
      bad.push(`${c.id}: reflow threw — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!hot.forcedRecoveryWeek || control.forcedRecoveryWeek) continue;
    damped++;

    // A session counts as damped only when its duration actually MOVED against
    // the control. A forced-recovery week whose target already sits under
    // maintenance never reaches scaleWeek, and its untouched titles carry
    // generation's own +/-2.4 min from mins() rounding to the nearest 5 —
    // charging that to the damp would make this check fail for the wrong
    // reason and stop meaning anything.
    const week = hot.plan.weeks.find((w) => w.weekStart === hot.forcedRecoveryWeek);
    const ctrlWeek = control.plan.weeks.find((w) => w.weekStart === hot.forcedRecoveryWeek);
    if (week && ctrlWeek && week.sessions.length === ctrlWeek.sessions.length) {
      for (let i = 0; i < week.sessions.length; i++) {
        const s = week.sessions[i];
        const undamped = ctrlWeek.sessions[i];
        if (s.discipline === "race" || s.date !== undamped.date) continue;
        if (s.durationHr === undamped.durationHr) continue;
        sessionsChecked++;
        // Zero tolerance: retitle derives the number from durationHr, so any
        // gap here is a description left behind by the rescale.
        const m = s.title.match(/\b\d+\b/);
        if (m) {
          const want = Math.max(1, Math.round(s.durationHr * 60));
          if (Number(m[0]) !== want) bad.push(`${c.id}: "${s.title}" on a ${want}-minute session`);
        }
        // And the structure moved with it rather than describing the original.
        const blocks = s.workout?.blocks ?? [];
        const wasBlocks = undamped.workout?.blocks ?? [];
        if (blocks.length && blocks.length === wasBlocks.length) {
          const now = blocks.reduce((a, b) => a + blockSec(b), 0);
          const was = wasBlocks.reduce((a, b) => a + blockSec(b), 0);
          if (now === was) bad.push(`${c.id}: "${s.title}" structure unchanged while duration moved`);
        }
      }
    }
    // And the damp leaves no session less honest than the undamped reflow.
    // Proportional scaling preserves the structure-to-duration ratio exactly;
    // the allowance is for durationHr's 2dp storage (36-second granularity) and
    // per-block whole-second rounding. Pre-fix a damped long run sat at ~5x.
    const after = worstDrift(hot.plan.weeks);
    const before = worstDrift(control.plan.weeks);
    if (after > before + 0.02) {
      bad.push(`${c.id}: damped drift ${(after * 100).toFixed(0)}% > undamped ${(before * 100).toFixed(0)}%`);
    }
  }
  check("DS1", `a damped session's title, structure and durationHr agree (${sessionsChecked} sessions across ${damped} damped cells)`,
    bad.length === 0, bad.slice(0, 3).join("; "));
  check("DS2", "the sweep actually damped weeks (not vacuously green)", damped > 100, `${damped} damped`);
}

// ——— TC. a declared constraint BINDS the caps it claims ————————————————————
// The tissue seam publishes caps and a "why it caps what it caps" sentence
// that the plan page renders. Nothing asserted that the plan then obeyed
// them: the production slice threaded one constraint and checked the generic
// invariants, so a cap could have been advertised to an injured athlete and
// quietly ignored. Each lever gets a constraint that pulls it, swept across
// the whole grid, measured with the ENGINE's own rulers (easyKmhFor /
// qualityKmhFor via sessionRunKm) rather than a second set.
{
  const vTFor = (c: Case) => thresholdMpsFromZones(zonesFor(c));
  const ZONE_ORDER: Zone[] = ["recovery", "easy", "tempo", "threshold", "cv", "vo2", "race"];
  const rank = (z: Zone) => ZONE_ORDER.indexOf(z);

  const bad: string[] = [];
  const rampOver: number[] = [];
  let bound = 0;
  let uncapped = 0;
  for (const c of CASES) {
    const zones = zonesFor(c);
    const easy = easyKmhFor(vTFor(c));
    const qual = qualityKmhFor(vTFor(c));
    const req = (tissueConstraints: ReturnType<typeof declareTissue>[]): PlanRequest => ({
      raceName: "Tissue race",
      raceDate: c.race.date,
      raceType: c.race.type,
      daysPerWeek: 6,
      longDay: "sunday",
      startDate: START,
      ...(c.goal !== "none" ? { goalTime: goalTime(c.paceSec, c.race.km, c.goal) } : {}),
      tissueConstraints,
    });
    const gen = (cs: ReturnType<typeof declareTissue>[]) =>
      generatePlan(req(cs), athleteState(c.ctl), makeHistory(c.history, c.ctl), zones);

    // NEUTRALITY (§12): no constraint and an EMPTY constraint list are the
    // same thing — a healthy athlete is never capped prophylactically, and
    // Fokkema found no volume/injury association to justify it if we wanted.
    // generatedAt is a wall clock, not construction: the repo's own idiom
    // (prior.test, tuneup.test, pmc.test) stabilises it before comparing.
    const stable = (x: Plan) => JSON.stringify({ ...x, meta: { ...x.meta, generatedAt: "-" } });
    if (stable(gen([])) !== stable(generatePlan(
      { ...req([]), tissueConstraints: undefined }, athleteState(c.ctl), makeHistory(c.history, c.ctl), zones))) {
      bad.push(`${c.id}: [] differs from absent`);
    }

    // volume-provoked → weekly km AND long-run km.
    {
      const t = declareTissue("shin", "acute", "volume");
      const plan = gen([t]);
      const training = plan.weeks.filter((w) => w.phase !== "race");
      for (const w of training) {
        const km = weekRunKm(w.sessions, easy, qual);
        if (t.caps.weeklyKm != null && km > t.caps.weeklyKm + 0.05) {
          bad.push(`${c.id}: week ${w.weekStart} runs ${km.toFixed(1)} km over a ${t.caps.weeklyKm} km cap`);
        }
        const long = w.sessions.find((x) => x.discipline === "run" && /long/i.test(x.title));
        const lkm = long ? sessionRunKm(long, easy, qual) : 0;
        if (t.caps.longRunKm != null && lkm > t.caps.longRunKm + 0.05) {
          bad.push(`${c.id}: long run ${lkm.toFixed(1)} km over a ${t.caps.longRunKm} km cap`);
        }
      }
      bound++;
    }

    // speed-provoked → an intensity ceiling. No block anywhere may sit above
    // it: the cap downgrades the SLOT, so a surviving vo2 block means the
    // downgrade did not reach the session that was actually built.
    {
      const t = declareTissue("hamstring", "acute", "speed");
      const ceiling = t.caps.maxSessionIntensity;
      if (ceiling == null) uncapped++;
      else {
        for (const w of gen([t]).weeks) {
          for (const x of w.sessions) {
            if (x.discipline !== "run") continue;
            for (const b of x.workout?.blocks ?? []) {
              if (rank(b.zone as Zone) > rank(ceiling)) {
                bad.push(`${c.id}: "${x.title}" carries ${b.zone} above a ${ceiling} ceiling`);
              }
            }
          }
        }
        bound++;
      }
    }

    // acute → a ramp ceiling, which must hold week over week where the ramp
    // is what governs (base/build). A recovery week or a taper falls, and a
    // ceiling only ever forbids RISING.
    {
      const t = declareTissue("calf", "acute", "impact");
      const ceiling = t.caps.rampCeiling;
      if (ceiling == null) uncapped++;
      else {
        const wks = gen([t]).weeks.filter((w) => w.phase === "base" || w.phase === "build");
        for (let i = 1; i < wks.length; i++) {
          const prev = wks[i - 1].targetTss;
          const next = wks[i].targetTss;
          // The weekly-60 floor is a rail of its own and outranks the ramp:
          // a week held at the floor is not the ramp choosing to rise.
          // targetTss is an integer, so a ceiling of ×1.05 on a 316 TSS week
          // lands at 331.8 and the plan stores 332 or 333. The allowance is
          // that rounding and nothing more: measured across the whole grid the
          // worst overshoot is 1.75 TSS (0.5% of a 330 TSS week), so 2 pins it
          // as a ratchet rather than a guess.
          if (prev >= 60 && next > prev * ceiling) {
            rampOver.push(next - prev * ceiling);
            if (next > prev * ceiling + 2) bad.push(`${c.id}: ramp ${prev}→${next} over a ×${ceiling} ceiling`);
          }
        }
        bound++;
      }
    }
  }
  check("TC1", `a declared constraint binds every cap it publishes (${bound} constrained plans across ${CASES.length} athletes; worst ramp rounding ${Math.max(0, ...rampOver).toFixed(2)} TSS)`,
    bad.length === 0, bad.slice(0, 3).join("; "));
  check("TC2", "every lever under test actually published a cap (no vacuous pass)",
    uncapped === 0 && bound === CASES.length * 3, `${uncapped} unpublished, ${bound} bound`);
}

// ——— golden digests ———————————————————————————————————————————————————————

const GOLDEN_PATH = "engine/matrix.golden.json";
{
  const update = process.env.TAPER_MATRIX_UPDATE === "1";
  if (!existsSync(GOLDEN_PATH) || update) {
    writeFileSync(GOLDEN_PATH, JSON.stringify(digests, null, 1) + "\n");
    check("D0", `golden digests ${update ? "regenerated" : "created"} (${Object.keys(digests).length} cases) — commit ${GOLDEN_PATH}`, true);
  } else {
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as Record<string, string>;
    const changed = Object.keys(digests).filter((k) => golden[k] !== digests[k]);
    const missing = Object.keys(digests).filter((k) => !(k in golden));
    const stale = Object.keys(golden).filter((k) => !(k in digests));
    check("D1", "construction behavior matches the golden digests",
      changed.length === 0 && missing.length === 0 && stale.length === 0,
      [
        changed.length ? `${changed.length} changed (${changed.slice(0, 5).join(", ")}…)` : "",
        missing.length ? `${missing.length} new` : "",
        stale.length ? `${stale.length} stale` : "",
        "intentional? TAPER_MATRIX_UPDATE=1 to regenerate",
      ].filter(Boolean).join(" | "));
  }
}

// ——— report ———————————————————————————————————————————————————————————————

// Ledger rot: every known class must still occur somewhere, or its entry is
// stale and must be deleted (the defect got fixed — celebrate by removing it).
for (const cls of Object.keys(KNOWN_DEFECTS)) {
  if (cls === "M1-ramp-inversion") continue; // asserted directly above
  check(`L[${cls}]`, "known-defect class still occurs (else remove from ledger)",
    (knownHits[cls]?.cells ?? 0) > 0, "0 occurrences — fixed?");
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nSynthetic-athlete matrix: ${CASES.length} grid cells + production slice + parity, ${elapsed}s\n`);
for (const f of failures) console.error("  " + f);
const cellCaught = caught.filter((k) => k.startsWith("S"));
for (const k of caught.filter((x) => !x.startsWith("S"))) console.log("  " + k);
for (const [cls, h] of Object.entries(knownHits)) {
  console.log(`  ${cls} CAUGHT — ${h.cells} weeks across ${cellCaught.length} cells, e.g. ${h.worst}`);
}
const structuralPasses = passes.filter((p) => !p.startsWith("S[")).length;
console.log(`  (${generated} plans generated; ${passes.length - structuralPasses} per-plan structural checks green)`);
for (const p of passes.filter((x) => !x.includes("["))) console.log("  " + p);
console.log(`\nmatrix: ${passes.length} passed, ${failures.length} failed, ${caught.length} known defects caught`);
process.exit(failures.length);
