import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import type { ActivitySport, Coverage, ImportedActivity } from "@engine/activity.ts";
import { emptyResult, type Connector, type FetchResult } from "@engine/connector.ts";

/**
 * Apple Health — wired, dormant.
 *
 * The seam exists so HealthKit can become the phone's authoritative execution
 * signal without any change to the reconcile path. Today the native module is
 * deliberately NOT a dependency: adding it would end Expo Go as the way to run
 * this app (Expo Go ships a fixed native binary and cannot gain a framework or
 * the com.apple.developer.healthkit entitlement), and on-device testing needs
 * a paid Apple Developer account. So this connector probes for the module and,
 * when it is absent, reports `not-configured` — a fact about this build, not a
 * failure and not a claim about the athlete's training.
 *
 * The load-bearing property (pinned by C2g–C2i): a dormant connector
 * contributes no activities and no coverage, so every week stays exactly as
 * unknown as it was, and done-marks remain the positive-only fallback. Adding
 * it to the connector list changes nothing until the module lands.
 *
 * WHEN THE MODULE IS ADDED, the only edits are inside `loadNativeHealthKit`
 * and `toActivities` below. Nothing else in the app needs to move.
 */

/** Shape this connector needs from whatever native binding is chosen. */
interface NativeHealthKit {
  isHealthDataAvailable(): Promise<boolean>;
  requestAuthorization(read: string[]): Promise<boolean>;
  queryWorkouts(from: string, to: string): Promise<NativeWorkout[]>;
}

interface NativeWorkout {
  uuid?: string;
  activityType?: string;
  startDate: string;
  endDate?: string;
  duration?: number;
  totalDistanceM?: number;
  averageHeartRate?: number;
  elevationAscendedM?: number;
}

/** True on a build that could host HealthKit at all. */
export function healthKitPossible(): boolean {
  return Platform.OS === "ios" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

/** Why HealthKit is unavailable in this build, in the athlete's terms. */
export function healthKitDormantReason(): string {
  if (Platform.OS === "android") return "Apple Health is iOS only. Android support needs Health Connect.";
  if (Platform.OS !== "ios") return "Apple Health is only available in the iOS app.";
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return "Apple Health needs a development build — Expo Go cannot include it.";
  }
  return "Apple Health is not included in this build yet.";
}

/**
 * Resolve the native binding, or null when this build has none.
 *
 * The import is dynamic and inside a try so a missing package is a normal,
 * recoverable outcome rather than a bundling failure — which is what keeps
 * this file safe to ship with no dependency added.
 */
async function loadNativeHealthKit(): Promise<NativeHealthKit | null> {
  if (!healthKitPossible()) return null;
  try {
    // The module name is resolved at runtime so Metro does not try to bundle a
    // package that is not installed. Swap this block for a static import when
    // the dependency lands.
    const name = "@kingstinct/react-native-healthkit";
    const mod = (await import(/* @vite-ignore */ name).catch(() => null)) as unknown;
    if (!mod || typeof mod !== "object") return null;
    return mod as NativeHealthKit;
  } catch {
    return null;
  }
}

const SPORT_BY_HK: Record<string, ActivitySport> = {
  running: "run",
  walking: "other",
  cycling: "bike",
  swimming: "swim",
  traditionalStrengthTraining: "strength",
  functionalStrengthTraining: "strength",
};

/** HKWorkout → the canonical model. Exported so it can be unit-tested without
 *  a device once the module lands. */
export function toActivities(workouts: NativeWorkout[]): ImportedActivity[] {
  return workouts
    .filter((w) => w.startDate && (w.duration ?? 0) > 60)
    .map((w) => ({
      source: "healthkit" as const,
      startTime: new Date(w.startDate).toISOString(),
      sport: SPORT_BY_HK[w.activityType ?? ""] ?? "other",
      distanceM: w.totalDistanceM && w.totalDistanceM > 0 ? w.totalDistanceM : null,
      durationS: Math.round(w.duration ?? 0),
      movingTimeS: null,
      avgHr: w.averageHeartRate ? Math.round(w.averageHeartRate) : null,
      elevationM: w.elevationAscendedM ?? null,
      externalId: w.uuid ?? null,
      // HealthKit has no TSS. Leaving this null routes it through the engine's
      // own IF²·100 model rather than inventing a second load scale.
      tss: null,
    }));
}

const READ_TYPES = ["HKWorkoutTypeIdentifier", "HKQuantityTypeIdentifierHeartRate"];

/**
 * The live connector. Falls back to the dormant one whenever the native module
 * is absent, so the same object is safe to include in the connector list on
 * every platform and in every build.
 */
export const healthKitConnector: Connector = {
  source: "healthkit",
  label: "Apple Health",
  isConfigured: () => healthKitPossible(),
  notConfiguredReason: () => healthKitDormantReason(),
  async fetchActivities(since: string): Promise<FetchResult> {
    const native = await loadNativeHealthKit();
    if (!native) return emptyResult("healthkit", "not-configured", healthKitDormantReason());
    try {
      if (!(await native.isHealthDataAvailable())) {
        return emptyResult("healthkit", "unavailable", "Health data is not available on this device.");
      }
      // Authorization MUST precede any query — querying first is a hard native
      // crash rather than a throw in some bindings.
      const granted = await native.requestAuthorization(READ_TYPES);
      if (!granted) {
        return emptyResult("healthkit", "unauthorized", "Taper needs permission to read workouts in Health.");
      }
      const to = new Date().toISOString();
      const workouts = await native.queryWorkouts(new Date(since + "T00:00:00Z").toISOString(), to);
      const coverage: Coverage[] = [{ source: "healthkit", from: since.slice(0, 10), to: to.slice(0, 10) }];
      return {
        source: "healthkit",
        status: "ok",
        activities: toActivities(workouts),
        coverage,
        attemptedAt: to,
      };
    } catch (e) {
      // A thrown query is unknown, never zero.
      return emptyResult("healthkit", "unavailable", e instanceof Error ? e.message : String(e));
    }
  },
};
