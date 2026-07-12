---
name: taper-verify
description: Run the full Taper acceptance gauntlet (types, lint, pipeline gate, engine backtest baselines, plan invariants, build, app HTTP probes) and report pass/fail against pinned numbers. Use before any commit touching engine/, pipeline/, or src/app/app, or when asked to verify the app.
---

# Taper acceptance gauntlet

Run every step from the repo root, in order. A step's expected result is
pinned; report each as PASS/FAIL and stop only if a step cannot run at all.
Do not rationalize a miss as "close enough" — report the number.

## 1. Static checks

```bash
npx tsc --noEmit && npx tsc -p engine --noEmit && npx tsc -p pipeline --noEmit
npm run lint
```
Expected: all clean. (Three tsconfigs on purpose: root excludes engine/ and
pipeline/; each has its own. Root has allowImportingTsExtensions because app
code imports engine/*.ts directly.)

## 2. Data pipeline gate (needs local corpus in data/)

```bash
npm run pipeline
```
Expected stdout (numbers pinned to the 2026-07-11 corpus; a REFRESHED corpus
may raise counts but must never lower them):
- normalize: completedSessions ≥ 1241, unknownDiscipline ≤ 25, duplicatesDropped ≥ 0
- label: ≥ 9 race days
Then check the report:
```bash
grep -E "Verdict|CTL MAE" data/reports/phase0.md
```
Expected: `CTL MAE` ≤ 2.00 and Verdict contains `PASS`. This is the PRD §12
gate — derived load math must match TrainingPeaks. If it fails after a data
refresh, the extraction double-counted (check duplicatesDropped) or a race
day's TSS is missing; do NOT touch the PMC constants (42/7) to fix it.

## 3. Engine scorecard (baselines to beat, never regress)

```bash
npm run engine:backtest
```
Pinned baselines (from data/reports/engine-backtest.md, 183-week corpus):
- taper-v1 maeConsistent ≤ 83.1, corr ≥ 0.82, directionAgreement ≥ 73
- reference maeConsistent ≤ 91.0 (it may drift ±1 with corpus refreshes)
Any engine change that worsens taper-v1 on two or more of its three numbers
is a regression: revert or fix before committing.

## 4. Plan invariants

```bash
npm run engine:invariants
```
Expected: exit 0 (`N pass, 0 fail`). If it fails and you did not touch the
generator, the corpus state changed shape — investigate, don't patch checks.
(Until taper-plan-hardening is executed, the pinned status is 11 pass /
3 fail: I2, I3, I4. Anything WORSE than that is a regression either way.)

## 5. Production build + app probes

```bash
npm run build
```
Expected: marketing routes `○ (Static)`, all four `/app*` routes `ƒ (Dynamic)`.

Start the dev server via the Browser pane (launch config "trainready"), or
`npm run dev` if no pane is available, then:
```bash
for p in / /app /app/plan /app/fitness /app/start; do
  echo "$p $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000$p)"; done
curl -s http://localhost:3000/app/plan | grep -c "Re-plan from today"
```
Expected: five `200`s; the grep prints ≥ 1 when a plan exists at
data/app/plan.json, or the page shows the "No active plan" empty state
(grep for that string instead) when it doesn't. BOTH are passes; a 500 or
an empty body is the failure.

## 6. Privacy tripwire (always, before any commit)

```bash
git status --porcelain | grep -E "^\?\?|^A" | grep -c "data/" || echo 0
```
Expected: `0`. Athlete health data lives only under data/ (gitignored).
If anything under data/ is staged or untracked-but-added, unstage it and
check .gitignore still contains `/data`.

## Report format

One line per step: `1 static PASS · 2 pipeline PASS (CTL MAE 0.20) · ...`
followed by any FAIL with its actual-vs-pinned number.
