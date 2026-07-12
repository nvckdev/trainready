---
name: taper-rules
description: Non-negotiable invariants for changing Taper's engine/, pipeline/, or src/app/app code — safety rails, conventions, and the traps already hit once. Load BEFORE editing any of those directories. Every rule here exists because its violation was observed to break something.
---

# Taper engineering rules

Each rule states the invariant, why it exists, and how it's checked. When a
requested change conflicts with a rule, implement the change WITHOUT breaking
the rule, and say which rule constrained you. None of these are style
preferences.

## Engine (engine/)

1. **Every engine speaks `AthleteState → WeekPrescription`** (engine/types.ts)
   and every prescription carries a non-empty `rationale`. New engines
   implement the `Engine` interface; nothing downstream may special-case an
   engine by name. Check: `npx tsc -p engine --noEmit`.
2. **The taper is protocol, not preference.** For phases `taper` and `race`,
   learned/heuristic layers defer 100% to the reference engine's numbers
   (see the early-return in engine/learned.ts). Violation symptom already
   observed: race-morning TSB −3.4 instead of +9.5. Check: invariants I5b.
3. **Walk-forward only.** Learned components may only train on weeks strictly
   before the week being prescribed (`observe()` AFTER `prescribeWeek()` in
   any replay loop). Look-ahead makes the backtest a lie. Check: in
   engine/backtest.ts the `v1.observe(...)` call stays AFTER the prescribe
   loop body for that example.
4. **Safety rails are hard limits, not tunables:** weekly ramp cap ≤ +15% or
   +20% over trailing-month mean, TSB floor −25 forces recovery, weekly
   floor 60 TSS, learned outputs clamped into phase bounds
   (engine/learned.ts `bounds()`). Loosening any of these requires the
   human's explicit sign-off in the conversation — do not infer consent.
5. **Race-morning TSB is measured BEFORE race-day load** in the plan
   simulation (engine/plan.ts `raceMorning` capture). Off-by-one here
   inverts the freshness story. Check: invariants I5b.
6. **PMC constants are physiology, not parameters:** CTL τ=42, ATL τ=7,
   TSB = yesterday's CTL−ATL (TrainingPeaks convention, validated to
   CTL MAE 0.20 against TP itself). Never "tune" them to improve a metric.
   Check: `grep -n "42\|/ 7" pipeline/lib/derive.ts` unchanged, and the
   phase0 gate stays PASS.
7. **Backtest baselines never regress** (taper-v1: consistent-week MAE
   ≤ 88.2, corr ≥ 0.80, direction ≥ 74; single source of truth is
   scripts/verify.sh). Run `npm run engine:backtest` after any engine
   change. Re-pinning is allowed only with a stated reason in the commit
   message (precedent: 2026-07-12 taper protocol-lock).

## Pipeline (pipeline/)

8. **Raw is immutable.** Stages only READ data/raw; all repair (dedupe,
   inference, estimation) happens downstream and is re-runnable. Never edit
   a raw JSON in place.
9. **Dedupe by workout id keeping the richest record** — overlapping
   extraction windows are a feature. Symptom of breaking this: phase0
   CTL MAE explodes (double-counted load).
10. **Planned TSS is bike-only in TrainingPeaks** (98% bike / 11% run /
    0% swim coverage). Any "coach-programmed" analysis must use
    `plannedTssEst` (duration×IF² estimator, pipeline/lib/estimateTss.ts),
    and must be labeled an estimate in reports.
11. **`sport: null` is expected** in summaries; discipline comes from
    sportInfer.ts. If unknownDiscipline in normalize-stats.json exceeds ~2%
    after a data refresh, extend the keyword lists — don't drop sessions.

## App (src/app/app)

12. **Server components read the local corpus via src/lib/athlete-data.ts
    only**, every page is `export const dynamic = "force-dynamic"`, and every
    page renders a real empty state when `hasCorpus()` is false — the
    deployed site has no data/ directory. Check: temporarily
    `mv data /tmp/data-bk && curl -s localhost:3000/app | grep -c "No training
    data connected" && mv /tmp/data-bk data` → prints ≥1.
13. **Health data never enters git.** data/ is gitignored (including the
    active plan at data/app/plan.json). Pre-commit check:
    `git status --porcelain | grep data/` prints nothing.
14. **Chart colors are the validated set, in fixed slot order** —
    #e05f2b (slot 1, CTL/run), #6f86c9 (slot 2, ATL/bike), #a8862a
    (slot 3, TSB/swim), #b04a72 (slot 4, other) — defined once in
    src/components/app/charts.tsx `SERIES`. They passed the dataviz
    six-check validator on the dark surface; brand warm-neutrals FAIL its
    chroma floor, so do not "re-brand" charts to bone/tan tones. Adding a
    5th series requires re-running the validator, not inventing a hex.
15. **Text wears text tokens** (bone/bone-muted/bone-faint), never series
    colors; identity comes from a colored swatch beside the label.
16. **Dates shown to the athlete are America/New_York**, not UTC (see
    taper-plan-hardening Fix 4 until executed). New date logic must not
    introduce `new Date().toISOString().slice(0,10)` as "today".
17. **Session status keys on (date, discipline-stable identity).** Until
    sessions carry ids, never make titles non-unique within a date, and
    never match on title alone.

## Frontend traps already paid for (marketing site, src/)

18. React StrictMode double-runs effects: GSAP SplitText must use the
    `autoSplit + onSplit` pattern created synchronously inside `useGSAP` —
    a `document.fonts.ready.then(...)` split double-splits and renders one
    word per line.
19. Lenis owns scrolling: programmatic scrolls go through
    `window.lenis.scrollTo(...)`; bare `window.scrollTo` gets rubber-banded
    back. Anchor links work because Lenis is constructed with
    `anchors: true` — keep it.
20. Three tsconfigs are intentional (root + engine/ + pipeline/, root has
    `allowImportingTsExtensions`). Don't consolidate; `npm run build` breaks.

## When done with any change here

Run the taper-verify skill end to end and report its one-line-per-step
summary. That skill's pinned numbers are the acceptance criteria.
