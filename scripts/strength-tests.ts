/**
 * Unit-style tests for the strength progression state machine
 * (src/lib/strength-progression.ts) — hand-verified transitions from
 * docs/strength-module.md §5. Run: `npm run strength:tests` (tsx).
 * Pure module in, deterministic assertions out: no filesystem, no data/,
 * no engine. Exits non-zero on the first failure summary.
 */
import {
  applyResult,
  classifySetResult,
  effectiveRepRange,
  initialState,
  progressionKey,
  replayProgression,
  suggestionFor,
  type CompletionResult,
} from "../src/lib/strength-progression";
import type {
  ProgressionState,
  Protocol,
  ProtocolBlock,
  StrengthCompletion,
} from "../src/lib/strength-protocols";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq<T>(name: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}

const external: ProtocolBlock = {
  exercise: "Rear-foot-elevated split squat",
  sets: 3,
  repRange: [6, 10],
  loadRule: { kind: "external", unit: "kg", increment: 2.5 },
  freqPerWeek: 2,
};
const band: ProtocolBlock = {
  exercise: "Band pull-apart",
  sets: 3,
  repRange: [12, 15],
  loadRule: { kind: "band", ladder: ["yellow", "red", "green", "blue"], index: 0 },
  freqPerWeek: 1,
};
const bodyweight: ProtocolBlock = {
  exercise: "Push-up",
  sets: 3,
  repRange: [8, 15],
  loadRule: { kind: "bodyweight" },
  freqPerWeek: 1,
};

function run(block: ProtocolBlock, results: CompletionResult[]): ProgressionState {
  let state = initialState(block, "2026-01-01");
  results.forEach((r, i) => {
    state = applyResult(block, state, r, `2026-01-${String(i + 2).padStart(2, "0")}`);
  });
  return state;
}

console.log("— classifySetResult");
eq("all sets at top → top", classifySetResult(external, { setsDone: 3, allSetsAtTop: true }), "top");
eq("all sets, not top → made", classifySetResult(external, { setsDone: 3, allSetsAtTop: false }), "made");
eq("short a set → missed", classifySetResult(external, { setsDone: 2, allSetsAtTop: true }), "missed");
eq("zero sets → missed", classifySetResult(external, { setsDone: 0, allSetsAtTop: false }), "missed");

console.log("— external load (kg, ±2.5)");
{
  const one = run(external, ["top"]);
  eq("1× top: load holds at 0 kg", one.currentLoad, { kind: "external", kg: 0 });
  eq("1× top: streak = 1", one.topStreak, 1);

  const two = run(external, ["top", "top"]);
  eq("2× top: +2.5 kg", two.currentLoad, { kind: "external", kg: 2.5 });
  eq("2× top: streak re-earned at 0", two.topStreak, 0);
  eq("2× top: advance recorded", two.lastEvent, "advanced");

  const four = run(external, ["top", "top", "top", "top"]);
  eq("4× top: +5 kg (two advances)", four.currentLoad, { kind: "external", kg: 5 });

  const missTwo = run(external, ["top", "top", "missed", "missed"]);
  eq("advance then 2× missed: back to 0 kg", missTwo.currentLoad, { kind: "external", kg: 0 });
  eq("decrement recorded", missTwo.lastEvent, "decremented");

  const floor = run(external, ["missed", "missed", "missed", "missed"]);
  eq("kg floors at 0", floor.currentLoad, { kind: "external", kg: 0 });

  const mixed = run(external, ["top", "missed", "top", "made", "top", "missed"]);
  eq("mixed results: load never moves", mixed.currentLoad, { kind: "external", kg: 0 });
  eq("mixed results: no event", mixed.lastEvent, undefined);

  const madeReset = run(external, ["top", "made", "top"]);
  eq("made resets the top streak (no advance)", madeReset.currentLoad, { kind: "external", kg: 0 });
  eq("streak restarted at 1", madeReset.topStreak, 1);
}

console.log("— band ladder");
{
  const up = run(band, ["top", "top"]);
  eq("2× top: next band (yellow → red)", up.currentLoad, { kind: "band", index: 1 });

  const capped = run(band, ["top", "top", "top", "top", "top", "top", "top", "top", "top", "top"]);
  eq("ladder caps at the last band", capped.currentLoad, { kind: "band", index: 3 });

  const down = run(band, ["missed", "missed"]);
  eq("band index floors at 0", down.currentLoad, { kind: "band", index: 0 });
}

console.log("— bodyweight (rep-range shift)");
{
  const up = run(bodyweight, ["top", "top"]);
  eq("2× top: +2 added reps", up.currentLoad, { kind: "bodyweight", addedReps: 2 });
  eq("effective range shifts 8–15 → 10–17", effectiveRepRange(bodyweight, up), [10, 17]);

  const floor = run(bodyweight, ["top", "top", "missed", "missed", "missed", "missed"]);
  eq("decrement floors at the template range", floor.currentLoad, { kind: "bodyweight", addedReps: 0 });
  eq("effective range back to template", effectiveRepRange(bodyweight, floor), [8, 15]);
}

console.log("— suggestions");
{
  const one = run(external, ["top"]);
  check("streak of 1 → nudge to repeat", /once more|repeat/i.test(suggestionFor(external, one).hint ?? ""));
  const two = run(external, ["top", "top"]);
  eq("advanced load renders beside exercise", suggestionFor(external, two).load, "2.5 kg");
  check("frozen (deload) silences hints", suggestionFor(external, one, true).hint === null);
  const missOne = run(external, ["missed"]);
  check("one miss → step-back warning", /miss/i.test(suggestionFor(external, missOne).hint ?? ""));
}

console.log("— replayProgression (projection of the completion log)");
{
  const protocol: Protocol = {
    id: "runner-strength",
    name: "Runner general strength",
    blocks: [external, bodyweight],
  };
  const top = (exercise: string) => ({ exercise, setsDone: 3, allSetsAtTop: true });
  const made = (exercise: string) => ({ exercise, setsDone: 3, allSetsAtTop: false });
  const completions: StrengthCompletion[] = [
    // Out of order on purpose — replay must sort by date.
    { date: "2026-01-08", protocolId: "runner-strength", results: [top(external.exercise), made(bodyweight.exercise)] },
    { date: "2026-01-05", protocolId: "runner-strength", results: [top(external.exercise), top(bodyweight.exercise)] },
    // Race-week deload: frozen, must not feed the machine.
    { date: "2026-01-12", protocolId: "runner-strength", results: [top(external.exercise)], deload: true },
    // Unknown protocol: ignored.
    { date: "2026-01-13", protocolId: "ghost", results: [top(external.exercise)] },
  ];
  const state = replayProgression([protocol], completions);
  const key = progressionKey("runner-strength", external.exercise);
  eq("two dated tops advance +2.5 kg", state[key]?.currentLoad, { kind: "external", kg: 2.5 });
  eq("deload completion did not extend the streak", state[key]?.topStreak, 0);
  eq("updatedAt is the last counted completion date", state[key]?.updatedAt, "2026-01-08");
  const bwKey = progressionKey("runner-strength", bodyweight.exercise);
  eq("top then made holds bodyweight load", state[bwKey]?.currentLoad, { kind: "bodyweight", addedReps: 0 });

  // Undo semantics: removing the second top rewinds the advance.
  const undone = replayProgression([protocol], completions.slice(1));
  eq("undo rewinds the machine", undone[key]?.currentLoad, { kind: "external", kg: 0 });
  eq("remaining top keeps streak 1", undone[key]?.topStreak, 1);
}

console.log("");
if (failures.length > 0) {
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`all ${passed} checks passed`);
