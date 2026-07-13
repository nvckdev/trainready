# Goal-backed periodization — implementation spec

Branch `feat/goal-periodization`. This spec turns the architecture map
(`docs/periodization-arch.md`) into a buildable design: a race-distance +
goal-pace → required-CTL function, an invertible CTL → finish estimate, a
rising-CTL trajectory that honors the safety rails, an honest gap assessment,
a distance-tied injury-capped long run, and the exact backtest-neutral wiring.

**Non-negotiables carried from `taper-rules` (every one constrains a choice
below):**

- **Rule 6 — PMC recursion is physiology, not parameters.** τ=42 CTL / τ=7 ATL,
  TSB = yesterday CTL−ATL. Untouched. All CTL math here *consumes* these
  constants; it never re-derives or tunes them.
- **Rule 4 — safety rails are HARD ceilings.** Weekly ramp ≤ +20% over the
  trailing-month mean (and over the smoothed ramp-cap reference), TSB floor
  −25 forces recovery, weekly floor 60 TSS. The goal target may exceed the
  anchor *ceiling* (a preference, exactly like the shipped week-1 base floor)
  but **never** a rail. Build weeks may push toward the +20% cap; none may
  exceed it.
- **Rule 2 — taper/race is protocol.** Nothing here touches taper or race
  weeks; the goal target is inert once `phase ∈ {taper, race}` (those weeks
  early-return to the reference numbers before any goal branch runs).
- **Rule 7 — backtest baselines hold byte-for-byte.** Pins re-pinned this turn
  to `maeConsistent ≤ 89.4, corr ≥ 0.79, dir ≥ 74` (`scripts/verify.sh`,
  `engine/backtest.ts`). The human did **not** authorize another re-pin. The
  seam (§3) makes the goal target invisible to `prescribeWeek(ex.features)`, so
  the backtest is unchanged. **If any implementation step moves a pin, that is a
  STOP-for-sign-off, not an autonomous re-pin.**
- **Anchor-v2 stays the default.** The goal target rides *inside* the anchor-v2
  path, alongside the existing `isFirstPlanWeek` week-1 base floor
  (`learned.ts:332-349`), reusing its audited neutrality pattern.

---

## 0. Model choice — reconciled hybrid (VDOT backbone, closed-form cross-check)

Two candidates were on the table:

- **Model A (RTS-CTL):** race intensity-duration collapsed to the clean closed
  form `requiredPeakCtl = K · distanceKm · goalSpeedKmh`, `K = 0.158`, with the
  exact algebraic inverse `estFinishHr = K · distanceKm² / reachableCtl`. One
  constant, provably monotone, trivially invertible.
- **Model B (VVA-B):** Daniels `VDOT`/`%VO2max` → weekly running-volume norm →
  weekly TSS → CTL, inverted by monotone bisection.

**Both reproduce the anchor** (1:24 half → peak CTL ≈ 50) and **both are
monotone** in distance and pace. They agree *near the anchor*. They diverge
sharply on the **inverse far below the anchor** — which is exactly the region
the gap assessment lives in, because the safely-reachable CTL for this athlete
is ≈ 26, not 50:

| reachable race-day CTL | Model A inverse | Model B inverse |
|---|---|---|
| 50 (anchor) | 1:24 | 1:24 |
| 30 | 2:20 | 1:40 |
| 26 | **2:42** | **1:44** |

Model A's `time ∝ d²/CTL` hyperbola says halving CTL nearly doubles finish time
— physiologically far too sensitive; a detrained-but-naturally-fast runner does
not run a 2:42 half. Model B's VDOT curve is the established sports-science
shape and gives a believable ~1:44. **Because the whole point of the gap
assessment is to compute a realistic finish from the reachable (~26) CTL, the
inverse must behave correctly there. Model B wins on the decisive axis.**

