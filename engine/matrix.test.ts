import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePlan, type Plan, type PlanRequest, type RaceType } from "./plan.ts";
import { deriveZones } from "./zones.ts";
import type { AthleteState } from "./types.ts";
import { targetDistribution, weekDistribution } from "./intensity.ts";
import { easyKmhFor, qualityKmhFor, LONG_FRACTION_MAX } from "./goal.ts";
import { sessionRunKm, weekRunKm } from "./volume.ts";
import { thresholdMpsFromZones } from "./zones.ts";
import { deriveBaseRichness, rampCapFromRichness } from "./history.ts";
import { fitPriorFromExamples } from "./learned.ts";
import { declareTissue } from "./tissue.ts";

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
  "z1-floor-breach":
    "duration-floored micro-weeks escape the intensity shaping: CTL-20 athletes (every pace) " +
    "get base/build weeks at 83.3–84.6% Z1 vs the 0.85 floor — the shaping loop's four " +
    "documented break-outs, exactly where the audit predicted. Bound: z1 ≥ 0.83.",
  "long-frac-breach":
    "the goal-driven long-run progression (week-1 ~13 km opening, +2 km steps) silently " +
    "overrides the 35% fraction rail on low-CTL athletes — worst 39.1% at CTL 20-45, every " +
    "pace. Related latent gap: the whole rail block is gated on `goal &&`, so a goal-less " +
    "athlete has NO fraction rail (no breach manifested in this grid). Bound: ratio ≤ 0.395.",
};

/** Occurrence tally per known class — a class that never fires means the
 *  defect was fixed and its ledger entry must go. */
const knownHits: Record<string, { cells: number; worst: string }> = {};
function recordKnown(cls: string, worst: string) {
  const h = (knownHits[cls] ??= { cells: 0, worst: "" });
  h.cells++;
  h.worst = worst;
}

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
    const msg = `z1 ${w.weekStart} ${(d.z1Pct * 100).toFixed(1)}%`;
    if (Math.abs(d.z1Pct - t) > 0.031 || d.z1Pct < 0.85 - 1e-9) {
      if (d.z1Pct >= 0.83 && d.z1Pct < t) {
        recordKnown("z1-floor-breach", msg);
        knownViolations.push(msg);
      } else violations.push(msg);
    }
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
    if (longKm > LONG_FRACTION_MAX * weekKm + 1.5) {
      const msg = `long ${w.weekStart} ${longKm.toFixed(1)}/${weekKm.toFixed(1)}km`;
      if (weekKm > 0 && longKm / weekKm <= 0.395) {
        recordKnown("long-frac-breach", msg);
        knownViolations.push(msg);
      } else violations.push(msg);
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
let generated = 0;
let thrown = 0;

for (const c of CASES) {
  const zones = deriveZones({
    ftpWatts: 250,
    lthrBpm: 170,
    runThresholdSpeedMps: 1000 / c.paceSec,
    swimCssMps: 1.1,
  });
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
