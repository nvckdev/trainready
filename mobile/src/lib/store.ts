import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Plan, PlanRequest } from "@engine/plan.ts";
import type { AthleteState } from "@engine/types.ts";
import { deriveZones, type Zones } from "@engine/zones.ts";

/**
 * On-device datastore (AsyncStorage, JSON). Mirrors the dashboard's plan-io
 * shapes so the two stay conceptually one product: a stored plan is
 * { request, plan }, and the athlete is thresholds + a seed state. All health
 * data stays on the device — nothing leaves the phone.
 */

const KEYS = {
  athlete: "taper.athlete.v1",
  plan: "taper.plan.v1",
} as const;

export interface StoredAthlete {
  name: string;
  thresholds: {
    ftpWatts: number;
    lthrBpm: number;
    runThresholdSpeedMps: number;
    swimCssMps: number;
  };
  seed: AthleteState;
  /** True while the seed is the bundled demo, not imported history. */
  demo: boolean;
}

export interface StoredPlan {
  request: PlanRequest;
  plan: Plan;
}

export async function readAthlete(): Promise<StoredAthlete | null> {
  const raw = await AsyncStorage.getItem(KEYS.athlete);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAthlete;
  } catch {
    return null;
  }
}

export async function writeAthlete(a: StoredAthlete): Promise<void> {
  await AsyncStorage.setItem(KEYS.athlete, JSON.stringify(a));
}

export async function readPlan(): Promise<StoredPlan | null> {
  const raw = await AsyncStorage.getItem(KEYS.plan);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredPlan;
  } catch {
    return null;
  }
}

export async function writePlan(p: StoredPlan): Promise<void> {
  await AsyncStorage.setItem(KEYS.plan, JSON.stringify(p));
}

export async function clearPlan(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.plan);
}

/** Toggle a session's done mark by (date, title) — the dashboard's keying. */
export async function toggleSessionDone(date: string, title: string): Promise<StoredPlan | null> {
  const stored = await readPlan();
  if (!stored) return null;
  for (const w of stored.plan.weeks) {
    for (const s of w.sessions) {
      if (s.date === date && s.title === title) {
        s.status = s.status === "done" ? undefined : "done";
      }
    }
  }
  await writePlan(stored);
  return stored;
}

export function zonesFor(a: StoredAthlete): Zones {
  return deriveZones(a.thresholds);
}

/** Athlete-local calendar date (YYYY-MM-DD) from the device clock. */
export function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
