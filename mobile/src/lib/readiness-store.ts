import AsyncStorage from "@react-native-async-storage/async-storage";
import { applyReadinessSwap, planReadinessSwap, type ReadinessEntry, type ReadinessLevel } from "@engine/readiness.ts";
import { getPlan, localToday, setPlan } from "./store";

/**
 * The readiness log — one entry per morning, append-only.
 *
 * Stored as structured data rather than transient UI state on purpose. It is
 * the record of what the athlete reported and what the plan did about it, and
 * it is the training data a future sensor-driven version (HRV, sleep) would
 * have to calibrate against: you cannot learn what an athlete's "rough"
 * actually predicts without a history of them saying so. Kept separate from
 * the plan so clearing or regenerating a plan never erases it.
 */

const KEY = "taper.readiness.v1";
/** Entries older than this are pruned — enough to cover a full season plus a
 *  margin, without growing unbounded on a device. */
const RETAIN_DAYS = 400;

let snapshot: ReadinessEntry[] | null = null;

function valid(e: unknown): e is ReadinessEntry {
  if (typeof e !== "object" || e === null) return false;
  const x = e as Record<string, unknown>;
  return (
    typeof x.date === "string" &&
    (x.level === "rough" || x.level === "ok" || x.level === "good") &&
    typeof x.at === "string"
  );
}

export async function readReadiness(): Promise<ReadinessEntry[]> {
  if (snapshot) return snapshot;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    snapshot = Array.isArray(parsed) ? parsed.filter(valid) : [];
  } catch {
    snapshot = [];
  }
  return snapshot;
}

/** Today's entry, when the athlete has already answered. */
export async function readinessFor(date: string): Promise<ReadinessEntry | null> {
  return (await readReadiness()).find((e) => e.date === date) ?? null;
}

export interface ReadinessResult {
  entry: ReadinessEntry;
  /** True when this tap actually moved something — the UI says so only then. */
  moved: boolean;
  /** Athlete-facing sentence, or null when nothing changed. */
  note: string | null;
}

/**
 * Record this morning's reading and, if the engine finds a legal swap, apply
 * it to the stored plan.
 *
 * The swap is decided and applied ONCE, on the first answer of the day. A
 * later tap updates the recorded level — the athlete is allowed to change
 * their mind, and the log should say so — but never moves sessions again,
 * because undoing the first move would need a copy of the original placement
 * that nothing keeps. One morning, one reordering.
 */
export async function recordReadiness(level: ReadinessLevel, today = localToday()): Promise<ReadinessResult> {
  const log = await readReadiness();
  const existing = log.find((e) => e.date === today);
  const stored = getPlan();
  const at = new Date().toISOString();

  let swap = null as ReadinessEntry["swap"];
  let moved = false;
  if (!existing && stored) {
    const proposed = planReadinessSwap({
      weeks: stored.plan.weeks,
      today,
      raceDate: stored.plan.meta.raceDate,
      level,
    });
    if (proposed && applyReadinessSwap(stored.plan.weeks, proposed)) {
      swap = proposed;
      moved = true;
      // Persist the reordered plan. Weekly totals are unchanged by
      // construction, so nothing downstream (reconcile ledger, projections)
      // sees a different week — only the days moved.
      await setPlan({ ...stored });
    }
  }

  const entry: ReadinessEntry = existing
    ? { ...existing, level, at }
    : { date: today, level, at, source: "manual", swap };
  const next = [...log.filter((e) => e.date !== today), entry]
    .filter((e) => Date.parse(e.date) >= Date.now() - RETAIN_DAYS * 86400000)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  snapshot = next;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* a failed write costs the log entry, never the plan */
  }
  return { entry, moved, note: moved ? (swap?.note ?? null) : null };
}
