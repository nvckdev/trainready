import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Coverage, ImportedActivity } from "../../engine/activity.ts";
import { dedupeActivities } from "../../engine/activity.ts";
import { syncAll, type FetchResult } from "../../engine/connector.ts";
import { dashboardConnectors } from "@/lib/connectors";
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
/** How far back a sync reaches. Comfortably wider than any plan's ledger. */
const LOOKBACK_DAYS = 120;
/** On-app-open syncs are debounced to this; the manual button ignores it. */
export const SYNC_DEBOUNCE_MS = 30 * 60 * 1000;

export interface SourceStatus {
  source: string;
  label: string;
  status: FetchResult["status"];
  message?: string;
  lastSyncedAt?: string;
  lastAttemptAt: string;
  activityCount: number;
}

export interface SyncStore {
  activities: ImportedActivity[];
  coverage: Coverage[];
  sources: SourceStatus[];
  lastSyncAt?: string;
}

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
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const connectors = dashboardConnectors();
  const summary = await syncAll(connectors, since);
  const now = new Date().toISOString();

  const okSources = new Set(summary.results.filter((r) => r.status === "ok").map((r) => r.source));
  // Keep prior evidence from sources that did NOT succeed this round.
  const retainedActivities = prev.activities.filter((a) => !okSources.has(a.source));
  const retainedCoverage = prev.coverage.filter((c) => !okSources.has(c.source));

  const sources: SourceStatus[] = connectors.map((c) => {
    const r = summary.results.find((x) => x.source === c.source);
    const before = prev.sources.find((x) => x.source === c.source);
    const ok = r?.status === "ok";
    return {
      source: c.source,
      label: c.label,
      status: r?.status ?? "unavailable",
      message: r?.message,
      lastSyncedAt: ok ? now : before?.lastSyncedAt,
      lastAttemptAt: r?.attemptedAt ?? now,
      activityCount: ok ? (r?.activities.length ?? 0) : (before?.activityCount ?? 0),
    };
  });

  const store: SyncStore = {
    activities: dedupeActivities([...retainedActivities, ...summary.activities]),
    coverage: [...retainedCoverage, ...summary.coverage],
    sources,
    lastSyncAt: now,
  };
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
