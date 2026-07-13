# Goal-backed periodization — architecture map

Scope: read-only map of the current code, no feature edits. Goal: locate the
exact seam where a race-distance + goal-pace periodization TARGET can raise the
forward plan's weekly TSS (rising CTL toward peak ~50 for a 1:24 half) WITHOUT
touching the backtested prediction, so the pinned baselines
(maeConsistent ≤ 89.4, corr ≥ 0.79, dir ≥ 74) hold byte-for-byte.

All file:line references are on branch `feat/goal-periodization` at worktree
`/tmp/taper-wt-periodization`.

Baseline captured this turn (`npm run engine:backtest`):
`taperV1 { maeConsistent: 89.4, corr: 0.79, dir: 75 }` — sitting exactly on the
pin. Any drift downward fails `scripts/verify.sh:86`.

---

## 1. How weekly TSS TARGETS are set today (forward plan-generation path)

The forward plan is built by `generatePlan()` in `engine/plan.ts:315`. Per
simulated week it constructs an `AthleteState` (`engine/plan.ts:347-366`) from
the rolling-forward projected `ctl`/`atl` and calls the learned engine:

- `engine/plan.ts:367` — `const p = engine.prescribeWeek(state);` — the single
  call that produces the week's `weekTss`. Everything else (session slotting,
  durations, PMC roll-forward) hangs off `p.weekTss`.

The engine is `TaperV1` (`engine/plan.ts:323`), which wraps the reference
engine. The weekly number is decided in three layers:

**(a) Reference periodization (`engine/reference.ts`)** — the physiology
scaffold. `phaseFor()` (`reference.ts:31-45`) assigns the phase from
`daysToNextRace`:
- `d ≤ 7` → `race`; `d ≤ 21` → `taper`; `d ≤ 84` → `build`; else `base`
  (`reference.ts:33,34,43,44`); plus `recovery`/`offseason` routing.

Base/build load is a CTL-gain target, NOT distance/pace aware:
- `reference.ts:14-17` — `gBase = 1.2`, `gBuild = 1.7` CTL pts/week.
- `reference.ts:91-94` — `weekTss = 7 * (ctl + 6*g)`. This is the ONLY place
  race intent could enter today, and it enters only as a fixed phase constant.
  There is no function of race distance or goal pace anywhere in the target.
- `RACE_TSS` (`plan.ts:79-88`) maps race type → a single race-DAY TSS
  (`run-half: 115`), used only for the race session budget
  (`plan.ts:371-372`), never to size the build.

**(b) Anchor-v2 ceiling (`engine/learned.ts`, DEFAULT)** — caps how high the
learned regression may push a base/build/offseason week:
- `anchorV2Ceiling()` (`learned.ts:186-198`): `anchor = max(maintenance=ctl*7,
  decayed peak week)`, then `min(anchor, rampCapRef * 1.2)`.
- Applied at `learned.ts:303-305` (`useAnchor` for base/build/offseason).
- This is a CEILING: it limits build weeks, it does not push them up (except the
  week-1 base floor below). Rule 4: the +20% ramp cap (`ANCHOR_V2_RAMP_CAP =
  1.2`, `learned.ts:162`) is a hard ceiling.

**(c) Safety rails (hard limits, rule 4)** applied after the learned value:
- Ramp cap: WoW band `learned.ts:357-362` (≤ +20% / ≥ −35% vs
  `prevPrescribedTss`); anchor ramp cap `learned.ts:196`.
- TSB floor −25 forces `recovery` upstream (`reference.ts:41`; bounds
  `learned.ts:227`).
- Weekly floor 60 TSS (`learned.ts:363` `Math.max(60, value)`).

**Phases & their targetTss in the emitted plan.** Phase comes straight from
`p.phase` (`plan.ts:447-453`). Note `PlanWeek.targetTss` (`plan.ts:450`) is NOT
`p.weekTss` — it is the sum of the EMITTED session TSS after slotting, race-week
trimming, long-session drop, and start-date filtering
(`plan.ts:374-408, 445, 450`). So a periodization change that lifts `p.weekTss`
flows into `targetTss` through the sessions, as desired.

**Existing precedent for a plan-only lift: the week-1 base floor.** The cleanest
template to copy is already in the code:
`learned.ts:332-349` lifts the FIRST plan week to `1.15 × maintenance` when
`state.isFirstPlanWeek === true` and the race is ≤ 98 days out. This is a
periodization TARGET (a preference that may exceed the anchor ceiling, but never
the rails — `learned.ts:340-344` still clamps to `trailingMean*1.2` and
`rampCapRef*1.2`). It is the existing proof that a goal-backed target can be
injected here.

---

