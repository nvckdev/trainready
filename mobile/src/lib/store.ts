import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import type { Plan, PlanRequest } from "@engine/plan.ts";
import type { AthleteState } from "@engine/types.ts";
import { deriveZones, type Zones } from "@engine/zones.ts";

/**
 * On-device datastore. AsyncStorage persists; an in-memory snapshot is the
 * source of truth the screens actually read, via useSyncExternalStore — one
 * hydration at startup instead of a storage read on every tab focus, and
 * synchronous mutation so rapid taps can't interleave read-modify-write.
 *
 * Stored JSON is validated on the way in. A payload that parses but no longer
 * matches the schema (an app update changed the shape) is cleared, not
 * crashed on — the app degrades to "no plan", never a red screen on launch.
 * All health data stays on the device — nothing leaves the phone.
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

// ——— validation ————————————————————————————————————————————————————————————

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function validStoredPlan(x: unknown): x is StoredPlan {
  if (!isRecord(x) || !isRecord(x.request) || !isRecord(x.plan)) return false;
  const req = x.request;
  if (typeof req.raceDate !== "string" || typeof req.raceType !== "string") return false;
  const plan = x.plan;
  if (!isRecord(plan.meta) || !Array.isArray(plan.weeks)) return false;
  return plan.weeks.every((w: unknown) => {
    if (!isRecord(w)) return false;
    const proj = w.projected;
    return (
      typeof w.weekStart === "string" &&
      typeof w.targetTss === "number" &&
      typeof w.phase === "string" &&
      Array.isArray(w.sessions) &&
      isRecord(proj) &&
      typeof proj.ctl === "number" &&
      typeof proj.tsb === "number"
    );
  });
}

function validStoredAthlete(x: unknown): x is StoredAthlete {
  if (!isRecord(x) || !isRecord(x.thresholds) || !isRecord(x.seed)) return false;
  const t = x.thresholds;
  return (
    typeof t.runThresholdSpeedMps === "number" &&
    typeof t.lthrBpm === "number" &&
    typeof (x.seed as { ctl?: unknown }).ctl === "number"
  );
}

// ——— slots ——————————————————————————————————————————————————————————————————

interface Slot<T> {
  /** undefined = not yet hydrated; null = absent. */
  get: () => T | null | undefined;
  set: (v: T | null) => Promise<void>;
  subscribe: (fn: () => void) => () => void;
}

function createSlot<T>(key: string, valid: (x: unknown) => x is T): Slot<T> {
  let snap: T | null | undefined;
  const subs = new Set<() => void>();
  const notify = () => subs.forEach((fn) => fn());

  // Hydrate on first subscription, not at module load — subscriptions only
  // happen client-side, so expo-router's node/static render (no window, no
  // storage backend) never touches AsyncStorage. Invalid or corrupt payloads
  // self-heal: the key is removed so the next launch starts clean.
  let hydrating = false;
  const hydrate = () => {
    if (hydrating || snap !== undefined) return;
    hydrating = true;
    void AsyncStorage.getItem(key).then((raw) => {
      let next: T | null = null;
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (valid(parsed)) next = parsed;
          else void AsyncStorage.removeItem(key);
        } catch {
          void AsyncStorage.removeItem(key);
        }
      }
      // A set() that raced hydration wins.
      if (snap === undefined) {
        snap = next;
        notify();
      }
    });
  };

  return {
    get: () => snap,
    async set(v: T | null) {
      snap = v;
      notify();
      if (v === null) await AsyncStorage.removeItem(key);
      else await AsyncStorage.setItem(key, JSON.stringify(v));
    },
    subscribe(fn: () => void) {
      hydrate();
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}

const planSlot = createSlot<StoredPlan>(KEYS.plan, validStoredPlan);
const athleteSlot = createSlot<StoredAthlete>(KEYS.athlete, validStoredAthlete);

// ——— public API ————————————————————————————————————————————————————————————

/** Live plan snapshot: undefined while hydrating, null when absent. */
export function usePlan(): StoredPlan | null | undefined {
  return useSyncExternalStore(planSlot.subscribe, planSlot.get, planSlot.get);
}

/** Live athlete snapshot: undefined while hydrating, null when absent. */
export function useAthlete(): StoredAthlete | null | undefined {
  return useSyncExternalStore(athleteSlot.subscribe, athleteSlot.get, athleteSlot.get);
}

export function setPlan(p: StoredPlan | null): Promise<void> {
  return planSlot.set(p);
}

export function setAthlete(a: StoredAthlete): Promise<void> {
  return athleteSlot.set(a);
}

export function getAthlete(): StoredAthlete | null | undefined {
  return athleteSlot.get();
}

/**
 * Toggle a session's done mark by (date, title) — the dashboard's keying.
 * Synchronous against the in-memory snapshot (persistence trails behind), so
 * two rapid taps toggle twice instead of racing a read-modify-write.
 */
export function toggleSessionDone(date: string, title: string): StoredPlan | null {
  const cur = planSlot.get();
  if (!cur) return null;
  for (const w of cur.plan.weeks) {
    for (const s of w.sessions) {
      if (s.date === date && s.title === title) {
        s.status = s.status === "done" ? undefined : "done";
      }
    }
  }
  const next = { ...cur };
  void planSlot.set(next);
  return next;
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

/** ISO date + n days, DST-safe via noon-UTC anchoring. */
export function addDaysIso(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The week of `weeks` containing `today`, bounded by the next week's start —
 * and, for the last week, by its own end. A finished plan has no current
 * week; it does not pin to the race week forever.
 */
export function currentWeekIndex(weeks: Array<{ weekStart: string }>, today: string): number {
  for (let i = 0; i < weeks.length; i++) {
    const end = weeks[i + 1]?.weekStart ?? addDaysIso(weeks[i].weekStart, 7);
    if (today >= weeks[i].weekStart && today < end) return i;
  }
  return -1;
}
