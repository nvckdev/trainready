---
name: taper-feature
description: How to add a premium feature to Taper safely and fast — the layering, the backtest-neutral seam, the src/lib gateway, the reusable engine model APIs, and the test-first gauntlet. Load BEFORE building any new athlete-facing feature (race-day tools, trackers, digests, adaptive logic, new cards/pages). Encodes the pattern that shipped race-day execution, capability, adaptive re-plan, the workout renderer, and the weekly digest without ever moving the backtest pins.
---

# Adding a Taper feature

Every feature this pattern shipped reused the physics and never touched it, so
the backtest pins (`maeConsistent ≤ 89.4, corr ≥ 0.79, dir ≥ 74`) stayed
byte-identical and `npm run verify` stayed green. Follow the layer map, pick the
right seam, reuse the model APIs, and go test-first. Read
[taper-rules](../taper-rules/SKILL.md) first — this skill is how to build within
those rules; that skill is why.

## 1. The layer map — decide where your code goes

| Layer | Dir | Rule | Backtested? |
|---|---|---|---|
| Physiology + models | `engine/` | pure, no `src/` imports; τ=42/7 PMC is untouchable | **YES** (via `backtest.ts`) — moving it moves the pins |
| Plan-generation-only logic | `engine/` behind a plan-gen signal | forward-only; the backtest never sets the signal | **NO** — safe to change freely |
| App data access | `src/lib/*` | the ONLY place that reads the corpus (rule 12 gateway) | no |
| Presentation | `src/components/app/*`, pages | pure over typed inputs; bone/hairline/label-mono | no |

If your feature is **display or forward-planning**, it must NOT enter the
backtested path. `engine/backtest.ts` imports only `reference.ts` / `learned.ts`
/ `types.ts` — never `plan.ts` / `goal.ts` / `raceday.ts` / `replan.ts`. So
anything you add to those four files is automatically backtest-neutral. Confirm
with a test that greps `backtest.ts` for your module name (see
`engine/replan.test.ts` N1).

## 2. The backtest-neutral seam (for engine behavior that must stay off the pins)

When forward planning needs new behavior inside the *learned* engine (which IS
backtested), gate it on a signal `generatePlan` sets but `backtest.ts` never
does. Two exist; copy the pattern:

- `AthleteState.isFirstPlanWeek` — true only for week 0 of a real plan
  (`plan.ts` sets it; dataset rows lack it). The week-1 base floor rides it.
- `AthleteState.goalPeakCtl` — set only in `generatePlan`; the goal-CTL
  trajectory rides it. Absent on the backtest path ⇒ the goal floor never fires
  in replay.

Add your flag to `engine/types.ts`, set it in `generatePlan`, gate your logic on
`state.<flag> === true`, and assert in a test that the flag-off path is
byte-identical to the old output. This is how the default flip to anchor-v2 and
the goal-backed periodization both shipped after a floor-leak was found and
fixed — the leak was a plan-gen heuristic (`prevPrescribedTss === undefined`)
that was ALSO true in the backtest. **Never infer a plan-gen signal from a field
the backtest happens to leave unset** — set it explicitly.

## 3. Reuse the model APIs — never re-implement physiology

These are the tested, honest primitives. Import them; don't rebuild them.

| Need | API (`engine/…`) |
|---|---|
| Required peak CTL for a goal | `goalCtlTarget(distanceKm, goalTimeSec) → {peakCtl, raceDayCtl, vdot, weeklyTss}` (`goal.ts`) |
| Honest finish from fitness | `finishEstimate(reachableCtl, distanceKm, anchors?, asOf?) → sec` — history/ceiling-aware, clamped to never beat a real race at ≤ that CTL (`goal.ts`) |
| Race distance from type | `raceDistanceKm(raceType)` (`goal.ts`) |
| Athlete's real races | `loadRaceAnchors()` (`goal.ts`, reads corpus) |
| Race-day pacing/fuel/heat | `raceDayPlan({distanceKm, projectedRaceCtl, anchors, asOf, tempC?})` (`raceday.ts`) |
| PR-equivalents + %-to-peak | `capabilityProfile(currentCtl, anchors, asOf)` (`raceday.ts`) |
| Reflow plan from actual fitness | `recomputeRemaining(input)` (`replan.ts`) |
| Roll PMC forward to a date | `seedStateAt(base, series, startDate)` (`seed.ts`) |
| Athlete pace/power zones | `deriveZones(thresholds)` (`zones.ts`) |
| Plain-language week summary | `weeklyDigest(pmc, weekly, plan, today)` (`src/lib/digest.ts`) |

VDOT / CTL constants are physiology, not tunables. If a number feels arbitrary,
it's probably calibrated (e.g. `CVOL=4.9`, `TAPER_RETENTION=0.94`,
`CEIL_DECAY_PER_YR=0.02`) — leave it unless you're recalibrating with evidence.

## 4. The src/lib gateway (rule 12)

Pages and components must read athlete data **only** through `src/lib`. Add a
composing accessor there (e.g. `src/lib/race-insights.ts`, `src/lib/digest.ts`)
that pulls the corpus (`getPmc`, `getWeekly`, `getStateAt`, `loadRaceAnchors`)
and calls the pure engine model, then have the page import that. Keep engine
modules corpus-free so they stay unit-testable — the caller does I/O.

## 5. Honesty & health-data invariants (never regress)

- **Never over-promise.** Finish/goal numbers come from `finishEstimate`, which
  is clamped to the athlete's demonstrated races. Label estimates as estimates.
- **Health data stays in `data/`** (gitignored — rule 13). `git status
  --porcelain | grep data/` must print nothing before every commit.
- **Athlete-facing dates are America/New_York** via `localToday()` (rule 16).
  Never `new Date().toISOString().slice(0,10)` as "today".
- **Chart/zone colors** are the validated fixed set (rule 14) — reuse tokens,
  don't invent hex.

## 6. Build order (proven)

1. **Model first, in `engine/`** — pure function + a `engine/<name>.test.ts`
   (tsx; exit code = failure count) with hand-verified vectors. Register it in
   `package.json` `engine:tests`. App-layer tests (that import `src/lib`, which
   pulls Next types) go under `app:tests`, NOT `engine:tests` — a `src/lib`
   import in an `engine/*.test.ts` drags the whole app graph into
   `tsc -p engine` and fails on Next-only `fetch` options.
2. **Gateway accessor in `src/lib`** composing corpus + model.
3. **Presentation** — a card/section in `src/components/app`, wired into the
   page. Match `bits.tsx` (bone/hairline/label-mono; signal marks the honest
   headline number).
4. **Verify visually** in the preview (`preview_start` name `trainready`), then
   run the full gauntlet: `npm run verify` (or `bash scripts/verify.sh`). It
   must be all-PASS — the backtest line must still read `89.4/0.79/75`.
5. **Commit** (the pre-commit hook re-runs the gauntlet) and push.

## 7. Reliability note (operational)

Heavy multi-agent workflows in this repo have repeatedly died on background-infra
drops mid-run — but worktree commits persist, so `resume` picks up losslessly,
or build directly inline. For a multi-file feature, committing each layer as it
lands (model → gateway → UI) makes any interruption cheap to recover.
