# The Taper engine — complete algorithm reference

This document is the single self-contained description of how Taper turns an
athlete's history into a season plan. It is written so that someone (or some
model) with *no prior context* can understand every layer, know exactly which
parts are load-bearing, and extend the engine without breaking what has been
validated. Read it top to bottom once; after that, §9 (seams) and §12 (recipe)
are the parts to re-read before touching code.

Repository map for everything referenced here:

| Layer | File | Role |
|---|---|---|
| 0 | `engine/types.ts` | `AthleteState`, `WeekPrescription`, workout block types |
| 0 | `engine/seed.ts` | roll daily PMC forward to a plan's start morning |
| 1 | `engine/reference.ts` | rule-based weekly prescription (the scaffold) |
| 2 | `engine/learned.ts` | ridge regression + anchor-v2 rails (taper-v1) |
| 3 | `engine/plan.ts` | `generatePlan`: weeks → slots → sessions → PMC sim |
| — | `engine/goal.ts` | VDOT, goal→CTL target, volume floors, long-run progression |
| — | `engine/intensity.ts` | 3-zone model, distribution accounting |
| — | `engine/tissue.ts` | structured injury-constraint model |
| — | `engine/history.ts` | base-richness → per-athlete ramp ceiling |
| — | `engine/zones.ts` | thresholds → pace/HR/power zones |
| — | `engine/backtest.ts` | walk-forward replay; produces the pinned metrics |
| — | `engine/invariants.ts` | plan acceptance harness (I1–I9) |
| — | `engine/*.test.ts` | per-feature pinning tests (see §10) |

---

## 1. What the system is

Taper is a **load-management and training-design engine** for endurance
athletes. Its core loop:

1. Model the athlete's fitness with the **Performance Management Chart (PMC)**
   impulse-response model (§2).
2. Prescribe next week's total training load (TSS) with a **rules scaffold**
   (§4) personalized by a **small learned layer** (§5) that may only act
   *inside* the scaffold's physiological rails.
3. Expand weekly loads into **concrete daily sessions** with paces, structure,
   and honest rationale (§6).
4. **Simulate** the plan through the same PMC model to project race-day
   fitness, and tell the athlete the truth about whether their goal is
   reachable (§7).

Design philosophy, in order of precedence:

- **Physiology is rails, learning is a pilot.** The learned layer never
  overrides taper protocol, TSB floors, or ramp caps.
- **Evidence honesty.** Every claim in athlete-facing copy carries an evidence
  tier (`rct` / `observational` / `elite practice` / `our best guess`), and a
  lint (engine/evidence.ts) fails the build if copy says "research shows"
  without the tier to back it.
- **Byte-neutrality.** Every optional feature must produce *byte-identical*
  output when its input signal is absent. This is what makes the system safe
  to extend: a feature that cannot change existing behavior cannot regress it.
- **The backtest is the referee.** A pinned walk-forward replay (§10) must not
  move unless a change is *supposed* to move it, with sign-off.

---

## 2. Layer 0 — the PMC recursion (NEVER TOUCH)

Fitness is modeled by two exponentially-weighted moving averages of daily TSS
(Training Stress Score):

```
CTL_today = CTL_yesterday + (TSS_today − CTL_yesterday) / 42     # "fitness", τ=42d
ATL_today = ATL_yesterday + (TSS_today − ATL_yesterday) / 7      # "fatigue", τ=7d
TSB       = CTL_yesterday − ATL_yesterday                        # "form" (yesterday's values!)
```

Three facts a maintainer must internalize:

- **The time constants 42 and 7 are never tuned.** They are the standard
  Coggan/TrainingPeaks constants; the entire corpus, the backtest pins, the
  dashboard's Today header, and the mobile app all assume them. The recursion
  is written out in **five** places — the full list lives in §9 seam 1 —
  always as the same literal recursion, deliberately duplicated rather than
  abstracted so a "refactor" can't quietly change one copy.
- **TSB uses *yesterday's* CTL−ATL** (the TrainingPeaks convention): the form
  you wake into, not the form after today's workout.
- **Useful identities.** Holding daily TSS `t` for a week moves CTL by
  ≈ `(t − CTL)/6`. Therefore weekly TSS to gain `g` CTL points/week is
  `7·(CTL + 6g)`, and *maintenance* (CTL flat) is `CTL × 7` weekly TSS. These
  two formulas power almost every prescription rule below.

