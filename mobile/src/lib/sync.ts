import AsyncStorage from "@react-native-async-storage/async-storage";
import { dedupeActivities, type Coverage, type ImportedActivity } from "@engine/activity.ts";
import { syncAll, type Connector, type FetchStatus } from "@engine/connector.ts";
import { healthKitConnector } from "./healthkit";

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
const LOOKBACK_DAYS = 120;
export const SYNC_DEBOUNCE_MS = 30 * 60 * 1000;

export interface MobileSourceStatus {
  source: string;
  label: string;
  status: FetchStatus;
  message?: string;
  lastSyncedAt?: string;
  activityCount: number;
}

export interface MobileSyncStore {
  activities: ImportedActivity[];
  coverage: Coverage[];
  sources: MobileSourceStatus[];
  lastSyncAt?: string;
}

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

/** Synchronous view for render paths; undefined until the first read. */
export function peekSync(): MobileSyncStore | null {
  return snapshot;
}

export async function runSync(): Promise<MobileSyncStore> {
  const prev = await readSync();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const connectors = mobileConnectors();
  const summary = await syncAll(connectors, since);
  const now = new Date().toISOString();

  const okSources = new Set(summary.results.filter((r) => r.status === "ok").map((r) => r.source));
  const retainedActivities = prev.activities.filter((a) => !okSources.has(a.source));
  const retainedCoverage = prev.coverage.filter((c) => !okSources.has(c.source));

  const sources: MobileSourceStatus[] = connectors.map((c) => {
    const r = summary.results.find((x) => x.source === c.source);
    const before = prev.sources.find((x) => x.source === c.source);
    const ok = r?.status === "ok";
    return {
      source: c.source,
      label: c.label,
      status: r?.status ?? "unavailable",
      message: r?.message,
      lastSyncedAt: ok ? now : before?.lastSyncedAt,
      activityCount: ok ? (r?.activities.length ?? 0) : (before?.activityCount ?? 0),
    };
  });

  const next: MobileSyncStore = {
    activities: dedupeActivities([...retainedActivities, ...summary.activities]),
    coverage: [...retainedCoverage, ...summary.coverage],
    sources,
    lastSyncAt: now,
  };
  snapshot = next;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* a failed write costs freshness, never correctness */
  }
  return next;
}

/** On-app-open sync: debounced, never throws. Returns null when skipped. */
export async function syncIfDue(now = Date.now()): Promise<MobileSyncStore | null> {
  const cur = await readSync();
  if (cur.lastSyncAt && now - Date.parse(cur.lastSyncAt) < SYNC_DEBOUNCE_MS) return null;
  try {
    return await runSync();
  } catch {
    return null;
  }
}