## 2. CRITICAL — how the BACKTEST path differs (the backtest-neutral seam)

**The backtest does NOT call `generatePlan`.** `engine/backtest.ts:41-48`:

```
const rows = examples.map((ex) => {
  for (const e of engines) {
    const p = e.prescribeWeek(ex.features);      // line 43
    byEngine[e.name] = { phase: p.phase, predicted: p.weekTss };
  }
  v1.observe(ex.features, ex.targets.weekTss, ex.weekStart);  // line 48 (after)
  ...
});
```

It calls `engine.prescribeWeek(ex.features)` DIRECTLY, week by week, feeding
`AthleteState` objects loaded verbatim from
`data/datasets/weekly-examples.jsonl` (`backtest.ts:21-24`). It never sees a
`PlanRequest`, never sees a goal, never sets any plan-context signal. It is the
classic week-by-week learned-engine replay WITHOUT the plan/goal context —
exactly the asymmetry the task describes.

Confirmed empirically this turn — a dataset feature record carries exactly:
`ctl, atl, tsb, last4WeeksTss, last4Shares, daysToNextRace, weeksSinceStart,
breakRatio, daysSinceLastSession`. It does NOT carry `isFirstPlanWeek`, and does
NOT carry any goal field (`"isFirstPlanWeek" in features === false`,
`goalTime` absent).

**This is the seam.** The existing `isFirstPlanWeek` flag
(`engine/types.ts:26-34`) is the exact, already-shipped pattern:

- It is OPTIONAL on `AthleteState` and set ONLY by `generatePlan` on week 0
  (`plan.ts:357` `isFirstPlanWeek: weeks.length === 0`).
- The backtest builds states from the dataset, which lack the field, so it reads
  `undefined` → the week-1 base floor cannot fire in the backtest
  (`learned.ts:322-325, 336` documents this exact leak-fix). The predecessor
  proxy (`prevPrescribedTss === undefined`) leaked onto ~47 backtest weeks and
  regressed the pins; the explicit signal fixed it.

**Feasibility: YES.** A goal-backed periodization target is backtest-neutral if
and only if it is gated on plan-only signal(s) that the dataset features can
never carry. Two composable options, both safe:

1. Carry the goal on `AthleteState` as a new OPTIONAL field (e.g.
   `goalPeakCtl?: number` or `goalTimeSec?: number`), set only inside
   `generatePlan`'s per-week state (`plan.ts:347-366`) from a new `PlanRequest`
   field. Absent in the dataset → `undefined` in the backtest → the new target
   branch is skipped → `prescribeWeek(ex.features)` returns byte-identical
   numbers. This mirrors `isFirstPlanWeek` precisely.
2. Or compute the periodization lift entirely inside `generatePlan` (which the
   backtest never calls) — e.g. a per-week floor applied to `p.weekTss` after
   `engine.prescribeWeek` at `plan.ts:367`, before session distribution. Since
   the backtest scores `prescribeWeek` output directly and never runs
   `generatePlan`, any lift added in `plan.ts` is invisible to the backtest by
   construction.

Either way the RAILS still bind (rule 4): a goal target may exceed the anchor
CEILING (a preference, like the week-1 floor) but must remain clamped under the
+20% WoW/ramp caps, the TSB −25 floor, and the weekly 60 floor. Reaching peak
CTL ~50 from ~16.9 over 14 weeks must therefore be spread across weeks by the
ramp cap, not jumped in one week — which is physiologically correct and
injury-safe.

**Recommendation:** Option 1 (goal field on `PlanRequest` → threaded onto the
per-week `AthleteState` → new gated branch in `learned.ts` alongside the
existing base-floor block at `learned.ts:332-349`). It reuses the proven,
audited `isFirstPlanWeek` neutrality pattern and keeps the invertible
distance+pace→CTL function inside the engine where the reference math lives.
Whichever branch is added must be gated so `useAnchor`/base-floor style checks
see the goal ONLY in a real plan.

---

## 3. Where the long-run session length is decided

Two-stage, both in `engine/plan.ts`; NO tie to race distance today:

1. TSS share → the `run-long` slot weight is `1.7` (tri: `1.25`)
   (`plan.ts:275, 288`), so the long run gets the biggest slice of the fixed
   weekly TSS (`plan.ts:382, 393` `tss = trainableTss * weight / totalWeight`).
2. TSS → duration → CLAMP: `plan.ts:394-396`:
   `durationHr = tss / (IF² * 100)` then
   `Math.min(run-long ? 2.6 : ..., Math.max(0.4, durationHr))`.
   The `run-long` template IF is `0.72` (`plan.ts:137`). The hard ceiling is
   **2.6 h ≈ 156 min**, and the minutes are rounded to 5 (`mins()`
   `plan.ts:115`). There is NO minimum-distance progression and NO race-distance
   coupling: at the athlete's low CTL the long run comes out short (the
   13–14 km symptom) because it is purely a function of weekly TSS and the slot
   weight, capped at 2.6 h.

