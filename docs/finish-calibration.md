# Finish-time calibration — history/ceiling-aware personal model

Status: **design spec, no feature edits yet.** Scope is the CTL→finish-time
mapping only (`engine/goal.ts finishEstimate`, consumed by
`engine/plan.ts buildGoalGap`). This is **display/gap-only**: it feeds
`meta.goalGap.realisticFinish`, nothing else.

## What is and is not touched (gate-risk audit)

Verified against the worktree:

- `finishEstimate` has exactly one production caller — `buildGoalGap`
  (`engine/plan.ts:617`), which fills `goalGap.realisticFinish`. Everything
  else is `engine/goal.test.ts`.
- The **LOAD model is correct and stays**: `goalCtlTarget` (required-CTL from
  goal pace, `engine/goal.ts:80`) is unchanged. Its only prescription use is
  `engine/plan.ts:368` → threaded as `goalPeakCtl` → learned-layer goal floor.
  We do **not** touch it. Reachable peak CTL ~22 stays as-is.
- The **backtest never calls `generatePlan`** (comment at `engine/plan.ts:362`;
  `goalPeakCtl` "never touches the backtest"), so `finishEstimate` cannot enter
  `npm run engine:backtest`. **No baseline-regression gate risk** (taper-rules
  rule 7). PMC recursion (rule 6), anchor-v2, and goal-backed periodization are
  all untouched.
- `data/` is read-only via symlink; `git status --porcelain | grep data/`
  prints nothing (rule 13). Nothing under `data/` is staged.

Consequence for tests (implementation-phase, not this doc): `goal.test.ts` C5
(round-trip `finishEstimate∘goalCtlTarget`), C6a (monotone-decreasing in CTL),
and **C7** (`finishEstimate(26, half) ∈ [1:40, 1:47]`) encode the *generic*
curve. C7's band is exactly the miscalibration this spec fixes — those cases
will be re-pinned to the personal-anchored model, with the generic assertions
moved behind the no-personal-races fallback.

## The bug

Current `finishEstimate` treats CTL as *total* fitness and inverts the generic
Daniels-VDOT-from-weekly-volume chain. At the reachable ~CTL 22 it returns
**~1:52** for the half. But this athlete **ran 1:31 in May 2026 at a lower CTL**
and holds a **1:17 PR**. Predicting 1:52 at equal-or-higher CTL than a race
already run is a validation failure: it contradicts demonstrated performance.

Root cause: the generic curve has no *durable-ability / neuromuscular-ceiling*
term. CTL is recent aerobic support, not the whole athlete. A runner with years
of base and a fast PR retains most of that ceiling through a low-CTL trough
(detraining costs VO2max slowly); the finish is bounded by that ceiling, not by
raw CTL.

## Located race anchor points (from the corpus)

CTL-at-race uses the existing labeling convention (`ctlAtRace = pmc.ctl` for the
race date, `pipeline/lib/label.ts:87`) — the same-date row of
`data/derived/pmc.csv`, read via `getPmc`.

| date       | event          | dist (km) | finish | CTL@race | VDOT | source |
|------------|----------------|-----------|--------|----------|------|--------|
| 2026-05-03 | half (training)| 21.29     | 91:42  | **17.6** | 50.5 | `sessions.jsonl` id `3716169274`, tss 140.44; pmc 2026-05-03 |
| 2023-11-05 | half **PR**    | 21.07     | 77:15  | **67.3** | 60.7 | `sessions.jsonl` "Pacing Strategy" leg, tss 164.25; pmc 2023-11-05 |

Notes:
- The **1:31 @ ~CTL 20** ground-truth point is the 2026-05-03 run: 21.29 km in
  91:42 (4:18/km). Normalized to 21.1 km it is ~90:50 ≈ **1:31**. Labeled
  CTL 17.6 (entering-day CTL was 14.6; the surrounding May–Jun block peaked
  CTL ~22–24, which is the loose "~20" of the ground truth). We anchor on the
  labeled same-day 17.6 for convention-consistency; the invariant holds for any
  choice in 14.6–17.6 (all ≤ the reachable 22).
- The **1:17 PR** is 2023-11-05, 21.07 km main leg in 77:15 at CTL 67.3. This is
  the fast ceiling.
- `data/derived/races.jsonl` contains only *detected* multi-leg (bike/tri) race
  days — **neither half-marathon run is in it**, and the 1:31 is **not** in
  `athlete-context.json keyPerformances` (only the 1:17 is). **Action for the
  implementation phase:** add the 2026-05-03 1:31 to `keyPerformances` as an
  anchor with its looked-up CTL 17.6 (and, ideally, generalize anchors to carry
  `distanceKm` + `ctlAtRace` so the model can consume them directly). Health
  data stays out of git; `athlete-context.json` is already gitignored.

## The model — personal-anchored, ceiling-saturating VDOT curve

Work in **VDOT space** (normalizes across race distances). An athlete anchor is
`A_i = (C_i, d_i, T_i)` → `V_i = vdot(d_i, T_i/60)` using the existing `vdot`.

**1. Ceiling (durable neuromuscular term).** The best VDOT the athlete has shown,
degraded gently for age (detraining retains most of VDOT):