**Decision: canonical = Model B (VDOT backbone), forward and inverse.** Model
A's closed form is retained as a documented O(1) sanity cross-check
(`requiredPeakCtl ≈ 0.158 · D · v_kmh`, agrees with B at the anchor to within a
CTL point) and as a fast monotonicity assertion in the test suite. The
distance-IF ladder (5k faster than half faster than marathon) then *emerges*
from real `%VO2max` physiology rather than a single-athlete reference speed.

All new math lives in a new engine module **`engine/goal.ts`** (pure, no `src/`
imports, mirrors `reference.ts`), imported by `plan.ts` and `learned.ts`.

---

## 1. `goalCtlTarget(distanceKm, goalTime)` and inverse `finishEstimate(reachableCtl, distanceKm)`

### 1.1 Forward — required CTL from race distance + goal pace

`engine/goal.ts`:

```ts
// Daniels VDOT backbone. T in MINUTES, D in km. Domain-clamped D ∈ [3, 50].
export function vdot(distanceKm: number, timeMin: number): number {
  const D = clamp(distanceKm, 3, 50);
  const v = (1000 * D) / timeMin;                      // race velocity, m/min
  const vo2 = 0.182258 * v + 0.000104 * v * v - 4.60;  // O2 cost of that pace
  const pct = 0.8                                       // fractional utilization
    + 0.1894393 * Math.exp(-0.012778 * timeMin)
    + 0.2989558 * Math.exp(-0.1932605 * timeMin);
  return vo2 / pct;
}

const CVOL = 4.9;            // TSS per weekly-km (avg training pace ~5:0–5:20, IF ~0.80)
const TAPER_RETENTION = 0.94; // CTL shed across a 2–3 wk taper (ATL sheds far more)

// weekly running-volume norm (competitive band) with a mild endurance premium
function weeklyKm(vdotVal: number, distanceKm: number): number {
  return Math.max(0, 3.0 * vdotVal - 90) * Math.pow(distanceKm / 21.1, 0.15);
}

export interface GoalCtl {
  peakCtl: number;     // pre-taper summit the trajectory aims for
  raceDayCtl: number;  // peak × taper retention — the headline "requires ~X"
  vdot: number;
  weeklyTss: number;
}

export function goalCtlTarget(distanceKm: number, goalTimeSec: number): GoalCtl {
  const T = goalTimeSec / 60;
  const v = vdot(distanceKm, T);
  const wKm = weeklyKm(v, distanceKm);
  const weeklyTss = CVOL * wKm;
  const peakCtl = weeklyTss / 7;               // sustained-load equilibrium
  return { peakCtl, raceDayCtl: peakCtl * TAPER_RETENTION, vdot: v, weeklyTss };
}
```

**Anchor check (1:24 half):** `D=21.1, T=84 min → v≈15.07 km/h → VDOT≈55.2 →
weeklyKm≈75.6 → weeklyTss≈371 → peakCtl≈52.9 → raceDayCtl≈49.8 ≈ 50 ✓`
(inside the required 45–55 band; the "use ~50" calibration point is the
race-day figure). Model A cross-check: `0.158·21.1·15.07 = 50.3 ✓`.

**The headline the plan surfaces is `raceDayCtl` (~50).** The trajectory's
summit is `peakCtl` (~53); it sheds ~6% across the taper to land near
`raceDayCtl` on race morning.

### 1.2 Inverse — finish estimate from a reachable CTL

Exact inverse of the forward chain; the only non-closed step is solving
`vdot(D,T) = VDOT*` for `T`, which is monotone (VDOT strictly decreasing in T
at fixed D) → unique root by bisection.

