# Strength module — design

Status: design, no feature code yet. Branch `feat/strength-module`.

The existing supplemental layer (`src/lib/strength-protocols.ts` +
`SupplementalCard` in `src/components/app/bits.tsx`) is templated,
stateless, and invisible to load accounting: two injury-matched blocks per
week, no scheduling, no progression, no TSS. This module **evolves** that
layer in place — same file, same card, same selection logic as the seed —
into a stateful protocol system with day-level scheduling, per-exercise
progression, a pain log with surface rules, and a display-only strength
TSS. Nothing here touches `engine/` or the PMC derivation (taper-rules
2, 6): the engine's plan stays the plan; strength is layered around it,
exactly as the current comment in `strength-protocols.ts` promises.

---

## 1. Data model

All types live in `src/lib/strength-protocols.ts` (extending, not
replacing, `StrengthBlock`/`SelectedBlock`) plus a new gateway
`src/lib/strength-io.ts` for persistence, mirroring `plan-io.ts`.

### Protocol

```ts
export interface ProtocolBlock {
  exercise: string;        // stable identity — see ProgressionState keying
  sets: number;            // prescribed sets at full (non-deload) dose
  repRange: [number, number]; // e.g. [6, 10]; top of range drives progression
  tempo?: string;          // e.g. "3-1-1" — eccentric emphasis carried over
                           // from the existing blocks' `cue` fields
  loadRule: LoadRule;      // how load is expressed and progressed
  freqPerWeek: number;     // 1–7; 7 only meaningful when rehab
}

export type LoadRule =
  | { kind: "bodyweight" }                          // progress via reps only
  | { kind: "band"; ladder: string[]; index: number } // e.g. ["yellow","red","green","blue"]
  | { kind: "external"; unit: "kg"; increment: 2.5 }; // barbell/dumbbell/cable

export interface Protocol {
  id: string;              // slug, e.g. "gym-calf" — existing block ids are
                           // grandfathered in as protocol ids (see §7)
  name: string;
  blocks: ProtocolBlock[];
  rehab?: boolean;         // rehab protocols are DAILY-eligible and exempt
                           // from the 24h quality-run constraint (§3)
}
```

The existing `StrengthBlock` library (targets, `why`, injury matching,
bodyweight/gym pools) remains the **template source**: activating a block
instantiates a `Protocol` from it. `selectWeeklyBlocks` keeps producing
the default weekly pair; the new layer records which of those the athlete
has activated and tracks state for them. One template, one live protocol —
no duplicated exercise definitions.

### PainEntry

Pain logs are health data. They live ONLY under `data/` (gitignored,
taper-rules 13) and are read/written exclusively through the
`strength-io.ts` gateway — no component or page touches the filesystem.

```ts
export const PAIN_REGIONS = INJURY_AREAS; // reuse athlete-context vocabulary
export type PainRegion = InjuryArea;      // "calf-achilles" | "knee" | ...

export interface PainEntry {
  date: string;            // YYYY-MM-DD, athlete-local (localToday(),
                           // taper-rules 16 — never toISOString-today)
  region: PainRegion;
  score0to10: number;      // integer 0–10, NRS scale
  context: "at-rest" | "during-session" | "after-session" | "morning";
}
```

One entry per (date, region, context); a re-log the same day overwrites.
Parsing helpers follow the `athlete-context.ts` pattern (untrusted server
action input → clamped/validated values).

### ProgressionState

```ts
export interface ProgressionState {
  exercise: string;        // keyed by exercise name within a protocol id:
                           // `${protocolId}␟${exercise}` in storage
  currentLoad:             // matches the block's LoadRule
    | { kind: "bodyweight"; addedReps: number }
    | { kind: "band"; index: number }
    | { kind: "external"; kg: number };
  topStreak: number;       // consecutive completed sessions with ALL sets
                           // at the TOP of repRange (resets on any non-top)
  missStreak: number;      // consecutive sessions with any missed set
  lastResult?: "top" | "made" | "missed";
  updatedAt: string;       // ISO timestamp, machine-facing
}
```

### Completion record

A strength session completion (per protocol, per day) records per-block
set results so the state machine has its input:

```ts
export interface StrengthCompletion {
  date: string;            // athlete-local
  protocolId: string;
  results: Array<{ exercise: string; setsDone: number; allSetsAtTop: boolean }>;
}
```

Strength sessions are keyed `(date, protocolId)` — consistent with the
plan's `(date, title)` convention (taper-rules 17): protocol ids are
unique, so a date+id pair is unambiguous, and protocol names never need
to be unique.

---

## 2. Storage

Two new files under `data/app/`, siblings of `plan.json` and
`athlete-context.json`, both inside the gitignored `/data` tree:

| File | Contents | Writer |
|---|---|---|
| `data/app/protocols-state.json` | `{ activeProtocolIds: string[], progression: Record<string, ProgressionState>, completions: StrengthCompletion[] }` | `strength-io.ts` |
| `data/app/pain-log.json` | `{ entries: PainEntry[] }` | `strength-io.ts` |

