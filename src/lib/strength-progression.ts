import type {
  ProgressionState,
  Protocol,
  ProtocolBlock,
  StrengthCompletion,
} from "./strength-protocols";

/**
 * Per-exercise progression state machine (docs/strength-module.md §5).
 * Pure functions only — no filesystem, no clock, no engine imports: the
 * machine is streak counters over completion results, and persisted state
 * is a *projection* of the completion log (`replayProgression`), so undoing
 * a session rewinds progression for free and re-logging never double-counts.
 *
 * Two-in-a-row in both directions keeps progression deliberately slow —
 * supplemental work for an endurance athlete, not a program chasing PRs:
 *   "top"    (all sets at top of repRange) ×2 → advance load, re-earn at 0
 *   "missed" (any set not completed)       ×2 → decrement load, floor-clamped
 *   anything else                              → hold, streaks reset
 * Race-week (deload) completions never feed the machine (§3): a halved dose
 * can't prove progression either way.
 */

export type CompletionResult = "top" | "made" | "missed";

/** Same separator convention as actions.ts `carryStatusForward`. */
export function progressionKey(protocolId: string, exercise: string): string {
  return `${protocolId}␟${exercise}`;
}

/** Load a block starts at before any completion has been logged. */
export function initialState(block: ProtocolBlock, updatedAt: string): ProgressionState {
  const rule = block.loadRule;
  return {
    exercise: block.exercise,
    currentLoad:
      rule.kind === "external"
        ? { kind: "external", kg: 0 }
        : rule.kind === "band"
          ? { kind: "band", index: rule.index }
          : { kind: "bodyweight", addedReps: 0 },
    topStreak: 0,
    missStreak: 0,
    updatedAt,
  };
}

/**
 * Classify one exercise's logged sets against the FULL (non-deload)
 * prescription: any set short of the prescribed count is a miss; all sets
 * done at the top of the rep range is a top; all sets done otherwise made.
 */
export function classifySetResult(
  block: ProtocolBlock,
  r: { setsDone: number; allSetsAtTop: boolean }
): CompletionResult {
  if (r.setsDone < block.sets) return "missed";
  return r.allSetsAtTop ? "top" : "made";
}

const REP_STEP = 2; // bodyweight progression: rep range shifts by 2

function advance(block: ProtocolBlock, load: ProgressionState["currentLoad"]): ProgressionState["currentLoad"] {
  switch (load.kind) {
    case "external":
      return { kind: "external", kg: load.kg + 2.5 };
    case "band": {
      const ladder = block.loadRule.kind === "band" ? block.loadRule.ladder : [];
      return { kind: "band", index: Math.min(load.index + 1, Math.max(0, ladder.length - 1)) };
    }
    case "bodyweight":
      return { kind: "bodyweight", addedReps: load.addedReps + REP_STEP };
  }
}

function decrement(load: ProgressionState["currentLoad"]): ProgressionState["currentLoad"] {
  switch (load.kind) {
    case "external":
      return { kind: "external", kg: Math.max(0, load.kg - 2.5) };
    case "band":
      return { kind: "band", index: Math.max(0, load.index - 1) };
    case "bodyweight":
      // Floor is the template's original rep range (addedReps 0).
      return { kind: "bodyweight", addedReps: Math.max(0, load.addedReps - REP_STEP) };
  }
}

/**
 * One transition of the machine. Returns a NEW state — inputs are never
 * mutated. `updatedAt` is caller-supplied (the completion date in replay)
 * so identical logs always produce identical state.
 */
export function applyResult(
  block: ProtocolBlock,
  state: ProgressionState,
  result: CompletionResult,
  updatedAt: string
): ProgressionState {
  let topStreak = result === "top" ? state.topStreak + 1 : 0;
  let missStreak = result === "missed" ? state.missStreak + 1 : 0;
  let currentLoad = state.currentLoad;
  let lastEvent: ProgressionState["lastEvent"];

  if (topStreak === 2) {
    currentLoad = advance(block, currentLoad);
    topStreak = 0; // re-earn at the new load
    lastEvent = "advanced";
  } else if (missStreak === 2) {
    currentLoad = decrement(currentLoad);
    missStreak = 0;
    lastEvent = "decremented";
  }

  return {
    exercise: block.exercise,
    currentLoad,
    topStreak,
    missStreak,
    lastResult: result,
    ...(lastEvent ? { lastEvent } : {}),
    updatedAt,
  };
}