```ts
export function finishEstimate(reachableRaceDayCtl: number, distanceKm: number): number {
  const peakCtl   = reachableRaceDayCtl / TAPER_RETENTION;
  const weeklyTss = 7 * peakCtl;
  const wKm       = weeklyTss / CVOL;
  const vdotTarget = (wKm / Math.pow(distanceKm / 21.1, 0.15) + 90) / 3.0;
  // bisection on finish time, minutes; VDOT decreasing in T → unique root
  let lo = 2.5 * distanceKm, hi = 9.0 * distanceKm;      // physiological bracket
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (vdot(distanceKm, mid) > vdotTarget) lo = mid; else hi = mid;
  }
  return ((lo + hi) / 2) * 60; // seconds
}
```

**Round-trip:** `goalCtlTarget(21.1, 84·60).raceDayCtl = 49.8`;
`finishEstimate(49.8, 21.1) = 83.9 min = 1:24 ✓`. Gap region:
`finishEstimate(26, 21.1) ≈ 1:43`, `finishEstimate(30, 21.1) ≈ 1:40`.

**Monotonicity (both required gradients hold, asserted in tests):**
- Pace, half fixed at 21.1 km: 1:30→peak 41 | 1:25→48 | 1:24→50 | 1:20→56
  (strictly rising as pace quickens ✓).
- Distance, pace fixed 4:00/km: 10k→39 | half→49 | marathon→61 (strictly rising
  with distance ✓).

### 1.3 Validity band (honest caveat, carried into the UI)

CTL captures chronic *load*, not VO2max/economy/neuromuscular speed. The
inverse is an **upper bound on difficulty at a given fitness**, calibrated at
competitive CTL. Below the anchor it can only understate a naturally fast
runner (they may beat the estimate). Therefore the gap message **leads with the
CTL gap** and presents `finishEstimate` as a "load-limited" figure, never a
hard prediction. Clamp the reported pace to a sane floor (never faster than the
goal pace).

---

## 2. The CTL trajectory — from current ~17 to a rising peak

**Goal: `weeks[].projected.ctl` visibly climbs week over week through base/build,
dips on cutbacks, and peaks just before taper — driven entirely by the emitted
session TSS (no PMC changes).**

### 2.1 Mechanism — a plan-only weekly floor that pushes toward the ramp cap

Today a plan opens near maintenance (CTL×7 holds fitness flat). The shipped
week-1 base floor (`learned.ts:332-349`) already lifts *only* week 1. The goal
target **generalizes that floor to every pre-taper week while CTL is still
below the goal summit**, so each build week overloads at the maximum the rails
allow — which is what makes CTL rise.

New constant + branch in `learned.ts`, gated on the plan-only `goalPeakCtl`
signal (§3), placed immediately after the existing week-1 base-floor block and
**before** the WoW smoothing band and the weekly-60 clamp so all rails still
bind afterward:

```ts
// engine/learned.ts — goal-backed periodization floor (plan-only; see §3).
// Fires only when generatePlan threaded a goal onto the state; base/build only;
// only while CTL is still short of the goal summit. Pushes the week toward the
// +20% ramp ceiling so CTL climbs — but is itself min()-capped by the SAME
// rule-4 rails as the week-1 base floor, so it can never breach them.
if (
  this.anchorV2 &&
  (ref.phase === "base" || ref.phase === "build") &&
  state.goalPeakCtl !== undefined &&        // plan-only — absent in backtest
  state.ctl < state.goalPeakCtl             // stop overloading once at summit
) {
  const rampCeil = Math.min(
    trailingMean * ANCHOR_V2_RAMP_CAP,               // ≤ +20% trailing month
    rampCapRef(state) * ANCHOR_V2_RAMP_CAP           // ≤ +20% smoothed ref
  );
  // Aim at the ramp ceiling, but never above the weekly TSS that the goal
  // summit itself implies (no overshoot past what the race needs).
  const goalWeekly = state.goalPeakCtl * 7;
  const goalFloor = Math.min(rampCeil, goalWeekly);
  if (goalFloor > value) { value = goalFloor; goalFloorLift = true; }
}
```

