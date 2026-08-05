import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mergeSyncEvidence, sinceForSync, syncAll, type SyncEvidence, type SyncSourceStatus } from "../../engine/connector.ts";
import { dashboardConnectors } from "@/lib/connectors";
import { readPlan } from "@/lib/plan-io";
import { localToday } from "@/lib/athlete-data";

/**
 * Persisted result of activity syncs (rule 13: lives under data/, gitignored).
 *
 * What is stored is the EVIDENCE, not a conclusion: the deduped activity
 * stream plus the coverage windows the sources could honestly vouch for, plus
 * per-source status so the UI can say "Strava needs reconnecting" instead of
 * quietly showing a light week.
 */

const PATH = join(process.cwd(), "data", "app", "sync.json");
/** On-app-open syncs are debounced to this; the manual button ignores it. */
export const SYNC_DEBOUNCE_MS = 30 * 60 * 1000;

// Aliases of the engine's evidence shape — one definition, zero drift.
export type SourceStatus = SyncSourceStatus;

export type SyncStore = SyncEvidence;

const empty: SyncStore = { activities: [], coverage: [], sources: [] };

export function readSyncStore(): SyncStore {
  try {
    if (!existsSync(PATH)) return empty;
    const s = JSON.parse(readFileSync(PATH, "utf8")) as SyncStore;
    return {
      activities: Array.isArray(s.activities) ? s.activities : [],
      coverage: Array.isArray(s.coverage) ? s.coverage : [],
      sources: Array.isArray(s.sources) ? s.sources : [],
      lastSyncAt: s.lastSyncAt,
    };
  } catch {
    return empty;
  }
}

function writeSyncStore(s: SyncStore): void {
  mkdirSync(join(process.cwd(), "data", "app"), { recursive: true });
  writeFileSync(PATH, JSON.stringify(s, null, 1));
}

/** Is an automatic (on-open) sync allowed right now? */
export function syncDue(now = Date.now()): boolean {
  const s = readSyncStore();
  if (!s.lastSyncAt) return true;
  return now - Date.parse(s.lastSyncAt) >= SYNC_DEBOUNCE_MS;
}

/**
 * Run every connector and merge the result into the store.
 *
 * Merge semantics matter as much as fetching. A source that FAILED must not
 * erase what it told us last time — its previous activities and coverage are
 * retained, and only its status flips to the failure. That way a transient
 * Strava outage degrades the freshness of the picture, never its content.
 */
export async function runSync(): Promise<SyncStore> {
  const prev = readSyncStore();
  const todayIso = new Date().toISOString();
  // The window must reach the plan's first week — an 18-week plan outruns
  // the default 120-day lookback, and a window shorter than the plan
  // silently un-covers its early weeks (E10).
  const planStart = readPlan()?.plan.weeks[0]?.weekStart;
  const since = sinceForSync(planStart, todayIso);
  const connectors = dashboardConnectors();
  const summary = await syncAll(connectors, since);
  // Additive by construction (engine mergeSyncEvidence): a refetch can add
  // or corroborate evidence but never erase it, coverage only grows, and a
  // failed source keeps everything it ever contributed. Retention prunes
  // only what precedes the plan by more than a month.
  // No plan ⇒ no prune: erasing to the default window is the E10 bug in
  // miniature. Retention only applies against a KNOWN horizon.
  const pruneBefore = planStart
    ? new Date(Date.parse(planStart + "T12:00:00Z") - 30 * 86400000).toISOString().slice(0, 10)
    : undefined;
  const store = mergeSyncEvidence(prev, summary, connectors, todayIso, pruneBefore);
  writeSyncStore(store);
  return store;
}

/** On-app-open sync: debounced, never throws, safe to call during render's
 *  after() hook. Returns null when it was skipped. */
export async function syncIfDue(): Promise<SyncStore | null> {
  if (!syncDue()) return null;
  try {
    return await runSync();
  } catch {
    return null;
  }
}

export { localToday };