/** Rep range at the current bodyweight progression (other rules keep the
 *  template range — their load moves instead). */
export function effectiveRepRange(
  block: ProtocolBlock,
  state: ProgressionState | null | undefined
): [number, number] {
  const [lo, hi] = block.repRange;
  if (state?.currentLoad.kind === "bodyweight" && state.currentLoad.addedReps > 0) {
    return [lo + state.currentLoad.addedReps, hi + state.currentLoad.addedReps];
  }
  return [lo, hi];
}

/* ——— rendering helpers (suggestions beside each exercise) ——————— */

export interface ExerciseSuggestion {
  /** Current working load to show beside the dose, e.g. "22.5 kg",
   *  "green band". Null when the template dose already says it all. */
  load: string | null;
  /** One-line progression nudge. Null when there is nothing to say. */
  hint: string | null;
}

function advanceLabel(block: ProtocolBlock, state: ProgressionState | null | undefined): string {
  const rule = block.loadRule;
  if (rule.kind === "external") return "+2.5 kg";
  if (rule.kind === "band") {
    const index = state?.currentLoad.kind === "band" ? state.currentLoad.index : rule.index;
    const next = rule.ladder[index + 1];
    return next ? `the ${next} band` : "top of the band ladder";
  }
  return `+${REP_STEP} reps`;
}

/**
 * What to render next to an exercise in the checklist: the working load the
 * machine has arrived at, plus a streak-aware nudge. `frozen` (race-week
 * deload or pain hold) keeps the load visible but silences progression talk.
 */
export function suggestionFor(
  block: ProtocolBlock,
  state: ProgressionState | null | undefined,
  frozen = false
): ExerciseSuggestion {
  let load: string | null = null;
  const cur = state?.currentLoad;
  if (cur?.kind === "external" && cur.kg > 0) load = `${cur.kg} kg`;
  else if (block.loadRule.kind === "band") {
    const index = cur?.kind === "band" ? cur.index : block.loadRule.index;
    const band = block.loadRule.ladder[index];
    if (band) load = `${band} band`;
  }

  let hint: string | null = null;
  if (!frozen && state) {
    if (state.topStreak === 1) hint = `Top of range once — repeat it and move to ${advanceLabel(block, state)}.`;
    else if (state.missStreak === 1) hint = "Missed last time — another miss steps the load back.";
    else if (state.lastEvent === "advanced") hint = "Moved up after two top-range sessions — settle in here.";
    else if (state.lastEvent === "decremented") hint = "Stepped back after two missed sessions — rebuild from here.";
  }
  return { load, hint };
}

/* ——— projection: completion log → progression state ————————————— */

/**
 * Rebuild every exercise's progression state from the completion log.
 * Deterministic: completions replay in (date, protocolId) order, race-week
 * deload completions are skipped (frozen, §3), and each state's `updatedAt`
 * is the completion date that produced it. Exercises with no history are
 * absent from the result — callers treat missing as `initialState`.
 */
export function replayProgression(
  protocols: Protocol[],
  completions: StrengthCompletion[]
): Record<string, ProgressionState> {
  const byId = new Map(protocols.map((p) => [p.id, p]));
  const out: Record<string, ProgressionState> = {};
  const ordered = [...completions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.protocolId.localeCompare(b.protocolId)
  );
  for (const c of ordered) {
    if (c.deload) continue; // race week: progression frozen
    const protocol = byId.get(c.protocolId);
    if (!protocol) continue;
    for (const block of protocol.blocks) {
      const r = c.results.find((x) => x.exercise === block.exercise);
      if (!r) continue;
      const key = progressionKey(protocol.id, block.exercise);
      const prev = out[key] ?? initialState(block, c.date);
      out[key] = applyResult(block, prev, classifySetResult(block, r), c.date);
    }
  }
  return out;
}