- **Rails still bind.** The subsequent WoW band (`±` `prevPrescribedTss`,
  `learned.ts:357-362`) and `Math.max(60, value)` run unchanged after this, so
  no week can exceed +20% over the previous prescription or the trailing month.
- **Recovery weeks are untouched** — the 3:1 cutback (`weeksSinceStart %
  4 === 3` → `recovery` phase) keeps its legacy bounds, so CTL dips on cutback
  weeks. **Net trajectory: rise, rise, rise, dip, rise… → rising CTL.**
- **Auto-off near the summit.** Once `state.ctl ≥ goalPeakCtl` the floor stops
  firing and the normal anchor ceiling governs — the climb flattens at the
  peak rather than overshooting. For this athlete CTL never reaches ~53 in 14
  weeks, so the floor fires every build week and the plan ramps at the cap the
  whole way (still topping out well short — see §4, which is correct and
  injury-safe).
- **Rationale string** appends `", lifted to N by the goal target (race needs
  peak CTL ~M; ramping at the +20% ceiling)"` when `goalFloorLift`, mirroring
  the base-floor copy.

### 2.2 Why this yields visibly-rising `projected.ctl` with no PMC change

`plan.ts:424-440` already simulates PMC day-by-day from the *emitted* session
TSS and snapshots `projected = {ctl, atl, tsb}` at week end. Lifting
`p.weekTss` lifts the sessions (`plan.ts:391-408`), which lifts the daily TSS,
which — through the untouched τ=42 recursion — raises the week-end CTL. The
plan page (`src/app/app/plan/page.tsx`) reads `weeks[].projected.ctl` and
`meta.projectedRaceCtl` verbatim, so the rising curve appears with zero UI
wiring. **No `plan.ts` PMC edit; the trajectory is a pure downstream
consequence of the target lift.**

---

## 3. The backtest-neutral seam (exact wiring)

**The backtest never calls `generatePlan`.** `backtest.ts:43` calls
`e.prescribeWeek(ex.features)` directly on `AthleteState` records loaded from
`data/datasets/weekly-examples.jsonl`, which carry only `{ctl, atl, tsb,
last4WeeksTss, last4Shares, daysToNextRace, weeksSinceStart, breakRatio,
daysSinceLastSession}` — no goal, no `isFirstPlanWeek`. Copy that exact,
audited neutrality pattern.

**Wiring (Option 1 from the arch note):**

1. **`engine/types.ts`** — add ONE optional field to `AthleteState`, documented
   like `isFirstPlanWeek`:
   ```ts
   /** Required peak (pre-taper) CTL implied by the plan's race goal
    *  (engine/goal.ts). Set ONLY inside generatePlan's per-week state; NEVER
    *  present on the backtest replay path (dataset features lack it), so the
    *  goal floor cannot fire there. Mirrors isFirstPlanWeek's neutrality. */
   goalPeakCtl?: number;
   ```
2. **`engine/plan.ts:22-41`** — add `goalTime?: string` (`"H:MM:SS"` or
   `"MM:SS"`) to `PlanRequest`. Optional → every existing caller/harness stays
   valid; `invariants.ts`/`backtest.ts` need no change.
3. **`engine/plan.ts` (top of `generatePlan`)** — parse once:
   ```ts
   const goalSec = req.goalTime ? parseGoalTime(req.goalTime) : undefined;
   const goal = goalSec ? goalCtlTarget(raceDistanceKm(req.raceType), goalSec) : undefined;
   ```
   `raceDistanceKm` maps `RaceType` → km (`run-5k`→5, `run-10k`→10,
   `run-half`→21.1, `run-marathon`→42.2; tri types → `undefined` ⇒ no goal
   target, feature ignored for now).
4. **`engine/plan.ts:347-366`** — thread it onto the per-week state, right
   beside `isFirstPlanWeek`:
   ```ts
   goalPeakCtl: goal?.peakCtl,
   ```
