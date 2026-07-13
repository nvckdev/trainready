import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProgressionState, StrengthCompletion } from "./strength-protocols";

/**
 * Strength protocol state gateway (data/app/protocols-state.json, sibling of
 * plan.json inside the gitignored data/ tree — strength state never enters
 * git). Same contract as plan-io.ts: readers return null when the file or
 * data/ is absent (the deployed site has no data/ directory), corrupt JSON
 * reads as absent, writers mkdir -p then pretty-print. No component or page
 * touches the filesystem directly.
 */

const STATE_PATH = join(process.cwd(), "data", "app", "protocols-state.json");

export interface ProtocolsState {
  /** Explicit athlete activation set. Absent = follow the context-derived
   *  defaults (strength-schedule.ts) — the done-toggle never writes this. */
  activeProtocolIds?: string[];
  /** Keyed `${protocolId}␟${exercise}` (same separator as carryStatusForward). */
  progression: Record<string, ProgressionState>;
  completions: StrengthCompletion[];
}

const EMPTY: ProtocolsState = { progression: {}, completions: [] };

export function readProtocolsState(): ProtocolsState | null {
  try {
    if (!existsSync(STATE_PATH)) return null;
    const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const state = parsed as ProtocolsState;
    if (!Array.isArray(state.completions)) state.completions = [];
    if (!state.progression || typeof state.progression !== "object") state.progression = {};
    return state;
  } catch {
    return null;
  }
}

export function writeProtocolsState(state: ProtocolsState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 1));
}

/** Mark a strength session (keyed date + protocolId) done or not-done. */
export function setStrengthDone(
  date: string,
  protocolId: string,
  done: boolean,
  results: StrengthCompletion["results"]
): void {
  const state = readProtocolsState() ?? { ...EMPTY, progression: {}, completions: [] };
  state.completions = state.completions.filter(
    (c) => !(c.date === date && c.protocolId === protocolId)
  );
  if (done) state.completions.push({ date, protocolId, results });
  writeProtocolsState(state);
}

export function isStrengthDone(
  state: ProtocolsState | null,
  date: string,
  protocolId: string
): boolean {
  return !!state?.completions.some((c) => c.date === date && c.protocolId === protocolId);
}