## 3. Seeding — where a plan starts (`engine/seed.ts`)

`seedStateAt(base, dailyPmcSeries, startDate)`:

1. Take the last daily PMC row **strictly before** startDate (the anchor —
   the last day backed by real logged data).
2. Roll CTL/ATL forward across the unlogged gap with the **zero-load**
   recursion (each missing day decays fitness: `ctl += (0−ctl)/42`).
3. Merge into `base` (which supplies non-PMC features: `last4WeeksTss`,
   discipline shares, `weeksSinceStart`, …) and report provenance
   (`anchorDate`, `zeroLoadDays`) so the UI can say how much of "today's
   fitness" is real data vs decay.

Why this exists: seeding from the last *weekly* training example froze
features at that week's Monday — observed error: plan seeded TSB −10.4 while
the athlete's real header read +2.5. Rule: **plan seeds and the Today header
must come from the same daily series.**

## 4. Layer 1 — the reference engine (`engine/reference.ts`)

Classical periodization as ~120 lines of transparent rules. This is both the
baseline the learned layer must beat *and* the safety scaffold it runs in.

**Phase selection** (`phaseFor`), first match wins:

| Condition | Phase |
|---|---|
| race ≤ 7 days away | `race` |
| race ≤ 21 days away | `taper` |
| no race in 120d AND (breakRatio < 0.6 OR ≥10 days off) | `offseason` |
| TSB < −25 | `recovery` (forced — the TSB floor) |
| every 4th week (`weeksSinceStart % 4 == 3`) | `recovery` (3:1 cutback rhythm) |
| race ≤ 84 days away | `build` |
| otherwise | `base` |

**Weekly TSS by phase** (`trailingMean` = mean of `last4WeeksTss`):

| Phase | Formula | Constants |
|---|---|---|
| base | `7·(CTL + 6·g)`, g = 1.2 (+0.3 if TSB > +12) | gBase=1.2 |
| build | same, g = 1.7 (+0.3 if fresh) | gBuild=1.7 |
| recovery | `7·(CTL + 6·(−1.5))` | gRecovery=−1.5 |
| taper 15–21d | `trailingMean × 0.80` | shed fatigue, keep fitness |
| taper 8–14d | `trailingMean × 0.65` | |
| race week | `trailingMean × 0.45` (excl. the race itself) | |
| offseason | `max(60, recent2WeekMean × 1.1)` | rebuild from *current* volume |

**Guardrails applied after:** non-taper weeks capped at `trailingMean × 1.15`;
absolute weekly floor 60 TSS. Discipline shares follow the athlete's
demonstrated mix, pulled 10–25% toward a 15/45/40 tri split only for genuine
multisport athletes during build/taper.

## 5. Layer 2 — the learned layer, taper-v1 (`engine/learned.ts`)

A deliberately small model: **ridge regression (λ=12) over 11 features**,
trained walk-forward (zero look-ahead) on the athlete's own executed weeks,
active after **24 observed weeks** — or from **week 0** when an explicit
**population prior** is supplied (refinement 2, `priorWeights` on
`PlanRequest`/`TaperV1Options`): weights start AS the prior and each observed
week refits ridge *centered on it* (fit the residual y − X·w0, add w0 back),
so per-athlete data shrinks toward the population instead of toward zero and
dominates as history grows. The artifact is fit by
`scripts/train-population-prior.ts` (`fitPriorFromExamples`, the same
featurize+ridge) into gitignored `data/models/population-prior.json`; callers
load it via `loadPopulationPrior()` — never auto-loaded inside `TaperV1`, so
the backtest can never see it. Features (`featurize`): intercept,
CTL, ATL, TSB, mean & slope of last-4-week TSS, breakRatio,
min(30, daysSinceLastSession), taper-window flag (≤21d), race-week flag (≤7d),
cutback-slot flag.

**Era weighting** (optional, corpus-only): if `data/app/athlete-context.json`
declares training eras, samples are weighted `era_weight × recency_decay`
(primary era ×2, half-life 156 weeks) so *capability* anchors on the athlete's
strongest block while *state* stays current. No context file ⇒ no weighting ⇒
bit-identical to the unweighted regression.

**The clamp cascade.** The raw regression output is never used directly. In
order (this ordering is load-bearing — see the rationale strings in code):

