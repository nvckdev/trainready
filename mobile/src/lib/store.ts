import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState, useSyncExternalStore } from "react";
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
  /** IANA timezone from the pairing payload — the athlete's clock. One
   *  definition of "today" across surfaces (M3): when present, localToday()
   *  uses it; absent falls back to the device clock. */
  tz?: string;
  /** Date the seed's CTL/ATL were measured (pairing anchor). Without it a
   *  plan generated weeks after pairing starts from stale fitness, and
   *  re-pairing mid-plan double-counts (M5). */
  anchor?: string;
  thresholds: {
    ftpWatts: number;
    lthrBpm: number;
    runThresholdSpeedMps: number;
    swimCssMps: number;
  };
  seed: AthleteState;
  /** True while the seed is the bundled demo, not imported history. */
  demo: boolean;
  /** Population-prior weights carried by the dashboard pairing code
   *  (refinement 2) — makes the learned layer live from week 1 on-device.
   *  Absent ⇒ engine behavior byte-identical. */
  priorWeights?: number[];
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
        const quarantine = () => {
          // The plan is the phone's ONLY training log — an app update whose
          // schema no longer validates an old payload must never erase it
          // (M6). Park the raw bytes under a stable side key (recoverable,
          // overwritten by any later quarantine) and clear the live slot.
          void AsyncStorage.setItem(key + ".quarantine", raw).then(
            () => AsyncStorage.removeItem(key),
            () => AsyncStorage.removeItem(key)
          );
        };
        try {
          const parsed: unknown = JSON.parse(raw);
          if (valid(parsed)) next = parsed;
          else quarantine();
        } catch {
          quarantine();
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

export function getPlan(): StoredPlan | null | undefined {
  return planSlot.get();
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

/**
 * Athlete-local calendar date (YYYY-MM-DD). One definition of "today" (M3):
 * the athlete's paired timezone when known, else the device clock. The
 * dashboard pins the same tz into the pairing payload, so a traveling
 * athlete's two surfaces close weeks on the SAME day instead of a day apart.
 */
export function localToday(): string {
  const tz = athleteSlot.get()?.tz;
  if (tz) {
    try {
      // en-CA formats as YYYY-MM-DD.
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    } catch {
      /* unknown tz string — fall through to the device clock */
    }
  }
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Fire the automatic weekly reconcile at most once per (plan, day). Lives
 *  here so every screen shares one trigger — the first screen the athlete
 *  opens after a week closes is the one that reflows, and the store's
 *  subscription pushes the adjusted plan to all the others. */
const reconcileTried = new Set<string>();
export function useWeeklyReconcile(): void {
  const plan = usePlan();
  const athlete = useAthlete();
  const today = useToday();
  useEffect(() => {
    if (!plan || !athlete) return;
    // The order is now REAL, not a comment: the sync completes (or skips via
    // its debounce) before the reconcile reads evidence, and the evidence
    // generation (lastSyncAt) is part of the idempotence key — so a fresh
    // same-day sync re-evaluates instead of being ignored until midnight
    // (M4). Both dynamic imports keep the engine graph off the launch path.
    void (async () => {
      try {
        const sync = await import("./sync");
        await sync.syncIfDue(Date.now(), plan.plan.weeks[0]?.weekStart);
        const evidence = (await sync.readSync()).lastSyncAt ?? "";
        const key = `${plan.plan.meta.generatedAt}|${plan.plan.meta.lastRecomputed ?? ""}|${today}|${evidence}`;
        if (reconcileTried.has(key)) return;
        reconcileTried.add(key);
        const m = await import("./reconcile");
        await m.reconcileIfDue(plan, athlete, today);
      } catch {
        /* reconcile failures must never break a screen */
      }
    })();
  }, [plan, athlete, today]);
}

/** localToday as reactive state — an app left open across midnight rolls
 *  over instead of showing yesterday's hero until the next focus. */
export function useToday(): string {
  const [today, setToday] = useState(localToday);
  useEffect(() => {
    const id = setInterval(() => {
      const t = localToday();
      setToday((prev) => (prev === t ? prev : t));
    }, 30_000);
    return () => clearInterval(id);
  }, []);
  return today;
}

// Date + week-index helpers are the ENGINE's (plan-ops), re-exported so the
// screens' imports stay unchanged. They used to be local copies, and the
// week-index one silently disagreed with the dashboard's: that version treated
// the final week as running to "9999-12-31" and fell back to week 0, so a date
// before the plan read as "week 1" and a date after the race read as the race
// week forever.
export { addDaysIso, weekIndexContaining as currentWeekIndex } from "@engine/plan-ops.ts";