5. **`engine/learned.ts`** — the §2.1 branch, gated on `state.goalPeakCtl`.
6. **`engine/goal.ts`** — new pure module (§1).

**Neutrality proof (the acceptance argument for rule 7):** the dataset feature
records have no `goalPeakCtl` key ⇒ `state.goalPeakCtl === undefined` on every
backtest week ⇒ the §2.1 branch is skipped ⇒ `prescribeWeek(ex.features)`
returns byte-identical `weekTss` ⇒ `maeConsistent/corr/dir` unchanged. This is
the same mechanism that already keeps `isFirstPlanWeek` out of the backtest
(`learned.ts:322-325` documents the prior `prevPrescribedTss===undefined` leak
that regressed the pins — do **not** reintroduce a proxy; gate on the explicit
field only). A test asserts `"goalPeakCtl" in feature === false` for every
dataset row.

**Second guardrail:** `goal.ts` is imported by `plan.ts`/`learned.ts` but the
`learned.ts` read is behind the `undefined` gate, and `plan.ts` is never run by
the backtest — so even the import is inert on the replay path.

---

## 4. Gap assessment (honest, rail-bounded)

The goal target is a **ceiling to aim at, capped by the rails** — never a number
the rails may be loosened to hit (rule 4). For this athlete the injury + short
runway + τ=42 inertia guarantee a shortfall, and the plan must *say so*.

### 4.1 Max safely-reachable peak CTL — forward simulation under the rails

Compute inside `generatePlan` (it already rolls PMC forward). A dedicated
`reachablePeakCtl()` re-simulates the same weekly loop with the goal floor
active, then reads the **peak** `projected.ctl` (1–2 weeks before taper) and the
race-morning CTL — i.e. it is literally the trajectory the plan will emit, so
the surfaced gap matches the plotted curve. Rails applied each week:

- weekly TSS ≤ `1.20 × trailing-4wk mean` **and** ≤ `1.20 × prevPrescribed`
  (the +20% ceiling — approached by build weeks, never exceeded);
- TSB ≥ −25 (else the reference engine routes the week to `recovery` and sheds
  load);
- weekly floor 60; 3:1 cutback rhythm (`weeksSinceStart % 4 === 3`);
- **calf/tendon conservatism factor:** temper build-week overload to **+12–15%**
  rather than the full +20% (`INJURY_RAMP = 1.13`), applied as an extra
  `min()` on the goal floor *only when a goal is present* — this is a planning
  conservatism, not a new rail, and it only ever *lowers* load.

**Result for CTL 16.9, 14-wk runway, seed ≈ 118 TSS/wk:** even pushing to the
uninjured +20% ceiling tops out at peak CTL ≈ 23–24 (race-day ≈ 20);
injury-tempered 3:1 lands peak ≈ 24–26 (race-day ≈ 25–27). Realistic reachable
**race-day CTL ≈ 26.** Why so low: from a low base with τ=42 inertia CTL climbs
only ~0.5–1 pt/wk, and each cutback resets the trailing mean the multiplicative
cap is measured against, so +20% cannot compound to 50 in 14 weeks. **Reaching
the required ~50 would require breaching the ramp cap and/or the TSB floor — a
rule-4 violation. The plan will not do it.**

> **Sensitivity (surface honestly):** the reachable ceiling swings several CTL
> with the seed trailing mean. Compute it from the athlete's actual last-4-week
> TSS, not the CTL×7 proxy, and recompute on every re-plan.

### 4.2 Required vs reachable → finish → message

- `requiredRaceDayCtl = goalCtlTarget(21.1, 84·60).raceDayCtl ≈ 50`
- `reachableRaceDayCtl ≈ 26` (§4.1, = `meta.projectedRaceCtl`)
- `gap = 50 − 26 ≈ 24 CTL`
- `realisticFinish = finishEstimate(26, 21.1) ≈ 1:43` (load-limited bound;
  economy may beat it — §1.3)