To build toward ~22–26 km / ~110–130 min for a half (injury-capped), the fix
lives here: make the `run-long` duration a function of race distance (a target
minutes/distance progression), floored/capped by phase and the injury rate
limit, rather than a pure TSS-share residual. The 2.6 h ceiling
(`plan.ts:395`) already exists as the upper guard.

---

## 4. Where projected CTL/ATL/TSB per week are computed (weeks[].projected)

`engine/plan.ts:424-440`. After sessions are placed, the week is simulated
day-by-day:
- `plan.ts:432-433` — PMC recursion `ctl += (dayTss - ctl)/42;
  atl += (dayTss - atl)/7;` (τ=42/τ=7 — DO NOT TOUCH, rule 6).
- `plan.ts:440` — `projected = { ctl, atl, tsb: ctl-atl }` snapshotted at
  week END (comment `plan.ts:435-439` explains the end-of-week convention and
  the yesterday-CTL−ATL TSB).
- `raceMorning` (`plan.ts:428-429`) captures race-day CTL/TSB BEFORE race load
  (rule 5), surfaced as `meta.projectedRaceCtl` (`plan.ts:471`).

Because `projected.ctl` is driven by the emitted session TSS, lifting the
periodization target (section 2) automatically makes the report's CTL curve
rise toward the goal peak — the plan page reads `weeks[].projected`
(`src/app/app/plan/page.tsx`) and `meta.projectedRaceCtl`. The report showing
"rising CTL" is a downstream consequence of the target lift; no separate wiring
needed. A gap assessment (reachable CTL → estimated finish) would invert the
same distance+pace→CTL function against `meta.projectedRaceCtl`.

---

## 5. PlanRequest shape — does it carry goal time/pace? (NO — where to add it)

`PlanRequest` (`engine/plan.ts:22-41`) fields today:
`raceName, raceDate, raceType, daysPerWeek, longDay, startDate?, maxSessions?,
anchorV2?, anchorLegacy?`. **No goal time and no goal pace.** `RaceType`
(`plan.ts:12-20`) gives distance bucket only (`run-half`), no target pace.

To add `goalTime` (and/or derived `goalPace`), the touch points are:
- `engine/plan.ts:22-41` — add optional `goalTime?: string` (or
  `goalTimeSec?: number`) to `PlanRequest`. Optional keeps every existing
  caller/harness valid.
- `src/app/app/actions.ts:91-103` — populate it from the intake form
  (`generatePlanAction` reads `formData`); add a field to
  `src/components/app/intake-fields.tsx` (the `raceType`/distance selector is at
  `intake-fields.tsx:50-55`).
- `engine/plan.ts:347-366` — thread the goal (or a precomputed `goalPeakCtl`)
  onto the per-week `AthleteState` so the engine can read it (section 2,
  option 1).
- `engine/invariants.ts:50-67` / `backtest.ts` need NO change: `PlanRequest`
  additions are optional, and the backtest never constructs a `PlanRequest`.

The distance+pace → required-CTL mapping (monotonic, invertible, anchored so
1:24 half → peak ~50) is NEW code and belongs in the engine (near
`reference.ts` periodization math), consumed at the section-2 seam. Persisted
plans store the request (`src/lib/plan-io.ts:10`), so the goal round-trips for
replan.

---

## Bottom line

- Weekly targets today: `reference.ts:91-94` CTL-gain constants → `TaperV1`
  learned value → anchor-v2 ceiling + rails. No distance/pace dependence.
- **Backtest-neutral seam: YES, feasible.** The backtest calls
  `prescribeWeek(ex.features)` directly (`backtest.ts:43`), never
  `generatePlan`, on dataset states that cannot carry a goal signal. Gate the
  goal-backed target on a plan-only optional field — exactly the shipped,
  audited `isFirstPlanWeek` pattern (`types.ts:26`, `plan.ts:357`,
  `learned.ts:332-349`) — and the backtested prediction is byte-unchanged;
  pins (89.4 / 0.79 / 74) hold.
- Long run: `plan.ts:394-395`, capped 2.6 h, pure TSS residual — needs a
  distance-tied progression.
- Projected CTL: `plan.ts:424-440`; rises automatically once the target rises.
- `PlanRequest` has no goal field; add optional `goalTime` at `plan.ts:22-41`,
  wire from `actions.ts:91`.

This turn's re-pinned baselines were verified UNCHANGED; this note proposes no
edits and no re-pin.