1. **Protocol lock:** taper and race weeks return the reference prescription
   untouched. The learned layer has no vote near a race.
2. **Phase bounds** `[lo, hi]` as fractions of trailingMean (e.g. base/build
   `[0.55, 1.20]`, recovery `[0.5, 0.95]`, race `[0.25, 0.6]`).
3. **Anchor-v2 ceiling** (base/build/offseason; the default since 2026-07-13):
   `anchor = max(CTL×7 maintenance, recent peak week decayed ×0.95/wk)`,
   capped at `rampCapRef × rampCap` where
   `rampCapRef = max(prev non-zero week, 0.7 × best of trailing 6)` (the 0.7
   term makes an outlier week's influence decay instead of vanish) and
   `rampCap` is per-athlete (§8, feature 3): 1.20 default, up to 1.30
   base-rich, floored at 1.0 so an acute-tissue 1.05 cap can bind.
   Recovery weeks additionally cap at `prev non-zero week × 1.2`.
4. **Week-1 base floor** (plan-only): first plan week, base/build, race ≤14
   weeks out ⇒ floor at `1.15 × max(CTL×7, decayedPeakWeek)` (refinement 6 —
   demonstrated capacity, the same `decayedPeakWeek` term the anchor-v2
   ceiling trusts), min-capped by the per-athlete ramp rails so it can never
   exceed the ceiling.
   Trigger is the explicit `isFirstPlanWeek` signal — the earlier proxy
   (`prevPrescribedTss === undefined`) leaked onto every backtest week and
   regressed the pins; that incident is the canonical example of why plan-only
   signals must be *explicit* fields (§9).
5. **Goal/volume floor** (plan-only): while `CTL×7 < floorTarget`, base/build
   weeks are lifted toward `floorTarget = max(goalPeakCtl×7,
   peakWeeklyTssFloor)`, min-capped at the per-athlete ramp ceiling. Auto-off
   once maintenance reaches the target (no overshoot past what the race
   needs). Both signals are absent on the backtest path ⇒ inert there.
6. **Week-over-week smoothing band** (plan-only, via `prevPrescribedTss`):
   consecutive prescriptions move at most `+rampCap%` / −35%.
7. **Absolute weekly floor:** 60 TSS.

Mental model: *the regression proposes, the rails dispose.* Every floor is
itself capped by the ramp rails, so no floor can ever out-rank a safety cap.

## 6. Layer 3 — plan generation (`engine/plan.ts` `generatePlan`)

Input: `PlanRequest {raceName, raceDate, raceType, daysPerWeek (4–7), longDay,
startDate?, goalTime?, tuneups?, tissueConstraints?, maxSessions?}`, an
`AthleteState` seed, history, and derived `Zones`. Output: `Plan {meta,
weeks[]}` with one `PlannedSessionOut` per training day.

Pipeline, in execution order:

**(a) Pre-loop derivation.**
- Parse `goalTime` → `goal.peakCtl` via VDOT (engine/goal.ts): race distance +
  goal time → VDOT → the weekly km / CTL a athlete of that VDOT typically
  holds, with taper retention 0.94. An implausible goal (< 140 s/km) is
  **inert**, not an error.
- Volume targets (feature 2): the km↔TSS bridge is the ATHLETE's
  (refinement 3): `cvolFor(vT) = IF·100/(vT·3.6)` at easy-mix IF 0.80, clamped
  [3.5, 9] — a 4:05 vs 6:00/km-threshold athlete pays 5.44 vs 8.00 TSS/km.
  `thresholdMpsFromZones` recovers vT from zones; `CVOL = 4.9` survives only
  as the zone-less fallback. Likewise all km↔duration conversions use
  `easyKmhFor` (0.80·vT) / `qualityKmhFor` (0.93·vT) with 11.6 / 12.4 as
  fallbacks (refinement 4) — construction and achieved-km measurement share
  one ruler (volume.ts takes the speeds as parameters). Evidence floors (`EVIDENCE_FLOOR`, Fokkema 2020, observational):
  e.g. run-half ⇒ ≥32 weekly km, ≥21 km longest run. `peakWeeklyTssFloor`
  feeds clamp №5 above; tissue weekly caps pull it down.
- Base richness (feature 3, engine/history.ts): logged history + historical
  peak CTL from race anchors → `richness ∈ [0,1]` →
  `rampCap = 1.1 + 0.2×richness`, intersected with any tissue `rampCeiling`.
  No history ⇒ `undefined` ⇒ default rail.
- Tissue caps (feature 4, engine/tissue.ts): each declared constraint caps
  only what its provocation justifies — rotation-provoked ⇒ `longRunKm`
  (16/24/30 by severity); volume-provoked ⇒ `weeklyKm`+`longRunKm`;
  speed-provoked ⇒ `maxSessionIntensity`; acute ⇒ `rampCeiling 1.05`. No
  constraint ⇒ `activeTissueCaps() = null` ⇒ everything downstream inert.
- Tune-up validation (§8, tune-ups): dates must be inside
  `[startDate, raceDate − 10d]`.
- Week anchoring: `mondayOnOrAfter(startDate)`, falling back to
  `mondayOnOrBefore` when the race is inside the current week; sessions dated
  before startDate are never emitted.

**(b) The weekly loop.** For each Monday until race day:
1. Assemble `AthleteState` from the running simulation (CTL/ATL as evolved so
   far, `last8` trailing prescriptions, plan-only signals: `isFirstPlanWeek`,
   `goalPeakCtl`, `peakWeeklyTssFloor`, `rampCap`, `prevPrescribedTss`).
2. `engine.prescribeWeek(state)` → phase + weekly TSS (§4–5).
3. **Budget:** race week (≤6 days to gun) trains on `max(40, 0.55×weekTss)`
   with the race consuming the rest; a tune-up week trains on
   `max(40, weekTss − tuneupTss)`.
4. **Slots** (`slotsFor`): a weekday template per phase/daysPerWeek — quality
   Tue, mid-week easy/tempo, strides Fri, long run on `longDay`, fillers by
   priority. Each slot has `{weekdayIdx, kind, weight}`.
5. **Slot transforms**, in order: drop post-race-date slots; race weeks keep
   only sharpeners (weights ×0.6, no long); drop longs inside the final 6 days
   before the gun (NOT redistributed — race proximity makes the week lighter
   on purpose); tissue intensity caps downgrade over-cap kinds
   (`capKindIntensity`); tune-up shaping (race-day slot dropped, day-before →
   openers, day-after → easy, rest of that week → easy). `totalWeight` is then
   summed over `active` normally but over the *surviving* slots in tune-up
   weeks — the one place dropped weight is renormalized (the race session
   returns that load; see the TU3d bug story in §12).
6. **Long-run progression** (goal run plans, base/build/recovery): the long
   run's *distance* is decoupled from weekly TSS — starts near
   `min(13km, 0.6×peak)`, steps ≤ +2 km/week toward the (tissue-capped) peak,
   flat on cutbacks, duration = km / easyKmhFor(vT) clamped ≤ 2.6 h, ≤60% of
   the week's TSS, and (refinement 5) ≤ **~35% of the week's running km**
   (`LONG_FRACTION_MAX`, closed form `long ≤ f/(1−f)·othersKm` with the other
   days priced at measurement speeds). When the rail conflicts with the
   Fokkema ≥21 km floor, `volumeTargets.longCappedByFraction` + goal-gap copy
   surface the tradeoff — `meetsLongFloor` is never fudged. Remaining TSS
   redistributes over the other slots so the week total still equals the
   prescription.
7. **Weekly-km tissue cap** (feature 5): if kept running km exceed
   `caps.weeklyKm`, convert lowest-priority easy days to **cross-training**
   (bike/pool) preserving the day and its load; if quality+long alone still
   overshoot, shrink them (`protectedScale`) and move the freed TSS onto the
   cross days. Total aerobic load holds; running impact drops.
8. **Session build:** each slot → dated session via its `TEMPLATE`, then
   (refinement 1) base/build run weeks are SHAPED to the phase Z1 target
   (±2%): TSS transfers between the quality session and an easy day, duration
   following under the build's own clamps; a duration-floored session can't
   donate (micro-weeks pass through byte-identical); the long run is never
   donor/recipient. Original build: (title,
   structure text + machine-readable `workout.blocks` built from zones,
   `why` rationale). TSS = `weight/totalWeight × trainable`, duration =
   `tss / (intensity² × 100)`, clamped to sane bounds (0.4–1.6 h easy,
   2.6 h run-long, 4.5 h bike-long).
9. Append race-day / tune-up race sessions (`discipline: "race"`, race TSS
   from `RACE_TSS`, e.g. run-10k 75, run-half 115).
10. **Simulate PMC day-by-day** through the emitted sessions — two
    accumulators: total CTL/ATL and **run-only** CTL/ATL (cross-training
    builds the engine, not the legs; only running load predicts running
    performance). Snapshot race-morning values when the loop crosses race day.

**(c) Post-loop meta.** Projected race CTL/TSB (run-specific when
cross-training made them diverge), volume targets vs achieved with
`meetsWeeklyFloor`/`meetsLongFloor`, tissue `why` strings, and the **goal
gap**: reachable finish = load-limited bound from the simulated race-morning
CTL through the athlete's personal VDOT curve (race anchors + detraining decay
0.02 VDOT/yr, floor 0.90×best), clamped never-faster-than-goal, with copy that
names *why* a floor was missed (tissue cap vs ramp runway) — never silently.