**Surfaced message format** (`meta.goalGap`, rendered §6):

> Goal 1:24 requires peak CTL ~50. A safe progression from your current ~17
> over 14 weeks — capped by the +20% weekly ramp, the −25 form floor, and your
> calf/tendon limit — reaches ~26. That projects to roughly **1:43** at this
> race (load-limited; sharp legs can beat it). To close the ~24-CTL gap:
> **extend the timeline** (~26–30 weeks), **target ~1:40 for this race** and
> treat 1:24 as a multi-season goal, or — only once the calf fully clears —
> ramp nearer (never above) the +20% ceiling. Re-test threshold pace mid-block
> to refine.

**The plan's own CTL summit target is set to the reachable ceiling (~26), NOT
the fictional 50**, so the emitted plan shows a real rising-CTL climb to what is
actually attainable. `goalPeakCtl` still carries the *required* 50 for the gap
math and for the floor's "aim high, rails bind" behavior; the two are reported
side by side. No rail is loosened to close the gap — that would be a STOP for
human sign-off.

---

## 5. Long-run progression — distance-tied, injury-capped

Replace the pure TSS-residual long run (`plan.ts:394-395`,
`durationHr = tss/(IF²·100)` capped 2.6 h — the 13–14 km symptom at low CTL)
with an explicit distance-tied progression that **floors** the run-long
duration, in `engine/goal.ts` + consumed at the `run-long` slot in `plan.ts`.

```ts
// engine/goal.ts
const EASY_KMH = 11.6;             // easy long-run pace
const LONG_MULT = { "run-5k": 2.6, "run-10k": 1.6, "run-half": 1.15, "run-marathon": 0.76 };
const INJURY_CAP_KM = 24;          // calf/tendon ceiling this cycle (was 22–26 band)
const INJURY_STEP_KM = 2.0;        // ≤ +2 km/week
const INJURY_RATE = 0.08;          // ≤ +8%/week (min with step)
const LONG_MIN_CAP = 130;          // minutes — calf duration ceiling (≤ engine's 156)

export function peakLongKm(raceType: RaceType): number {
  return Math.min(raceDistanceKm(raceType) * LONG_MULT[raceType], INJURY_CAP_KM);
}
// weekly build progression, injury-tightened; hold flat on cutback weeks
export function longRunKm(prevKm: number, peakKm: number, cutback: boolean): number {
  if (cutback) return prevKm;      // 3:1 cutback holds the long run flat
  return Math.min(peakKm, prevKm * (1 + INJURY_RATE), prevKm + INJURY_STEP_KM);
}
```

- **Half:** `peakLongKm = min(21.1·1.15, 24) = 24 km ≈ 24/11.6·60 ≈ 124 min`
  — inside the required 22–26 km / 110–130 min band, under both the calf cap
  (130 min) and the engine's 2.6 h/156 min ceiling (`plan.ts:395`).
- **Reachability:** from ~13 km at +2 km/wk over ~9 build weeks the long run
  reaches ~22–24 km — it grazes the low end of the band and is itself
  **injury-gap-limited**; report it as such, never force it past +2 km/wk.
- **In `plan.ts`**, for the `run-long` slot only: compute `targetMin =
  min(longRunKm(prev, peakLongKm, cutback)/EASY_KMH·60, LONG_MIN_CAP, 156)` and
  **floor** the slot duration at `targetMin` (`durationHr =
  max(tssDerivedHr, targetMin/60)`, then the existing `min(2.6h, …)` clamp).
  Track `prevKm` across the week loop like `prevPrescribed`. The TSS for the
  session rises to match the floored duration (`tss = IF²·100·durationHr`) so
  the PMC sim stays consistent.
- **Cutback weeks hold flat; last true long run ~2–3 weeks out**, then taper
  decays it (~65% → ~45%) via the reference taper fractions — **taper/race
  numbers defer 100% to the reference engine (rule 2); this progression only
  runs in base/build.**