```
Vceil = V_best · (1 − δ · yearsSince(best)),   clamped to Vceil ≥ 0.90 · V_best
δ = 0.02 / yr        (≈2% VDOT loss per year off peak, floored at 10% total)
```

Here `V_best = 60.7` (the 1:17 PR), `yearsSince ≈ 2.67` → `Vceil ≈ 57.5`.

**2. Support curve (recent aerobic term).** Attainable VDOT rises with CTL and
**saturates toward the ceiling**:

```
V(C) = Vceil − (Vceil − V0) · exp(−C / λ)
```

- `V0 = f0 · Vceil` — the deep-detrained floor at C=0 (`f0 = 0.72`).
- `λ` (CTL scale) is fit so the curve passes **exactly through the recent
  anchor** (reproduces the real 1:31):

```
λ = −C_recent / ln( (Vceil − V_recent) / (Vceil − V0) )
```

  With `C_recent = 17.6, V_recent = 50.5, Vceil = 57.5, V0 = 41.4` → `λ ≈ 21.2`.
  If the athlete has **≥2** non-ceiling recent anchors, fit `(V0, λ)` by least
  squares through them instead of assuming `f0` (curve stays monotone/saturating).

**3. Finish.** `modelTime(C, d)` = the `t` solving `vdot(d, t) = V(C)`, via the
existing monotone bisection in `finishEstimate` (vdot strictly decreasing in t).

Resulting personal half-marathon curve (this athlete):

| CTL  | 0     | 10    | 17.6  | 20    | **22**    | 25    | 30    | 67.3  |
|------|-------|-------|-------|-------|-----------|-------|-------|-------|
| half | 1:47  | 1:35  | **1:31** | 1:30 | **1:29** | 1:28  | 1:26  | 1:22  |

Reproduces **1:31 at the recent anchor**, gives **~1:29 at the reachable CTL 22**
(a touch faster for the extra CTL + taper freshness), and never returns the old
1:52. Contrast: the generic curve gave 1:52 at CTL 22.

**4. Fallback.** If the athlete has **no** race anchor with a known CTL, use the
**current generic `finishEstimate` body unchanged** (VDOT-from-reachable-CTL via
the `goalCtlTarget` inverse). Personal calibration only activates with ≥1
real race point.

## Hard invariant and how it is guaranteed

> **INVARIANT.** The projected finish at CTL = C, distance d, must never be
> **slower** than any actual race the athlete ran at CTL ≤ C.

Enforced by a **clamp on top of the model** — not by trusting the curve:

```
finishEstimate(C, d) = min(
    modelTime(C, d),
    min over anchors A_i with C_i ≤ C  of  Teq(A_i, d)
)

Teq(A_i, d) = finish(d, V_i)         # A_i's performance at distance d, equal-VDOT
                                     # (for a same-distance race, Teq = T_i)
```

Why it holds: for every real race `A_i` with `C_i ≤ C`, the result is `≤ Teq(A_i, d)`,
which is exactly `A_i`'s own VDOT-equivalent time at distance d. So the projection
can never be slower than a demonstrated performance at equal-or-lower CTL. The
`min` makes this true **regardless** of any model miscalibration or extrapolation.

- At reachable **CTL 22**: the only anchor with `C_i ≤ 22` is the 1:31 @ 17.6, so
  the clamp caps the half at **≤ 1:31**; the model's 1:29 passes. The PR anchor
  (C=67.3) does **not** bind here (67.3 > 22), so the clamp does not force 1:17 —
  it only sets the *ceiling the curve saturates toward*, never a hard prediction.
- Because the recent anchor lies **on** the curve and `V(C)` is monotone
  increasing, `modelTime` already satisfies the invariant for that anchor; the
  clamp is the belt-and-suspenders that also covers the fallback path and any
  future anchors.

**Goal-pace clamp preserved.** The caller keeps
`Math.max(goalSec, finishEstimate(C, d))` (`plan.ts:617`), so the surfaced
realistic finish is still never reported *faster* than the stated goal. Honest
gap is retained: a **1:24** goal still shows a real gap (reachable curve tops out
~1:29 at CTL 22 — more base than 14 weeks builds), while the **realistic finish is
anchored to demonstrated performance (~1:29–1:31), not raw CTL**.

## Implementation surface (next phase, not done here)

1. Generalize the athlete anchor source: carry `{date, distanceKm, timeSec,
   ctlAtRace}` per race (add the 1:31 to `keyPerformances`; look CTL up via
   `getPmc`). Keep it gitignored.
2. Rewrite `finishEstimate(C, d)` per §§1–4 with the fallback; add the §clamp.
3. Re-pin `goal.test.ts` C5/C6/C7 to the personal model; move the generic
   assertions behind the no-anchors fallback. Add an invariant test:
   `finishEstimate(C, half) ≤ min Teq over anchors with CTL ≤ C` for a sweep of C.
4. Leave `goalCtlTarget`, the LOAD model, PMC recursion, anchor-v2, and the
   backtest untouched. Run the taper-verify skill; the backtest baseline is
   unaffected because `finishEstimate` is not on that path.
