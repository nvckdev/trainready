---
name: taper-extract
description: Refresh the local TrainingPeaks corpus (data/raw) through the TrainingPeaks MCP and re-run the pipeline gate. Use when asked to sync, refresh, or extend training data, or when the corpus is stale. Contains the API quirks, the context-safety procedure, and the acceptance gate.
---

# TrainingPeaks corpus refresh

Read-only extraction for athlete 4195411 into data/ (gitignored — never
commit anything under data/). Full background: pipeline/README.md.

## API facts you must not rediscover the hard way

1. `tp_get_workouts` and `tp_get_events` reject ranges > 90 days.
   `tp_get_fitness` accepts multi-year ranges. `tp_get_metrics` untested
   at long ranges — if it errors, halve the range and retry.
2. Always call workouts with `type: "all"` (planned + completed). Historic
   note: windows before 2024-09-10 were extracted completed-only; do not
   re-extract them, the manifest records this.
3. Workout summaries carry `sport: null` — this is normal. Discipline is
   inferred downstream (pipeline/lib/sportInfer.ts). Do not try to "fix" it
   at extraction time.
4. Tool results ≳ 60 KB are saved by the harness to a file path shown in the
   result; SMALLER results arrive inline in your context. Prefer wide/dense
   windows so results persist to files. Two persisted formats exist — raw
   JSON, or an MCP envelope `[{"type":"text","text":"..."}]` —
   `python3 pipeline/unwrap.py <saved-path> <dest>` handles both and prints
   the record count.
5. If a result arrives inline anyway, you MUST persist it verbatim to the
   dest file yourself (write the exact JSON; verify with
   `python3 -c "import json;print(json.load(open('<dest>'))['count'])"`).
   Never re-request the same window hoping for different routing; never
   summarize or truncate workout records.
6. Overlapping windows are safe and encouraged: normalize dedupes by
   workout id, keeping the record with more non-null fields.

## Procedure

1. Read `data/raw/manifest.json` → find the latest workout window end date.
2. Extract new 90-day windows with `tp_get_workouts` (`type:"all"`) from
   that date to today, dest `data/raw/workouts/<start>_<end>.json` via the
   unwrap/persist rules above. Start each window 7 days BEFORE the previous
   end (overlap on purpose).
3. Extend fitness: one `tp_get_fitness` call from the last fitness file's
   end date to today → `data/raw/fitness/<start>_<end>.json`.
4. Update `data/raw/manifest.json`: append the new files with counts; keep
   the existing notes array.
5. Re-run and gate:
   ```bash
   npm run pipeline
   grep -E "Verdict|CTL MAE" data/reports/phase0.md
   ```
   Accept only if CTL MAE ≤ 2.00 and Verdict PASS. If MAE jumped:
   the usual cause is double-counted sessions (same workout under two ids
   after device re-sync) — inspect `normalize-stats.json` duplicatesDropped
   and the new window for near-identical records.
6. Re-run `npm run engine:backtest` and `npm run engine:invariants`; report
   the numbers next to the pinned baselines in the taper-verify skill.

## Still-missing extractions (extend, don't re-do)

- Events calendar: needs ~18 × 90-day `tp_get_events` calls (2022-09→now);
  destination data/raw/events/<start>_<end>.json. Once present, the label
  stage picks them up automatically (races currently come from multi-leg
  detection only).
- Health metrics (`tp_get_metrics`), PR peaks (`tp_get_peaks`: Bike
  power1min/power5min/power20min, Run speed5K/speed10K/speedHalf), and
  per-workout streams — all optional for the Phase-0 gate.

## Hard rules

- Read-only: never call tp_create_*, tp_update_*, tp_delete_*, or
  tp_upload_* during extraction.
- Nothing under data/ enters git: after finishing,
  `git status --porcelain | grep data/` must print nothing.