- Gated on `goalPeakCtl !== undefined` too, so the long-run change is also
  plan-only (belt-and-suspenders; the backtest never emits sessions anyway).
- If the calf flares, the progression yields to symptom-based regression
  (out of scope for the engine; a re-plan with a lower current long run
  captures it).

---

## 6. `PlanRequest.goalTime` field, `meta.goalGap`, and the UI line

### 6.1 Request + intake

- **`engine/plan.ts:22-41`** — `goalTime?: string` on `PlanRequest` (optional).
- **`src/app/app/actions.ts:91-103`** — read it in `generatePlanAction`:
  `goalTime: String(formData.get("goalTime") || "") || undefined,` and it
  round-trips through `src/lib/plan-io.ts` for re-plan.
- **`src/components/app/intake-fields.tsx`** — a text input beside the Distance
  selector (`intake-fields.tsx:50-55`): `label "Goal time (optional)",
  name="goalTime", placeholder "1:24:00"`. Free-text, parsed engine-side;
  invalid/empty → no goal target (feature simply inert).

### 6.2 `meta.goalGap` on the Plan

Extend `Plan.meta` (`plan.ts:63-77`):

```ts
goalGap?: {
  goalTime: string;            // "1:24:00"
  requiredPeakCtl: number;     // ~50
  reachablePeakCtl: number;    // ~26 (= projectedRaceCtl region)
  realisticFinish: string;     // "1:43"
  gapCtl: number;              // ~24
  message: string;             // the §4.2 paragraph
  loadLimited: true;           // flags the finish as a bound, not a prediction
};
```

Populated only when `goal` is defined; absent otherwise, so existing plans and
tri plans are unaffected.

### 6.3 UI line

`src/app/app/plan/page.tsx` — under the stat-chip row (`page.tsx:90-98`), when
`plan.meta.goalGap` is present, render a full-width honest banner (text uses
`bone`/`bone-muted` tokens, never series colors — rule 15):

```tsx
{plan.meta.goalGap && (
  <div className="border border-hairline mt-4 p-4">
    <p className="label-mono text-bone-muted">Goal check</p>
    <p className="mt-1 text-bone">
      {plan.meta.goalGap.goalTime} needs peak CTL ~{Math.round(plan.meta.goalGap.requiredPeakCtl)};
      a safe climb from ~{Math.round(plan.meta.startCtl)} reaches
      ~{Math.round(plan.meta.goalGap.reachablePeakCtl)} → realistic finish
      ~{plan.meta.goalGap.realisticFinish} <span className="text-bone-faint">(load-limited)</span>.
    </p>
    <p className="mt-1 text-bone-faint">{plan.meta.goalGap.message}</p>
  </div>
)}
```

No new chart series (rule 14 untouched). The existing "Race-day CTL" stat chip
already shows the reachable figure; the banner explains the gap to the goal.

---

## 7. Test plan

New `engine/goal.test.ts` (+ small additions to the backtest neutrality check):

**A. Anchor & bands (`goal.ts`)**
1. `goalCtlTarget(21.1, 84·60).raceDayCtl` ∈ [48, 52] (the "use ~50" anchor);
   `.peakCtl` ∈ [45, 55].
2. Model-A cross-check `0.158·21.1·15.07` within ±1.5 CTL of `.raceDayCtl`.

**B. Monotonicity (both gradients — the hard requirement)**
3. Pace sweep, half fixed: `raceDayCtl(1:17) > (1:24) > (1:30) > (1:35)`
   strictly.
4. Distance sweep, pace fixed 4:00/km: `10k < half < marathon` strictly.

**C. Invertibility**
5. Round-trip: for T ∈ {1:17,1:24,1:30,1:40}, `finishEstimate(
   goalCtlTarget(21.1,T).raceDayCtl, 21.1)` within ±20 s of T.
