---
name: taper-watch-export
description: Push the plan's upcoming structured sessions to TrainingPeaks via MCP, which syncs them to the athlete's watch. Use when asked to send the plan to the watch/Garmin/TrainingPeaks, export workouts, or "get this week onto my wrist". Contains the verified structure format, the idempotence rules, and the refusal conditions.
---

# Watch export via TrainingPeaks

The plan otherwise dies in the app. TrainingPeaks syncs planned workouts to
Garmin/Wahoo natively, so pushing there puts a structured session on the
wrist without a Garmin developer account, OAuth infrastructure, or any app
code. Athlete 4195411.

Deliberately NOT the Garmin Training API: that needs developer-program
approval and per-user OAuth, which only pays off multi-user.

## Verified API facts — do not rediscover these

1. **Two payload paths.** `tp_create_workout`/`tp_update_workout` accept
   either a simplified `structure` or a native `structured_workout`.
   **Use `structured_workout`.** The simplified path hardcodes
   `primaryIntensityMetric: "percentOfFtp"` even for a run — an FTP yardstick
   on a running workout — and ignores an `intensity_metric` hint. The native
   payload accepts `percentOfThresholdPace`, which is what a run needs.
2. **The native payload requires `polyline`.** Omit it and you get
   `structured_workout is missing required fields: polyline`. It is TP's
   preview bar: per step, four points — `[x0,0] [x0,y] [x1,y] [x1,0]` — with
   x normalised to total duration and y = intensity_max/100.
3. **`tp_validate_structure` is side-effect free.** Use it to check a
   simplified structure before any write. Its root is an OBJECT
   `{"steps":[…]}`; a top-level array returns an opaque `API_ERROR`. Each
   step needs `duration_seconds`, `intensity_min`, `intensity_max`.
4. **Reps are not expanded by the simplified path** — a `repeat` field is
   accepted and silently ignored in the duration total. Write reps out flat.
5. **Flat steps, not TP `repetition` groups.** A repetition of
   [work, recovery] runs the recovery after the LAST rep too, adding a
   recovery period the plan never scheduled. Flat keeps total duration equal
   to the session as planned.
6. **Structured workouts are NOT Premium-gated on this account** (verified
   2026-08-05: `userType: 4`, `premiumTrial: false`). Structured create and
   update both succeed. **But `expireDate` was 2026-08-12** — when the
   subscription lapses, re-verify. If a structured push starts failing, fall
   back to a plain workout (title + `duration_minutes` + `tss_planned` +
   the structure written into `description`) and SAY WHICH MODE YOU USED in
   the report. Never silently downgrade.
7. `tp_get_workouts` rejects ranges > 90 days. Query only the window.
8. **Watch targets come from `engine/zones.ts` (RUN_BANDS / BIKE_BANDS)** —
   never from a table in this skill. The skill once carried its own
   "mirror" of the engine's bands; it drifted, and a Zone 2 ride exported
   at 72–85% FTP against the plan's 62–75% while the description in the
   same payload printed the correct watts. `src/lib/watch-export.test.ts`
   pins the exported bands to the engine's exports.
9. **Swims are not exported, by design.** The swim templates are
   DISTANCE-defined (metres, no per-block seconds) and this export builds
   time-based steps. Every swim reports `pushable: false` with the reason
   stated; the set is in the plan and in the description TP would show.
   Say so in the report rather than counting them as failures.

## Procedure

1. **Build the payloads** (pure, offline, no network):

   ```bash
   npx tsx .claude/skills/taper-watch-export/build-payload.ts <from> <to>
   ```

   It reads `data/app/plan.json` and the athlete's run threshold from
   `data/raw/athlete.json`, and prints one payload per session with a
   `pushable` flag. Percentages are % of threshold SPEED, derived from each
   block's own pace window, so they agree with the paces already in the plan.

2. **Read the window in TrainingPeaks first** — `tp_get_workouts` with
   `type: "all"` over the same dates. This is what makes the push idempotent.

3. **For each `pushable` session:**
   - No TP workout on that date with the same title → `tp_create_workout`.
   - One exists → `tp_update_workout` with its `workout_id`. Never create a
     second.
   - The existing workout is **completed** (`type: "completed"`, or
     `tss_actual`/`duration_actual` non-null) → **skip it**. The athlete's
     record of what they did is never overwritten by a plan.
   - The date is **in the past** → skip. Never push into the past.

4. **Report** what was pushed, what was skipped and why, and which mode
   (structured vs description-only).

## Refusal conditions — these are the point

`pushable: false` is not a nuisance; it is the feature working.

- **`already completed in the plan`** — the athlete marked it done.
- **`no structured blocks to export`** — nothing to put on a watch.
- **`swim sessions are distance-defined…`** — every swim, by design (fact 9).
- **structure/duration mismatch > 25%** — the plan's own structure
  contradicts its own duration. This happens after a reflow damp:
  `engine/replan.ts scaleWeek` rescales `tss` and `durationHr` but leaves
  `title`, `structure` and `workout.blocks` describing the pre-damp session.
  On 2026-08-05, 36 of 65 stored sessions disagreed, the current week by ~5×
  ("Long run 115" scheduled as 22 minutes). Exporting either number puts a
  contradiction on a device someone follows while running, so the export
  refuses and names the discrepancy.

  **This is an upstream defect, not an export problem.** It is visible on the
  Today screen too. When it is fixed, these sessions become pushable with no
  change here.

## What a good result looks like

Verified 2026-08-05, window 2026-08-10 → 2026-08-16, structured mode:

```
2026-08-11  VO2 set             32m  37 TSS   9 steps
2026-08-12  Easy 35             35m  26 TSS   1 step
2026-08-13  Easy 50             48m  36 TSS   1 step
2026-08-14  Easy 30 + strides   32m  24 TSS   6 steps
2026-08-16  Long run 100        98m  85 TSS   3 steps
```

A VO2 session reads back from TP with all nine steps, `warmUp`/`active`/
`rest`/`coolDown` classes, `percentOfThresholdPace`, and pace ranges in the
description as a human-readable backstop in case the watch renders
percentages instead.
