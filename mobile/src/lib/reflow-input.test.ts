import { buildMobileReflowInput, type MobileReflowSources } from "./reflow-input";
import type { Plan, PlanRequest } from "../../engine/plan.ts";
import type { ReconcileDecision } from "../../engine/reconcile.ts";
import type { SeededState } from "../../engine/seed.ts";
import { deriveZones } from "../../engine/zones.ts";
import { declareTissue } from "../../engine/tissue.ts";

/**
 * The phone's assembled reflow input, snapshot against fixed synthetic
 * sources — the mobile half of the wiring-test contract. See
 * src/lib/reflow-input.test.ts for the shape; the finding it closes was
 * mobile-first (tissueConstraints missing from this exact assembly, the
 * fitness state built without coverage).
 *
 * KILL-RUNS (verified once each before this file counted as a guard):
 *   - dropping `tissueConstraints: s.tissue.constraints` → M2b fails
 *   - dropping fill.partial from the ledger/trailing calls → M2c/M2d fail
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const zones = deriveZones({ ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: 1000 / 270, swimCssMps: 1.1 });

const request: PlanRequest = {
  raceName: "Mobile snapshot race",
  raceDate: "2026-03-15",
  raceType: "run-10k",
  daysPerWeek: 5,
  longDay: "sunday",
  startDate: "2026-01-05",
};

const plan = {
  weeks: [
    {
      weekStart: "2026-01-05",
      phase: "build",
      targetTss: 200,
      sessions: [
        { date: "2026-01-06", discipline: "run", tss: 100, status: "done" },
        { date: "2026-01-08", discipline: "run", tss: 100 },
      ],
    },
    {
      weekStart: "2026-01-12",
      phase: "build",
      targetTss: 210,
      sessions: [{ date: "2026-01-13", discipline: "run", tss: 210, status: "done" }],
    },
    {
      weekStart: "2026-01-19",
      phase: "build",
      targetTss: 220,
      sessions: [{ date: "2026-01-20", discipline: "run", tss: 220 }],
    },
  ],
  meta: {},
} as unknown as Plan;

const decision = {
  due: true,
  reason: "due",
  closedWeekStart: "2026-01-12",
  plannedTss: 210,
  executedTss: 210,
  deltaPct: 0,
  asOf: "2026-01-19",
} as ReconcileDecision;

const fill = {
  executed: new Map([
    ["2026-01-05", 100],
    ["2026-01-12", 210],
  ]),
  partial: new Set(["2026-01-05"]),
};

const constraint = declareTissue("shin", "acute", "volume", "after the 20k");
const state: SeededState = {
  ctl: 44, atl: 46, tsb: -2,
  last4WeeksTss: [200, 205, 210, 208],
  last4Shares: { swim: 0, bike: 0, run: 1 },
  daysToNextRace: null, weeksSinceStart: 8, breakRatio: 1, daysSinceLastSession: 1,
  anchorDate: "2026-01-17", zeroLoadDays: 1, evidencedDays: 12,
};
const sources: MobileReflowSources = {
  actualState: state,
  tissue: { constraints: [constraint], active: [], status: "ok" },
  priorWeights: { a: 3 } as unknown as PlanRequest["priorWeights"],
  zones,
};

// ——— M1. identity of pass-through fields ——————————————————————————————————
{
  const a = buildMobileReflowInput({ request, plan }, decision, fill, sources);
  check("M1a", "assembles ready on good sources", a.kind === "ready", a.kind);
  if (a.kind === "ready") {
    check("M1b", "actualState is THE coverage-aware state (identity)", a.input.actualState === sources.actualState);
    check("M1c", "zones is THE zones object (identity)", a.input.zones === sources.zones);
    check("M1d", "request.tissueConstraints is THE tissue read's list (identity)",
      a.request.tissueConstraints === sources.tissue.constraints);
    check("M1e", "the input's request is the assembled request", a.input.stored.request === a.request);
  }
}

// ——— M2. the snapshot ——————————————————————————————————————————————————————
{
  const a = buildMobileReflowInput({ request, plan }, decision, fill, sources);
  if (a.kind !== "ready") throw new Error("unreachable");

  check("M2a", "asOf is the decision's", a.input.asOf === "2026-01-19");
  const expectedRequest = {
    raceName: "Mobile snapshot race",
    raceDate: "2026-03-15",
    raceType: "run-10k",
    daysPerWeek: 5,
    longDay: "sunday",
    startDate: "2026-01-05",
    priorWeights: sources.priorWeights,
    tissueConstraints: [constraint],
  };
  check("M2b", "the request threads prior AND tissue — the field this surface silently dropped",
    JSON.stringify(a.request) === JSON.stringify(expectedRequest), JSON.stringify(a.request));
  check("M2c", "actualTrailingTss: merged plan evidence, partial excluded, no phantom pre-plan corpus",
    JSON.stringify(a.input.actualTrailingTss) === JSON.stringify([210]),
    JSON.stringify(a.input.actualTrailingTss));
  const expectedLedger = [
    { weekStart: "2026-01-05", actualTss: 100, incomplete: true, plannedTss: 200, rampCapTss: 240, sessionsMissed: 1, sessionsPlanned: 2 },
    { weekStart: "2026-01-12", actualTss: 210, plannedTss: 210, rampCapTss: 240, sessionsMissed: 0, sessionsPlanned: 1 },
  ];
  check("M2d", "the ledger carries the partial flag and refuses the partial ramp reference",
    JSON.stringify(a.input.ledger) === JSON.stringify(expectedLedger), JSON.stringify(a.input.ledger));
  check("M2e", "history is empty on a phone — no invented past", a.input.history.length === 0);
}

// ——— M3. the refusal branches, with the phone's own remedies ——————————————
{
  const speculative = buildMobileReflowInput({ request, plan }, decision, fill, {
    ...sources,
    actualState: { ...state, zeroLoadDays: 24 },
  });
  check("M3a", "a mostly-assumed state refuses and names the phone's remedy (tap your sessions)",
    speculative.kind === "refuse" && /Tap the sessions you completed/.test((speculative as { reason: string }).reason),
    JSON.stringify(speculative));
  const unreadable = buildMobileReflowInput({ request, plan }, decision, fill, {
    ...sources,
    tissue: { constraints: [], active: [], status: "unreadable", message: "bad byte" },
  });
  check("M3b", "an unreadable declaration store refuses (E9, on the phone)",
    unreadable.kind === "refuse" && /tissue-declarations unreadable \(bad byte\)/.test((unreadable as { reason: string }).reason));
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nmobile-reflow-input: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
