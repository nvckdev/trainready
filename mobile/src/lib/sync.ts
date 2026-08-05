import AsyncStorage from "@react-native-async-storage/async-storage";
import { mergeSyncEvidence, sinceForSync, syncAll, type Connector, type SyncEvidence, type SyncSourceStatus } from "@engine/connector.ts";
import { healthKitConnector } from "./healthkit";
import { getPlan } from "./store";

/**
 * On-device activity sync — the phone's mirror of the dashboard's sync-io.
 *
 * Same contract, same safety rule: what gets stored is EVIDENCE (activities +
 * the coverage windows sources could honestly vouch for + per-source status),
 * never a conclusion. A source that fails keeps whatever it told us last time
 * and only flips its status, so an outage degrades freshness rather than
 * content — and never manufactures a week of no training.
 */

const KEY = "taper.sync.v1";
export const SYNC_DEBOUNCE_MS = 30 * 60 * 1000;

// The store IS the engine's evidence shape — aliasing (not re-declaring)
// is what stops this surface drifting behind the dashboard again.
export type MobileSourceStatus = SyncSourceStatus;
export type MobileSyncStore = SyncEvidence;

const EMPTY: MobileSyncStore = { activities: [], coverage: [], sources: [] };

/** Connectors available on the phone. HealthKit is present but dormant until
 *  a build carries the native module — including it changes nothing today
 *  (pinned by connector.test C2i). */
export function mobileConnectors(): Connector[] {
  return [healthKitConnector];
}

let snapshot: MobileSyncStore | null = null;

export async function readSync(): Promise<MobileSyncStore> {
  if (snapshot) return snapshot;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as MobileSyncStore;
    snapshot = {
      activities: Array.isArray(parsed.activities) ? parsed.activities : [],
      coverage: Array.isArray(parsed.coverage) ? parsed.coverage : [],
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      lastSyncAt: parsed.lastSyncAt,
    };
    return snapshot;
  } catch {
    return EMPTY;
  }
}

export async function runSync(planStart?: string): Promise<MobileSyncStore> {
  const prev = await readSync();
  const todayIso = new Date().toISOString();
  // Window reaches the plan start; merge is the shared ADDITIVE engine
  // merge — evidence accumulates, a failed source keeps its contribution,
  // and (the drift the audit flagged) lastAttemptAt now exists here too.
  const since = sinceForSync(planStart, todayIso);
  const connectors = mobileConnectors();
  const summary = await syncAll(connectors, since);
  // Prune ONLY when the plan horizon is known. The review caught Settings'
  // SYNC NOW calling runSync() bare: pruneBefore fell back to the 120-day
  // window and re-erased exactly the early-plan evidence E10 promised to
  // keep. Unknown horizon ⇒ keep everything.
  const effectivePlanStart = planStart ?? getPlan()?.plan.weeks[0]?.weekStart;
  const pruneBefore = effectivePlanStart
    ? new Date(Date.parse(effectivePlanStart + "T12:00:00Z") - 30 * 86400000).toISOString().slice(0, 10)
    : undefined;
  const next = mergeSyncEvidence(prev, summary, connectors, todayIso, pruneBefore);
  snapshot = next;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* a failed write costs freshness, never correctness */
  }
  return next;
}

/** On-app-open sync: debounced, never throws. Returns null when skipped. */
export async function syncIfDue(now = Date.now(), planStart?: string): Promise<MobileSyncStore | null> {
  const cur = await readSync();
  if (cur.lastSyncAt && now - Date.parse(cur.lastSyncAt) < SYNC_DEBOUNCE_MS) return null;
  try {
    return await runSync(planStart);
  } catch {
    return null;
  }
}