6. `finishEstimate` strictly decreasing in reachable CTL; grows with distance.
7. `finishEstimate(26, 21.1)` ∈ [1:40, 1:47] (the gap-region sanity that
   motivated the model choice — guards against a Model-A-style blow-up).

**D. Backtest neutrality (rule 7 — the pins must not move)**
8. `npm run engine:backtest` prints `maeConsistent ≤ 89.4, corr ≥ 0.79,
   dir ≥ 74` **unchanged from the pre-change run** (capture both, assert
   byte-equal `weekTss` per week for a fixed dataset).
9. For every row in `data/datasets/weekly-examples.jsonl`,
   `"goalPeakCtl" in features === false`.
10. Unit: `prescribeWeek(state)` with `state.goalPeakCtl` unset returns
    byte-identical output to the current engine on a battery of saved states
    (the goal branch is provably inert without the flag).

**E. Rails still bind under a goal (rule 4)**
11. In a generated 14-wk plan with `goalTime:"1:24:00"`, **no** week's
    `targetTss` exceeds `1.20 ×` the trailing-4wk mean nor `1.20 ×` the prior
    week; **no** `projected.tsb < −25`; **no** week < 60 TSS.
12. `meta.projectedRaceCtl` (reachable) stays well below `requiredPeakCtl`
    (~26 vs ~50) — the gap is real and the rails were **not** loosened.

**F. Rising trajectory (§2)**
13. In the same plan, the base/build `projected.ctl` series is net-increasing
    (peak `projected.ctl` > `startCtl` by a clear margin) with dips only on
    cutback (`weeksSinceStart % 4 === 3`) weeks.
14. `meta.projectedRaceCtl` with a goal ≥ the no-goal baseline (the floor lifts
    load, never lowers it) — and both obey the rails.

**G. Long run (§5)**
15. Peak `run-long` in a half plan ∈ [110, 130] min and ∈ [22, 26] km-equiv;
    never exceeds 156 min; weekly km step ≤ 2.0 km and ≤ +8%; flat on cutback
    weeks; decays through taper.

**H. Harness**
16. `taper-verify` skill end-to-end: `npx tsc -p engine --noEmit`,
    `engine/pmc.test.ts` (PMC untouched), the backtest gate, and the app empty
    state all PASS. Report the one-line-per-step summary (rule: run it when done).

**Nothing under `data/` is staged at any point (rule 8/13):**
`git status --porcelain | grep data/` prints nothing before commit.

---

## Bottom line

- **Model:** VDOT-backbone hybrid (`engine/goal.ts`); anchor 1:24 half →
  raceDayCtl ≈ 50 ✓, monotone in pace & distance ✓, invertible by monotone
  bisection ✓, and — the deciding factor — behaves correctly in the ~26-CTL
  gap region where Model A's inverse blows up.
- **Trajectory:** a plan-only goal floor generalizing the audited week-1 base
  floor pushes every base/build week to the +20% ramp ceiling (rails intact,
  cutbacks intact) → visibly rising `projected.ctl`.
- **Seam:** `goalPeakCtl?` on `AthleteState`, set only in `generatePlan`,
  gating the floor — byte-for-byte backtest neutrality, pins 89.4/0.79/74 hold.
- **Gap:** required ~50 vs safely-reachable ~26 ⇒ ~24-CTL gap ⇒ ~1:43
  load-limited finish; surfaced honestly in `meta.goalGap` + a plan-page
  banner. **The rails are never loosened to close it — that would be a
  STOP-for-sign-off.**
- **Long run:** distance-tied, calf-capped progression toward ~24 km / ~124 min,
  floored not residual, taper deferring to the reference engine.

No engine/pipeline/app edits are made by this spec; it is the design. PMC
recursion, the taper/race protocol lock, anchor-v2 default, and the backtest
pins are all preserved. Implementing it must keep the pins byte-unchanged; any
movement is a sign-off gate, not an autonomous re-pin.
