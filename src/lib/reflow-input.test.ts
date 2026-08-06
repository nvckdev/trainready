import { buildReflowInput, type ReflowSources } from "./reflow-input";
import type { Plan, PlanRequest } from "../../engine/plan.ts";
import type { ReconcileDecision } from "../../engine/reconcile.ts";
import type { SeededState } from "../../engine/seed.ts";
import type { Zones } from "../../engine/zones.ts";
import { deriveZones } from "../../engine/zones.ts";
import { declareTissue } from "../../engine/tissue.ts";

/**
 * The dashboard's assembled reflow input, snapshot against fixed synthetic
 * sources — the wiring-test contract from the 2026-08-06 verification pass.
 *
 * Findings ②③⑤ shared one shape: every engine primitive pinned, the
 * field-by-field ASSEMBLY bare, so a silently dropped field (mobile's
 * tissueConstraints) or a silently re-sourced one (actualTrailingTss from the
 * raw corpus rollup) failed nothing. This test freezes the full assembled
 * ReplanInput as an explicit expected OBJECT — any dropped or re-sourced
 * field changes it — plus reference-identity checks for the pass-through
 * fields, which catch re-sourcing that happens to produce equal values.
 *
 * KILL-RUNS (each verified once before this file counted as a guard):
 *   - dropping `tissueConstraints: s.tissue.constraints` from the request
 *     → S2b fails (request snapshot)
 *   - re-sourcing actualTrailingTss to a raw array → S2c fails
 *   - dropping fill.partial from buildLedger → S2d fails (incomplete flag
 *     and the ramp reference both move)
 * Dropping a SOURCE at the call site is a compile error by construction:
 * ReflowSources has no optional keys.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

// ——— fixed synthetic world ————————————————————————————————————————————————
const zones: Zones = deriveZones({ ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: 1000 / 270, swimCssMps: 1.1 });

const request: PlanRequest = {
  raceName: "Snapshot race",
  raceDate: "2026-03-15",
  raceType: "run-10k",
  daysPerWeek: 6,
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

const decision: ReconcileDecision = {
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
    ["2026-01-05", 100], // partial-tap lower bound
    ["2026-01-12", 210],
  ]),
  partial: new Set(["2026-01-05"]),
};

const constraint = declareTissue("calf", "tendinopathy", "impact", "snapshot why");
const sources: ReflowSources = {
  actualState: { ctl: 40, atl: 42, tsb: -2, last4WeeksTss: [200, 205, 210, 208], last4Shares: { swim: 0, bike: 0, run: 1 }, daysToNextRace: null, weeksSinceStart: 10, breakRatio: 1, daysSinceLastSession: 1, anchorDate: "2026-01-17", zeroLoadDays: 1, evidencedDays: 1 } as SeededState,
  tissue: { constraints: [constraint], status: "ok", unmapped: [] },
  priorWeights: { a: 1, b: 2 } as unknown as PlanRequest["priorWeights"],
  eras: [{ span: "2024-2026", startMonth: "2024-01", endMonth: null, weight: 2 }] as PlanRequest["eras"],
  raceAnchors: [{ date: "2025-10-01", raceType: "run-10k", finishSec: 2500 }] as unknown as PlanRequest["raceAnchors"],
  history: [{ state: { ctl: 38 } as SeededState, actualTss: 260, weekStart: "2025-12-29" }],
  zones,
  prePlanMeasured: new Map([["2025-12-29", 180.4]]),
};

// ——— S1. pass-through fields keep their IDENTITY ——————————————————————————
// Equal-by-value is not enough: a re-sourced field that happens to coincide
// on the fixture would pass a deep-equal. Same object or it fails.
{
  const a = buildReflowInput({ request, plan }, decision, fill, sources);
  check("S1a", "assembles ready on good sources", a.kind === "ready", a.kind);
  if (a.kind === "ready") {
    check("S1b", "actualState is THE state the caller read (identity)", a.input.actualState === sources.actualState);
    check("S1c", "history is THE history the caller read (identity)", a.input.history === sources.history);
    check("S1d", "zones is THE zones object (identity)", a.input.zones === sources.zones);
    check("S1e", "request.tissueConstraints is THE tissue read's list (identity)",
      a.request.tissueConstraints === sources.tissue.constraints);
    check("S1f", "the reflow input's request is the assembled request (one request, not two)",
      a.input.stored.request === a.request);
    check("S1g", "the plan passes through untouched (identity)", a.input.stored.plan === plan);
  }
}

// ——— S2. the assembled input, as an explicit snapshot —————————————————————
{
  const a = buildReflowInput({ request, plan }, decision, fill, sources);
  if (a.kind !== "ready") throw new Error("unreachable");

  check("S2a", "asOf is the DECISION's asOf, nothing else", a.input.asOf === "2026-01-19");

  const expectedRequest = {
    raceName: "Snapshot race",
    raceDate: "2026-03-15",
    raceType: "run-10k",
    daysPerWeek: 6,
    longDay: "sunday",
    startDate: "2026-01-05",
    tissueConstraints: [constraint],
    priorWeights: sources.priorWeights,
    eras: sources.eras,
    raceAnchors: sources.raceAnchors,
  };
  check("S2b", "the request threads tissue, prior, eras and anchors — nothing dropped, nothing added",
    JSON.stringify(a.request) === JSON.stringify(expectedRequest),
    JSON.stringify(a.request));

  // Hand-computed: pre-plan corpus week (180.4 → 180) prepends; the partial
  // week 2026-01-05 is EXCLUDED; the known full week contributes 210.
  check("S2c", "actualTrailingTss = E3-filtered pre-plan + merged plan evidence, partial excluded",
    JSON.stringify(a.input.actualTrailingTss) === JSON.stringify([180, 210]),
    JSON.stringify(a.input.actualTrailingTss));

  const expectedLedger = [
    {
      weekStart: "2026-01-05",
      actualTss: 100,
      incomplete: true,
      plannedTss: 200,
      rampCapTss: 240, // first week: its own target × 1.2
      sessionsMissed: 1,
      sessionsPlanned: 2,
    },
    {
      weekStart: "2026-01-12",
      actualTss: 210,
      plannedTss: 210,
      rampCapTss: 240, // prev week is PARTIAL ⇒ ramp ref falls back to its target
      sessionsMissed: 0,
      sessionsPlanned: 1,
    },
  ];
  check("S2d", "the ledger carries the partial flag and refuses the partial ramp reference",
    JSON.stringify(a.input.ledger) === JSON.stringify(expectedLedger),
    JSON.stringify(a.input.ledger));
}

// ——— S3. the refusal branches ——————————————————————————————————————————————
{
  const speculative = buildReflowInput({ request, plan }, decision, fill, {
    ...sources,
    actualState: { ...sources.actualState!, zeroLoadDays: 9 } as SeededState,
  });
  check("S3a", "a mostly-assumed fitness state refuses with the E8 sentence",
    speculative.kind === "refuse" && /9 days since 2026-01-17/.test((speculative as { error: string }).error),
    JSON.stringify(speculative));

  const unreadable = buildReflowInput({ request, plan }, decision, fill, {
    ...sources,
    tissue: { constraints: [], status: "unreadable", message: "boom", unmapped: [] },
  });
  check("S3b", "an unreadable safety file refuses with the E9 sentence",
    unreadable.kind === "refuse" && /athlete-context\.json is unreadable \(boom\)/.test((unreadable as { error: string }).error));

  const noState = buildReflowInput({ request, plan }, decision, fill, { ...sources, actualState: null });
  check("S3c", "no fitness state skips silently — a missing read is not an error the athlete caused",
    noState.kind === "skip");
  const noZones = buildReflowInput({ request, plan }, decision, fill, { ...sources, zones: null });
  check("S3d", "no athlete skips silently", noZones.kind === "skip");
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nreflow-input: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