## 7. Honesty layer (feature 6)

- Every plate of athlete-facing copy carries an evidence tier; `evidence.ts`
  exports the tiers and a lint test asserts strong-claim phrases only appear
  with `rct` tags.
- The goal gap is a **bound, not a prediction** ("load-limited; sharp legs can
  beat it").
- Projections are labeled "from the generated plan, not measurements."
- The mobile session report refuses to display measured pace/HR because no
  measurements exist on-device yet (§13).

## 8. Feature seams — the six features + tune-ups

Every feature follows the same pattern (**the goalPeakCtl seam**): its input
is an *optional, explicit* field on `PlanRequest` or a plan-only field on
`AthleteState` set **only inside `generatePlan`**; absent ⇒ byte-identical
output; a dedicated test pins the neutrality.

| Feature | Signal | Mechanism | Neutrality pin |
|---|---|---|---|
| 1. Intensity distribution | (always on, run plans) | 3-zone model; base/build weeks CONSTRUCTED to the phase Z1 target ±2% (rct: Muñoz 2014), floor `z1FloorFor` = 0.85 base/build / 0.80 else | intensity + polarized.test.ts |
| 2. Volume floors | `goalTime` presence | `peakWeeklyTssFloor` in clamp №5; Fokkema floors surfaced as targets | volume.test.ts |
| 3. Ramp by richness | `rampCap` (from history) | per-athlete ceiling 1.10–1.30 in every rail | history.test.ts (E11a/T5) |
| 4. Tissue constraints | `tissueConstraints[]` | targeted caps (§6a), never prophylactic | tissue.test.ts (TT7 byte-identity) |
| 5. Cross-training | tissue `weeklyKm` cap | day-preserving substitution + run-only CTL fork | crosstrain.test.ts |
| 6. Evidence honesty | (always on) | tiers + lint | evidence.test.ts |
| Tune-ups | `tuneups[]` | week reshaping + budget absorption (§6b.3/5) | tuneup.test.ts (TU1) |

## 9. THE SACRED SEAMS — what must never change

A weaker model working on this codebase should treat these as hard
constraints. Violating any of them is a rejected change, full stop.

1. **The PMC recursion** (τ=42/7, TSB convention) — never tuned, never
   abstracted. It is written out in **five** places, and all five must stay
   literally identical: `engine/plan.ts` (the plan's week simulation),
   `engine/seed.ts` (roll-forward to the seed date, including the gap loop
   every surface's fitness state now routes through), `engine/replan.ts`
   (`resimulateProjected`), `pipeline/lib/derive.ts` (the corpus daily
   series) and `src/lib/strava-data.ts` (the no-corpus Strava estimate).
   Mobile carries NO copy: its two private replays (`executedDailyPmc` and
   an inline loop in `evidenceSeedState`) were deleted on 2026-08-06 — they
   filled uncovered days with zeros nothing had vouched for, they disagreed
   with each other by one day, and one of them was never on this list at
   all. That is the standing lesson of this count: the doc claimed "three"
   until 2026-08-05 and "six" until 2026-08-06, and each undercount hid a
   copy that could drift. Adding a copy anywhere is a rejected change:
   thread `engine/seed.ts` (state seeding) or one of the other listed
   functions instead.
2. **The backtest path must not see plan-only signals.**
   `engine/backtest.ts` replays corpus rows through `prescribeWeek` directly.
   Any new behavior gated on a field that backtest rows don't carry is safe;
   any behavior triggered by a *proxy* (absence of a field, a default) will
   leak. The week-1 floor leak (§5.4) is the cautionary tale.
3. **The pinned backtest numbers**: `maeConsistent ≤ 89.4`, `corr ≥ 0.79`,
   `dir ≥ 74` (currently 89.4 / 0.79 / 75, byte-stable across 20+ commits).
   `scripts/verify.sh` fails if they move. If a change is *supposed* to move
   them, that requires explicit human sign-off and a new pin.
4. **Taper/race protocol lock**: the learned layer and every floor return
   before touching weeks ≤21 days from a race.
5. **Rails outrank floors**: every "lift" (base floor, goal floor) is
   min-capped by the ramp rails. New floors must follow the same shape.
6. **Byte-neutrality of optional features**: absent signal ⇒
   `JSON.stringify`-identical plans (modulo `meta.generatedAt`, the one
   legitimate nondeterministic byte).
7. **Noon-UTC date anchoring** (`T12:00:00Z`) everywhere dates are parsed;
   `localToday()` is a *local calendar string* compared lexically. No other
   date arithmetic pattern is permitted (DST bugs).
8. **Honesty invariants**: no fabricated measurements, no untiered claims, no
   silently dropped targets.

## 10. Verification — the gauntlet

`bash scripts/verify.sh` (also the pre-commit hook) runs, in order: privacy
check (nothing under `data/` staged) → `tsc` ×3 (app, engine, pipeline) →
eslint → **engine tests** (pmc, goal, raceday, replan, intensity, tissue,
volume, history, crosstrain, evidence, tuneup — ~160 assertions) → app tests →
**invariants** (I1–I9: no sessions after the gun, daysPerWeek hard cap,
mid-week signup, Monday-race sharpeners, taper tapers + race TSB ∈ [0,20],
human-bounded durations/loads, unique (date,title), finite JSON) →
pipeline → phase0 gate (CTL MAE ≤ 2.0) → **backtest pins** → `next build`.

Every commit must pass the whole gauntlet. There is no "small change"
exemption — the gauntlet *is* the definition of done.

## 11. Calibration fixture (the real athlete)

The corpus athlete the engine is calibrated against (useful for sanity checks;
exact values in `data/`, gitignored):

- Current CTL ≈ 14–17 (recent reduced-volume era), historical peak ≈ 76
- 1:31 HM @ CTL 17.6 · 1:17:45 HM PR @ CTL 67.3 (the personal VDOT curve
  anchors, with era weighting ×2 on the peak block)
- Threshold ≈ 4.08 m/s (≈4:05/km), LTHR 175
- Calf tendon constraint historically active (rotation-provoked ⇒ long-run cap)
- Typical request: 5 run days/week, Sunday long run, 14–16-week runway

Sanity expectations: a goal implying race-day CTL far above what the runway
supports must produce an honest gap (e.g. goal 1:30 from CTL 14 over 13 weeks
⇒ "~1:43 load-limited"), never a plan that pretends.

## 12. How to add a feature safely — the recipe

1. **Write the tests first** (`engine/<feature>.test.ts`, tsx script, exit
   code = failures — copy the harness from `tissue.test.ts`). The FIRST test
   is always neutrality: signal absent ⇒ `stable(plan)` byte-identical, where
   `stable` nulls `meta.generatedAt`.
2. **Add the signal as an explicit optional field** on `PlanRequest` (user
   intent) or as a plan-only `AthleteState` field set *only* inside
   `generatePlan` (derived intent). Document "ABSENT ⇒ byte-identical" in the
   field's doc comment. Never trigger on a proxy or a default.
3. **Implement at the narrowest layer**: copy → plan meta; weekly load →
   a clamp in `learned.ts` (min-capped by the rails, placed in the cascade
   order of §5); daily structure → slot transforms in `plan.ts`.
4. **Run the feature tests, then the full gauntlet.** The backtest pins are
   the last word.
5. **Wire the test into `package.json` `engine:tests`.**

Known traps (each has bitten once):

- **Weight renormalization.** `totalWeight` is summed over `active` slots;
  later filters (`placed`) deliberately do NOT redistribute (pre-race long
  drop). If your feature removes a slot whose load should *return* elsewhere,
  you must renormalize explicitly and only under your signal (see tune-ups:
  weeks came out ~50 TSS light until TU3d caught it).
- **Proxy leaks.** `prevPrescribedTss === undefined` is true on every backtest
  row. Explicit signals only (§9.2).
- **`meta.generatedAt`** breaks naive byte-comparison; strip it in tests.
- **Engine weekdays are `"Mon".."Sun"`** (3-letter, capitalized) — UI code
  matching on full names silently fails.
- **PMC ripple.** Changing any week's daily pattern shifts later weeks'
  prescriptions by a few TSS through simulated CTL. Structural assertions on
  later weeks must compare shape (digit-stripped titles, dates) with a small
  TSS tolerance, not bytes.
- **Session titles embed minutes** ("Easy 50") — they are load, not structure.
- **expo/web note** (mobile): module-scope storage access crashes
  expo-router's node render; hydrate lazily on first subscribe.

## 13. Where the algorithm is weakest — improvement map

Ranked, with the constraint that every improvement must keep §9 intact:

1. **Execution feedback (replan loop) — BUILT on the dashboard path; do not
   re-implement.** `engine/replan.ts recomputeRemaining` folds executed weekly
   TSS into the remaining plan behind an explicit opt-in input (`ReplanInput`
   ledger — `generatePlan` itself is untouched): missed volume is never
   redistributed forward (T5 pins no cramming), an overshoot week damps the
   next to protect form, 3 consecutive overshoots re-baseline capacity upward
   and reproject the goal, 2 consecutive ≥40% undershoots surface an honest
   recalibration card, a hard over-cap week forces recovery at maintenance,
   and the 2-week taper is an invariant (throws if compressed). 18 pinned
   assertions in `replan.test.ts`; the backtest never imports replan (N1).
   What remains is EXPOSURE, not engine work: the mobile app has no replan
   trigger, and the dashboard's is manual — a weekly auto-reconcile
   surface is the actual open item.
2. **The learned layer is athlete-count = 1.** The ridge regression is honest
   but trained on one athlete's corpus. Multi-athlete training needs a data
   pipeline and per-athlete normalization (features are already
   scale-relative: TSB, ratios, slopes) — the model form can stay tiny.
3. **Within-week placement is template-only.** `slotsFor` is a fixed weekday
   template; it ignores e.g. athlete's historical day-of-week compliance.
   A learned placement layer is safe because daily placement can't violate
   weekly rails.
4. **No readiness signal.** HRV/sleep/subjective inputs could modulate the
   *daily* session (swap quality→easy) without touching weekly load — a clean
   new seam.
5. **Goal model is VDOT + personal anchors.** Fine for running; the tri race
   types have cruder `RACE_TSS`/finish estimates. More anchor types
   (recent race results via import) would sharpen `finishEstimate`.
6. **Uncertainty is verbal, not numeric.** "Load-limited bound" could carry an
   interval derived from anchor-fit residuals.
7. **Backtest breadth.** One corpus, 3 pinned metrics. Adding held-out season
   replays (predict-then-reveal by year) would make the pins much harder to
   overfit.

## 14. Glossary

| Term | Meaning |
|---|---|
| TSS | Training Stress Score — one workout's load (100 ≈ 1 h at threshold) |
| CTL | Chronic Training Load — 42-day EWMA of daily TSS ("fitness") |
| ATL | Acute Training Load — 7-day EWMA ("fatigue") |
| TSB | Training Stress Balance — yesterday's CTL−ATL ("form") |
| IF | Intensity Factor — session intensity relative to threshold; TSS/h = IF²×100 |
| VDOT | Daniels' aerobic capacity number linking race times across distances |
| CVOL / cvolFor | athlete km↔TSS bridge (IF·100/(vT·3.6)); 4.9 is the zone-less fallback |
| Trailing mean | mean of `last4WeeksTss` — the ramp/bound reference |
| Maintenance | `CTL × 7` weekly TSS — holds CTL exactly flat |
| Anchor-v2 | the peak-decay load ceiling replacing raw trailing-mean (§5.3) |
| B-race / tune-up | intermediate race absorbed into the plan (§8) |
| Seam | an optional explicit signal whose absence guarantees byte-identity |
| The gauntlet | `scripts/verify.sh` — the full verification suite |
| The pins | backtest numbers frozen in verify.sh (89.4 / 0.79 / 75) |