Gateway contract (copied from `plan-io.ts` / `athlete-context.ts`):

- Every reader returns `null` (or `[]`) when the file or `data/` is
  absent — the deployed site has no `data/` directory, and every page
  already renders a real empty state (taper-rules 12).
- Writers `mkdirSync(dirname, { recursive: true })` then write
  `JSON.stringify(x, null, 1)`.
- Corrupt JSON reads as absent (`try/catch → null`), never throws into
  a page render.
- Pre-commit invariant unchanged: `git status --porcelain | grep data/`
  prints nothing. Pain logs are health data and never enter git.

Server actions live in `src/app/app/actions.ts` (same `"use server"`
module): `logPainAction`, `completeStrengthAction`,
`toggleProtocolAction` — each parses untrusted FormData through the §1
helpers, writes via the gateway, then `revalidatePath("/app", "layout")`.

---

## 3. Scheduler — placing strength days around the engine plan

Strength placement is **presentation-layer** (like `week-insights.ts`):
pure functions over the stored plan, never mutating it.

Inputs: the current `PlanWeek` (from `readPlan()` + `currentWeek()`),
the active protocols, athlete-local `today`.

Definitions:

- **Protected session** = any planned session where
  `QUALITY.test(s.title)` (the exported regex from
  `src/lib/week-insights.ts`: `/tempo|interval|threshold|vo2|strides/i`)
  **or** `s.discipline === "race"`. Long runs/rides are NOT protected —
  strength before an easy or long day is acceptable; before intensity or
  a race it is not.
- **Race week** = the plan week containing a `discipline === "race"`
  session.

Algorithm (deterministic — same inputs, same calendar out):

```
schedule(week, protocols, today):
  protectedDates = dates of sessions in week (and the first 2 days of
                   the next week) matching QUALITY or discipline "race"
  for each non-rehab protocol P:
    needed = max over P.blocks of freqPerWeek (typically 1–3)
    candidates = week days d (>= today) such that
        d+1day ∉ protectedDates        // never <24h before quality/race:
                                       // a strength day is EXCLUDED when the
                                       // NEXT calendar day holds a protected
                                       // session (date-granularity 24h rule)
        and d ≠ race date
        and d not already assigned another non-rehab protocol
    prefer candidates that ARE a quality day themselves (hard-day-hard-day:
      strength after the run consolidates stress), then easy days,
      then rest days; earliest-date tiebreak
    assign the first `needed` candidates; if fewer exist, assign what
      exists and surface "n of m placed — week is intensity-dense"
  rehab protocols: eligible EVERY day including protected-adjacent days
    and race week (they are therapeutic dose, not training stress);
    only exclusion is race day itself
```

The lookahead into the next week's first two days prevents a Sunday
strength day landing 24h before a Monday quality session.

**Race-week deload:** in a race week, every scheduled non-rehab strength
session halves its prescribed sets — `deloadSets = max(1, floor(sets/2))`
per block — and progression is frozen (completions in a race week never
increment `topStreak` or `missStreak`; a deload dose can't prove
progression either way). Rehab protocols keep full dose. This mirrors the
engine's own race-week behavior (trainable TSS ×0.55, long sessions
dropped) without touching it.

Scheduled strength days render on the Today page (evolving
`SupplementalCard` into a dated card, §6) and inside the plan page's
week detail as non-engine rows — visually distinct (no discipline dot
from `DISC_COLOR`; a hairline-bordered "S" glyph in `bone-muted`), and
never written into `plan.json`.

---

## 4. Pain surface rules

Evaluated over `pain-log.json` per region, athlete-local dates, pure
function `surfaceAlerts(entries, today): PainAlert[]`:

```ts
export interface PainAlert {
  region: PainRegion;
  rule: "consecutive" | "at-rest" | "rising-trend";
  detail: string;          // one line, plain language
}
```

A region surfaces an alert when ANY of:

1. **Consecutive** — 3 consecutive calendar days each having max daily
   score ≥ 4 for the region, window ending today or yesterday. Missing
   days break the streak.
2. **At rest** — any entry in the last 7 days with
   `context === "at-rest"` and `score0to10 ≥ 3`. Rest pain is a lower
   bar than loading pain.
3. **Rising trend** — over the trailing 7 calendar days, take max daily
   score per day (days with no entry are skipped, ≥ 3 data points
   required); fit ordinary least-squares over (dayIndex, score). Surface
   when `slope > 0` **and** `last > first + 1` — the slope alone can be
   positive on noise; the level test demands a real climb of more than
   one point end to end.

Consequences (presentation only, engine untouched):

- Alert banner on Today for the affected region (bone tokens, hairline
  border — same visual family as `WeekBriefStrip`; NOT a series color:
  text wears text tokens, taper-rules 15).
- Non-rehab protocols targeting the region are flagged "hold — pain
  surfacing", and the scheduler skips them until the rule clears.
