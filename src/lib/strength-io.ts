import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PainEntry, ProgressionState, StrengthCompletion } from "./strength-protocols";
import { replayProgression } from "./strength-progression";
import { SEED_PROTOCOLS } from "./strength-seed";

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

/**
 * Mark a strength session (keyed date + protocolId) done or not-done, then
 * rebuild the progression map from the full completion log (progression is
 * a projection of completions — strength-progression.ts): re-logging never
 * double-feeds the machine, and an undo rewinds it. Race-week completions
 * carry `deload: true` and are skipped by the replay (§3/§5).
 */
export function setStrengthDone(
  date: string,
  protocolId: string,
  done: boolean,
  results: StrengthCompletion["results"],
  deload = false
): void {
  const state = readProtocolsState() ?? { ...EMPTY, progression: {}, completions: [] };
  state.completions = state.completions.filter(
    (c) => !(c.date === date && c.protocolId === protocolId)
  );
  if (done) state.completions.push({ date, protocolId, results, ...(deload ? { deload } : {}) });
  state.progression = replayProgression(SEED_PROTOCOLS, state.completions);
  writeProtocolsState(state);
}

export function isStrengthDone(
  state: ProtocolsState | null,
  date: string,
  protocolId: string
): boolean {
  return !!state?.completions.some((c) => c.date === date && c.protocolId === protocolId);
}

/* ——— Pain log (data/app/pain-log.json) ————————————————————————
 * Pain logs are HEALTH DATA (taper-rules 13): they exist only inside the
 * gitignored data/ tree and never enter git. Same gateway contract as
 * above — absent or corrupt file reads as an empty log. */

const PAIN_PATH = join(process.cwd(), "data", "app", "pain-log.json");

export function readPainLog(): PainEntry[] {
  try {
    if (!existsSync(PAIN_PATH)) return [];
    const parsed = JSON.parse(readFileSync(PAIN_PATH, "utf8"));
    if (!parsed || !Array.isArray(parsed.entries)) return [];
    return (parsed.entries as PainEntry[]).filter(
      (e) => typeof e?.date === "string" && typeof e?.score0to10 === "number"
    );
  } catch {
    return [];
  }
}

/** Append one entry to the time series. One entry per (date, region,
 *  context): a re-log the same day overwrites (docs/strength-module.md §1). */
export function logPain(entry: PainEntry): void {
  const entries = readPainLog().filter(
    (e) => !(e.date === entry.date && e.region === entry.region && e.context === entry.context)
  );
  entries.push(entry);
  entries.sort((a, b) => a.date.localeCompare(b.date));
  mkdirSync(dirname(PAIN_PATH), { recursive: true });
  writeFileSync(PAIN_PATH, JSON.stringify({ entries }, null, 1));
}
