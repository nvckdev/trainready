import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  surfaceAlerts,
  upsertPainEntry,
  type PainAlert,
  type PainContext,
  type PainEntry,
  type PainRegion,
} from "@engine/pain.ts";
import { decodePainLog, encodePainLog } from "./health-codec";
import { localToday } from "./store";

/**
 * The phone's pain log — the daily input surface.
 *
 * Offline by construction: AsyncStorage is on-device, so logging pain works
 * standing outside after a run with no signal, which is the only moment this
 * feature is actually used. Nothing here touches the network.
 *
 * The MODEL and the alert rules are engine/pain.ts, shared with the dashboard.
 * This file is storage and nothing else — a second copy of "is this athlete
 * injured" on the phone is precisely the duplication behind every
 * mobile-lags-dashboard incident in this repo.
 *
 * Health data: on-device only, never synced, never in git.
 */

const KEY = "taper.pain.v1";
/** Enough for a season plus margin, without growing unbounded on a device —
 *  same retention as the readiness log. */
const RETAIN_DAYS = 400;

let snapshot: PainEntry[] | null = null;

export async function readPainLog(): Promise<PainEntry[]> {
  if (snapshot) return snapshot;
  snapshot = decodePainLog(await AsyncStorage.getItem(KEY).catch(() => null));
  return snapshot;
}

/** Today's readings, for rendering back what was just logged. */
export async function painFor(date: string): Promise<PainEntry[]> {
  return (await readPainLog()).filter((e) => e.date === date);
}

/** The live alerts, from the same three rules the dashboard applies. */
export async function painAlerts(today = localToday()): Promise<PainAlert[]> {
  return surfaceAlerts(await readPainLog(), today);
}

export interface PainLogResult {
  entries: PainEntry[];
  alerts: PainAlert[];
}

/**
 * Record one reading. Keyed (date, region, context) through the engine's
 * upsert, so correcting "actually it was a 6" replaces the 3 rather than
 * leaving both for the rules to average.
 */
export async function recordPain(
  region: PainRegion,
  score0to10: number,
  context: PainContext,
  today = localToday()
): Promise<PainLogResult> {
  const log = await readPainLog();
  const next = upsertPainEntry(log, { date: today, region, score0to10, context }).filter(
    (e) => Date.parse(e.date) >= Date.now() - RETAIN_DAYS * 86400000
  );
  snapshot = next;
  try {
    await AsyncStorage.setItem(KEY, encodePainLog(next));
  } catch {
    /* a failed write costs the reading, never the log already on disk */
  }
  return { entries: next.filter((e) => e.date === today), alerts: surfaceAlerts(next, today) };
}
