# Workout structure — normalized session shape

Status: implemented on `feat/workout-renderer` (generator emission + types).
Owner: session composition (`engine/plan.ts`) + session shape (`engine/types.ts`).

## 1. Why

Before this change every planned session carried its workout as a single
generated **string** (`PlannedSessionOut.structure`, e.g.
`"WARMUP 8 min…\nMAIN 2 × 8 min @ 4:15–4:29/km on 2 min easy\nCOOLDOWN…"`).
The visual renderer needs the reps / durations / paces / zones as data, not
prose. The engine already knows every one of those values as it composes the
string, so it now **emits them directly** into a normalized structure. It does
**not** parse its own text back into fields — parsing our own emitted text is
backwards and fragile.

Confirmed current shape before refactor: **STRING**.
`engine/plan.ts:68` — `structure: string` in `PlannedSessionOut`, produced at
`engine/plan.ts:505` via `t.structure(zones, m)` from the per-kind template
string functions (`engine/plan.ts:149–244`).

## 2. Shape

Defined in `engine/types.ts` (the shared contract file), re-exported from
`engine/plan.ts` for existing importers.

```ts
type Zone = "recovery" | "easy" | "tempo" | "threshold" | "cv" | "vo2" | "race";
type BlockKind = "warmup" | "main" | "cooldown" | "strides" | "recovery" | "segment";

interface Block {
  kind: BlockKind;
  zone: Zone;
  reps?: number;            // interval repeat count (absent/1 = single block)
  durationSec?: number;     // per-rep or whole-block time (runs/bikes)
  distanceM?: number;       // per-rep or whole-block distance (swims)
  paceMinSecPerKm?: number; // run pace window, fast end
  paceMaxSecPerKm?: number; // run pace window, slow end
  recoverySec?: number;     // recovery between reps
  recoveryNote?: string;    // "easy" | "rest" | "full recovery" | …
  effortNote?: string;      // watt target / cue / qualifier
}

interface WorkoutStructure { blocks: Block[]; }
```

### 2.1 On the session

`PlannedSessionOut` gains **`workout?: WorkoutStructure`** and keeps
**`structure: string`** unchanged.

- `structure` (string) stays the field every existing consumer already reads —
  `SessionCard` (`src/components/app/bits.tsx`), the iCal feed
  (`src/app/app/calendar.ics/route.ts`), and `plan-io.retitleSession`. Its
  wording is byte-for-byte identical to before.
- `workout` is **optional** on purpose: pre-existing stored plans
  (`data/app/plan.json`, gitignored) and the text-only pain-guard conversion
  (`week-insights.easedVersion`) have no blocks, so the renderer falls back to
  the `structure` string for them. Every freshly generated session carries it.

**Field-naming note.** The refactor spec wrote the shape as
`structure: { blocks: Block[] }`. `structure` is already a widely-consumed
string field on a persisted type, and the spec also requires keeping the
human-readable string, so the object cannot reuse the same name. The normalized
object is therefore named **`workout`** and the string keeps the name
`structure`. This is additive and zero-regression; the feat/replan rebase
combines cleanly (that workflow touches weekly-target reflow + the re-plan note,
not the session card).

## 3. Single source, no divergence

Each template is one `build(z, m): { blocks; text }` function. It computes the
session's locals **once** (reps, per-rep minutes, warm/cool minutes, paces) and
builds **both** the blocks and the human-readable `text` from those same locals.
A value can therefore never differ between the two, and the text is never parsed
back into blocks. The generator writes `structure = built.text` and
`workout = { blocks: built.blocks }` (`engine/plan.ts`).

Byte-identity of the derived `text` against the pre-refactor output was verified
across every race type × {4,5,6,7} days × {sat,sun} long day × {goal, no-goal}
branch (all sessions of every generated week): **zero diff**. Existing tests,
`tsc -p engine`, root `tsc`, and eslint all pass; the backtest baselines are
unchanged (it never calls `generatePlan`).

## 4. Session types → blocks

The generator produces these session kinds (`TEMPLATES`, `engine/plan.ts`).
Run efforts carry numeric `paceMin/MaxSecPerKm` (from the new `zones.runSec`);
bike efforts (watts) and swim efforts (per-100 m) carry their target in
`effortNote` and are identified by `zone`.

| Kind | Blocks (kind · zone) | Notes |
|---|---|---|
| `run-easy` | main · easy | pace + HR cue in `effortNote` |
| `run-strides` | segment · easy → strides · vo2 | strides: `reps 5`, `durationSec 20`, `recoveryNote "full recovery"` |
| `run-long` | segment · easy → segment · easy → segment · easy | first/middle/last thirds; last segment paced at `steady`, `effortNote "may drift to steady…"` |
| `run-tempo` | warmup · easy → main · tempo → cooldown · easy | main `reps`, `recoverySec 120` |
| `run-vo2` | warmup · easy → main · vo2 → cooldown · easy | main `reps × 180s`, `recoverySec 90` |
| `bike-z2` | warmup · easy → main · easy → cooldown · recovery | watts in `effortNote` |
| `bike-threshold` | warmup · easy → main · threshold → cooldown · recovery | main `reps × {10,12}min`, `recoverySec 300` |
| `bike-vo2` | warmup · easy → main · vo2 → cooldown · recovery | defined but **not** currently selected by `slotsFor` (kept for parity) |
| `bike-long` | main · easy → segment · tempo | fuel line is coaching prose, text-only (not a training block) |
| `swim-endurance` | warmup · easy → main · easy → cooldown · recovery | distance-defined (`distanceM`), `recoverySec 30` |
| `swim-threshold` | warmup · easy → main · cv → main · vo2 → cooldown · recovery | CSS set mapped to **cv** (critical swim speed = critical velocity) |
| race session | segment · race | prose in `effortNote`; no reps/pace |

Zone-mapping rationale: the enum is a coldest→hottest intensity ramp for the
renderer's palette. Swim CSS is literally critical swim speed → **cv**; strides
are neuromuscular/sharp → top of the ramp (**vo2**); bike Zone 2 and easy spins
map to **easy**/**recovery**; the long-run "drift to steady" tail keeps zone
**easy** (aerobic) but is paced from `steady`.

## 5. Renderer palette (for the visual card — reference)

Per taper-rules rule 14, the fixed chart `SERIES` slots (CTL/ATL/TSB/other) are
**not** repurposed. The zone ramp is a separate, documented, accessible ember/
bone scale on the dark surface: `easy` cool/faint bone → `tempo`/`threshold`
signal-dim → `cv`/`vo2` signal → `vo2` signal-bright, with `recovery` the
faintest and `race` full signal. Text keeps bone tokens (rule 15); zone identity
comes from a colored swatch, never colored body text.