- Copy suggests substituting the region's rehab protocol and, at
  persistent alerts (rule 1 or 3 firing twice in 14 days), seeing a
  professional. The app diagnoses nothing.

---

## 5. Progression state machine

Per exercise, evaluated at each completion outside race weeks:

```
states: HOLD (default) → advance / decrement are transitions, not states;
        the machine is streak counters over completion results

on completion result:
  "top"    (all sets at top of repRange): topStreak++, missStreak = 0
  "made"   (all sets done, not all at top): topStreak = 0, missStreak = 0
  "missed" (any set not completed):        topStreak = 0, missStreak++

  if topStreak == 2:
    advance load:
      external:   kg += 2.5
      band:       index = min(index + 1, ladder.length - 1)
      bodyweight: repRange shifts up by 2 (e.g. [6,10] → [8,12]);
                  addedReps tracks the shift
    topStreak = 0    // re-earn at the new load

  if missStreak == 2:
    decrement load (inverse of advance; floors: kg ≥ 0 — bodyweight
      floor is the template's original repRange; band index ≥ 0)
    missStreak = 0
```

Two-in-a-row in both directions makes progression deliberately slow —
this is supplemental work for an endurance athlete, not a strength
program chasing PRs. Race-week completions and pain-held sessions do not
feed the machine (frozen, §3/§4). State persists in
`protocols-state.json` keyed `${protocolId}␟${exercise}` (the `␟`
separator convention already used in `actions.ts` `carryStatusForward`).

---

## 6. Strength TSS — display-only load accounting

**Invariant: the engine and the PMC derivation never see strength TSS.**
`pipeline/lib/derive.ts` (CTL τ=42, ATL τ=7 — taper-rules 6),
`engine/*`, and `plan.json` are all unchanged. Strength load exists only
in what the athlete is *shown*.

- **Config:** `IntakeData` gains `strengthTss?: number` (default 20,
  clamp 5–60), one numeric field appended to the intake form in
  `src/app/app/start/page.tsx`, parsed alongside the existing intake
  fields, merged into `athlete-context.json` via the existing
  `writeIntake` (extend, never clobber).
- **Week brief** (`briefForWeek` in `week-insights.ts`): gains
  `strengthTss` (scheduled sessions × configured value) and
  `strengthDone` counts, passed in by the caller — `week-insights`
  stays pure and plan-only; the Today page composes plan + strength.
  `WeekBriefStrip` shows "`+N` TSS strength (display only)" beside the
  target — visibly additive, never summed into `targetTss`, which
  remains the engine's number.
- **Fitness weekly bars** (`WeeklyVolumeChart`): completed strength
  sessions add a `strength` stack segment to the current/recent weeks.
  Color: **reuse slot 4** `SERIES.other` (#b04a72) — strength joins the
  "other" bucket rather than claiming a 5th series, because adding a 5th
  hex requires re-running the dataviz validator (taper-rules 14) and
  "other" is semantically exact: non-swim/bike/run load. The legend
  label becomes "other / strength". No new hex anywhere; any
  strength-specific text wears bone tokens.
- **Pain over time** (fitness page, optional v1.1): if plotted, the pain
  series reuses an existing slot color for its line with text-token
  axis/labels — or ships as the table view only.

---

## 7. Migration & compatibility

- Existing `StrengthBlock`s become protocol templates: `id` carries
  over as `Protocol.id`; `dose` strings ("3×12 / leg") parse into
  `sets`/`repRange` at instantiation; `cue`s with tempo language map to
  `tempo`. `selectWeeklyBlocks`/`supplementalForContext` remain the
  default-selection path for athletes who never activate protocols —
  zero state, current behavior preserved bit-for-bit.
- With no `protocols-state.json`, the Today page renders today's
  `SupplementalCard` exactly as now. First activation writes state and
  upgrades the card in place.
- All new pages/sections stay `force-dynamic` with real empty states;
  all dates via `localToday()`; all data access via `src/lib` gateways.

## 8. Out of scope

- Any change to `engine/`, `pipeline/lib/derive.ts`, or backtest
  baselines.
- Strength TSS inside PMC, CTL/ATL/TSB, or `plan.json`.
- Writing strength sessions into the engine plan's `weeks[].sessions`.
- Medical interpretation of pain data.

## 9. Acceptance checks

1. `git status --porcelain | grep data/` prints nothing after using
   every new action locally.
2. `mv data /tmp/data-bk` → `/app`, `/app/plan`, `/app/fitness` render
   empty states, no crash → restore.
3. Generate a plan with a Tuesday VO2 session: no non-rehab strength
   lands on Monday; rehab may.
4. Race week: scheduled strength sets are halved; progression state
   unchanged after completing them.
5. Seed pain log fixtures for each surface rule; exactly the intended
   rule fires (unit tests on the pure functions).
6. Two "top" completions advance external load by exactly 2.5 kg; two
   "missed" decrement; alternating results never move load.
7. `npm run engine:backtest` numbers identical before/after the branch —
   proof the engine was untouched.
