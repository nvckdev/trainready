# Taper data pipeline (Phase 0)

Turns the founder's TrainingPeaks history into normalized sessions, derived
load series, race labels, and model-ready datasets. See PRD.md §6 and §12.

All athlete data lives under `data/` which is **gitignored**; only this code
is committed. Health data never enters git.

## Layout

```
data/
  raw/            exactly what the TrainingPeaks MCP returned
    workouts/     90-day window dumps (overlaps OK; dedupe is downstream)
    fitness/      TP's own CTL/ATL/TSB series (validation reference)
    events/       race calendar
    metrics/      health metrics
    peaks/        PR power/pace curves
    athlete.json  thresholds, zones, profile
    manifest.json extraction inventory
  normalized/     sessions.jsonl, planned.jsonl (canonical schema)
  derived/        daily.jsonl, pmc.csv, weekly.csv, races.jsonl
  datasets/       weekly-examples.jsonl, compliance.csv
  reports/        phase0.md (coverage + PMC agreement gate)
```

## Run

```bash
npm run pipeline            # all stages
npm run pipeline normalize  # or: derive · label · dataset
```

Stages are pure functions over `data/raw`; re-running is idempotent.

## Extraction (refreshing data/raw)

Extraction happens through the TrainingPeaks MCP in a Claude session (the MCP
holds the athlete's auth). Process:

1. `tp_get_workouts` in ≤90-day windows (`type: "all"`), each window saved to
   `data/raw/workouts/<start>_<end>.json`. Oversized tool results are saved by
   the harness to a file; `python3 pipeline/unwrap.py <src> <dst>` unwraps
   either that envelope or raw JSON.
2. `tp_get_fitness`, `tp_get_events`, `tp_get_metrics` per year;
   `tp_get_peaks` per sport/PR type. Same unwrap step.
3. Update `data/raw/manifest.json`.

Windows may overlap freely: normalize dedupes by workout id, keeping the
richest record. To migrate off the MCP later, reimplement only this step
against the TrainingPeaks API; every downstream stage is source-agnostic.

## Stages

- **normalize** — flatten window dumps, dedupe by id, split completed vs
  unmatched-planned, infer discipline (summaries carry `sport: null`) from
  title/description keywords + speed sanity (`lib/sportInfer.ts`), flag race
  legs.
- **derive** — daily aggregates; PMC via the classic impulse-response model
  (CTL τ=42, ATL τ=7, TSB against yesterday); ISO weekly rollups with ramp %.
- **label** — race days from the events calendar plus multi-leg detection;
  attaches CTL/ATL/TSB at race day.
- **dataset** — `weekly-examples.jsonl` (athlete state → executed week, the
  imitation table for the plan engine) and `compliance.csv` (planned vs
  actual per paired session).
- **validate** — `data/reports/phase0.md`: coverage, discipline-inference
  quality, and the Phase-0 gate: derived CTL must agree with TrainingPeaks'
  own series (MAE < 2 after a 60-day seed warmup).

## Known limitations (Phase 0)

- Discipline inference is heuristic; low-confidence sessions are counted in
  the report. Per-workout detail pulls (`tp_get_workout`) can enrich later.
- Pre-2024-09-10 windows were extracted completed-only, so skipped-workout
  analysis starts later; summary TSS (not streams) is the load currency.
