---
name: taper-plan-hardening
description: Fix the known edge cases in the Taper plan generator and app until `npm run engine:invariants` exits 0. Use when asked to harden the plan generator, fix plan edge cases, or when invariants fail. Contains the exact work order, root causes, and per-fix acceptance criteria.
---

# Taper plan hardening

The acceptance harness is `npm run engine:invariants` (engine/invariants.ts).
It encodes DESIRED behavior; some checks fail on purpose today. **Your job is
to make it print `14 pass, 0 fail` and exit 0 without weakening any check.**
Never edit engine/invariants.ts to make a check pass — fix the generator.
If you believe a check itself is wrong, stop and say so instead of changing it.

Baseline as of 2026-07-12 (verify before starting; if different, re-read the
output and adjust scope): `11 pass, 3 fail` — failing: I2, I3, I4.

Run everything from the repo root. After EVERY fix: `npx tsc -p engine
--noEmit && npm run engine:invariants`.

## Fix 1 — I2: tri plans ignore daysPerWeek=4

- Root cause: `slotsFor()` in engine/plan.ts. The triathlon branch builds a
  base array of 5 slots unconditionally and only ADDS slots for
  daysPerWeek ≥ 6. daysPerWeek 4 (and any value < 5) still gets 5 days.
- Fix: after building the tri slot array, if slots.length > req.daysPerWeek,
  drop the lowest-priority slots until it fits. Priority to KEEP, highest
  first: long ride, long run, quality run (the `quality` slot), bike
  threshold/z2, swim. So at 4 days/week a triathlete keeps: long ride, long
  run, quality run, and the bike; the swim goes. Do the same guard for the
  run branch (it can produce 4 base slots; fine at daysPerWeek 4, but the
  guard must be generic so future template edits can't regress this).
- Trap: do NOT redistribute by weekday afterward — remaining slots keep
  their original weekdayIdx.
- Accept: `npm run engine:invariants` shows all three I2 lines PASS,
  including `olympic respects daysPerWeek=4`.

## Fix 2 — I3: signing up mid-week for a race that weekend throws

- Root cause: `generatePlan()` starts the week loop at
  `mondayOnOrAfter(startDate)`. If the race lands before that Monday
  (e.g. start Tuesday, race Saturday), `raceT < start` and the function
  throws "race date is in the past" even though the race is in the future.
- Fix: compute `start = mondayOnOrBefore(startDate)` when
  `mondayOnOrAfter(startDate) > raceT` (i.e. fall back to the Monday of the
  CURRENT week). Then, inside the first week only, filter out sessions whose
  date < startDate (don't prescribe the past). Keep the throw for
  `raceDate < startDate`.
- Trap: the daysToRace computation and PMC simulation must still run over
  the full Monday-anchored week; only the emitted sessions are filtered.
- Accept: invariants I3 PASS: a plan generated with startDate 2026-07-14
  (Tue) and raceDate 2026-07-18 (Sat) has ≥1 non-race session and the race.

## Fix 3 — I4: long run scheduled the day before a Monday race

- Root cause: only the RACE week (daysToRace ≤ 6) filters `long` slots.
  For a Monday race, the entire preceding week is phase "taper" (not race
  week), so its long-run/long-ride slots survive — including Sunday, the
  day before the gun.
- Fix: in the week loop, when placing sessions, drop any slot whose
  computed date falls within 6 days BEFORE raceDate if its kind includes
  "long". Redistribute nothing; the week is simply lighter (it is race
  proximity, that is correct).
- Accept: invariants I4 PASS: `Monday race still gets race-week sharpeners`
  with no "long" title in the final 7 days.

## Fix 4 — local-time "today" (not covered by the harness; verify manually)

- Root cause: `new Date().toISOString().slice(0, 10)` is UTC. The athlete is
  in America/New_York: after ~8pm local, the app's "today" flips to
  tomorrow. Affected: src/app/app/page.tsx (today + upcoming filter,
  daysToRace), src/app/app/plan/page.tsx (isCurrent week highlight),
  engine/plan.ts default startDate.
- Fix: add `export function localToday(): string` in src/lib/athlete-data.ts
  using `new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
  .format(new Date())` (en-CA yields YYYY-MM-DD). Replace every
  `new Date().toISOString().slice(0, 10)` in the three files above with it.
  In engine/plan.ts, don't import from src/ (layering): accept that its
  default remains UTC but have BOTH server actions in
  src/app/app/actions.ts pass `startDate: localToday()` explicitly.
- Accept: `grep -rn "toISOString().slice(0, 10)" src/ engine/plan.ts` returns
  ONLY hits inside engine/plan.ts's `iso()` helper (date math), none in
  src/app pages/actions.

## Fix 5 — done-toggles survive a re-plan (manual acceptance)

- Root cause: `replanAction` regenerates and overwrites data/app/plan.json;
  `status: "done"` marks are lost.
- Fix: in src/app/app/actions.ts `buildAndSave`, before writing, read the
  existing plan (if any) and copy `status` onto new sessions matching on
  (date, discipline). Match on discipline, NOT title — titles change when
  durations shift. Only past-or-today sessions can carry status forward.
- Accept: with a plan active, mark today's session Done in the UI, click
  "Re-plan from today", and the session (same date+discipline) is still
  struck through. CLI check:
  `python3 -c "import json; p=json.load(open('data/app/plan.json')); print(sum(1 for w in p['plan']['weeks'] for s in w['sessions'] if s.get('status')=='done'))"`
  prints ≥1 after the re-plan.

## Definition of done

1. `npx tsc -p engine --noEmit && npx tsc --noEmit` — both clean.
2. `npm run engine:invariants` — `14 pass, 0 fail`, exit code 0.
3. `npm run engine:backtest` — taper-v1 within the pinned baselines in
   scripts/verify.sh (fixes must not regress the scorecard; regressions
   mean your fix leaked into weekly load logic).
4. `npm run lint` and `npm run build` — clean.
5. Fixes 4 and 5 verified per their acceptance lines.
