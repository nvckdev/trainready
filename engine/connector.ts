import type { ActivitySource, Coverage, ImportedActivity } from "./activity.ts";

/**
 * The connector contract.
 *
 * Pure types + pure combinators; every actual network call lives in the app
 * layer (src/lib for the dashboard, mobile/src/lib for the phone). This file
 * exists so both surfaces agree on ONE thing above all:
 *
 *   an import that fails is not a week of rest.
 *
 * The reconcile engine distinguishes an authoritative zero ("we looked, they
 * trained nothing") from unknown ("we could not look"). A connector that
 * returns `[]` on error destroys that distinction and re-creates the bug the
 * reconcile gate was built to fix. So a fetch result is a tagged union, and
 * only `ok` may contribute coverage.
 */

export type FetchStatus = "ok" | "unauthorized" | "rate-limited" | "unavailable" | "not-configured";

export interface FetchResult {
  source: ActivitySource;
  status: FetchStatus;
  /** Activities found. Non-empty only when status is "ok". */
  activities: ImportedActivity[];
  /**
   * The window this fetch can honestly speak for — populated ONLY on `ok`,
   * and only by sources that query a RANGE. A file drop returns [] here even
   * on success: it says nothing about the dates it doesn't contain.
   */
  coverage: Coverage[];
  /** Athlete-facing explanation when status !== "ok". */
  message?: string;
  /** For rate-limited: when it is worth trying again (ISO). */
  retryAfter?: string;
  /** ISO timestamp of this attempt, successful or not. */
  attemptedAt: string;
}

export interface Connector {
  source: ActivitySource;
  /** Human label for the sync UI. */
  label: string;
  /** False ⇒ the athlete has not connected it; never treated as a failure. */
  isConfigured(): boolean;
  /** Why it is unconfigured, in the athlete's terms. Without this the UI can
   *  only say "not connected", which is wrong for a source that is
   *  unavailable for a STRUCTURAL reason — "Apple Health is iOS only" is a
   *  different fact from "you haven't linked it yet". */
  notConfiguredReason?(): string;
  /** Fetch activities on/after `since` (ISO date). Must NEVER throw — a thrown
   *  connector is converted to `unavailable` by `runConnector`. */
  fetchActivities(since: string): Promise<FetchResult>;
}

/** A result that contributes no evidence at all. */
export function emptyResult(source: ActivitySource, status: FetchStatus, message?: string): FetchResult {
  return { source, status, activities: [], coverage: [], message, attemptedAt: new Date().toISOString() };
}

/**
 * Invoke a connector so that no failure can ever masquerade as "no training".
 * A throw, a rejected promise, or a timeout all become `unavailable` with no
 * coverage — which the rollup reads as unknown, and the gate refuses to
 * reflow on.
 */
export async function runConnector(c: Connector, since: string, timeoutMs = 15000): Promise<FetchResult> {
  if (!c.isConfigured()) {
    return emptyResult(c.source, "not-configured", c.notConfiguredReason?.() ?? `${c.label} is not connected.`);
  }
  try {
    const timeout = new Promise<FetchResult>((_, rej) =>
      setTimeout(() => rej(new Error(`${c.label} timed out`)), timeoutMs)
    );
    const res = await Promise.race([c.fetchActivities(since), timeout]);
    // Defend the invariant even against a well-meaning connector: coverage is
    // only meaningful on success.
    if (res.status !== "ok" && res.coverage.length) {
      return { ...res, coverage: [] };
    }
    return res;
  } catch (e) {
    return emptyResult(c.source, "unavailable", e instanceof Error ? e.message : String(e));
  }
}

export interface SyncSummary {
  results: FetchResult[];
  /** Every activity across every ok source, still RAW (not yet deduped). */
  activities: ImportedActivity[];
  /** Union of the windows the ok sources can speak for. */
  coverage: Coverage[];
  /** True when at least one configured source failed — the UI should say so,
   *  because it means the picture is incomplete, not that the athlete rested. */
  degraded: boolean;
}

/** Fan out across connectors, collecting evidence without ever letting one
 *  source's failure look like another's silence. */
export async function syncAll(connectors: Connector[], since: string): Promise<SyncSummary> {
  const results = await Promise.all(connectors.map((c) => runConnector(c, since)));
  const ok = results.filter((r) => r.status === "ok");
  return {
    results,
    activities: ok.flatMap((r) => r.activities),
    coverage: ok.flatMap((r) => r.coverage),
    degraded: results.some((r) => r.status === "unauthorized" || r.status === "rate-limited" || r.status === "unavailable"),
  };
}

// ——— rate limiting ————————————————————————————————————————————————————————

/**
 * Strava's published limits: 200 requests / 15 min and 2000 / day. Exceeding
 * them gets the whole app's token throttled, so the budget is tracked per
 * source and checked BEFORE spending a request.
 */
export interface RateBudget {
  shortLimit: number;
  shortWindowMs: number;
  dailyLimit: number;
}

export const STRAVA_BUDGET: RateBudget = {
  shortLimit: 200,
  shortWindowMs: 15 * 60 * 1000,
  dailyLimit: 2000,
};

export interface RateState {
  /** Epoch ms of each recent request, newest last. */
  recent: number[];
  /** Epoch ms of the start of the current day bucket. */
  dayStart: number;
  dayCount: number;
}

export function emptyRateState(now = Date.now()): RateState {
  return { recent: [], dayStart: now, dayCount: 0 };
}

/** May we spend `n` requests right now? Returns the wait in ms when not. */
export function rateCheck(state: RateState, budget: RateBudget, n = 1, now = Date.now()): { ok: boolean; waitMs: number } {
  const recent = state.recent.filter((t) => now - t < budget.shortWindowMs);
  const dayElapsed = now - state.dayStart;
  const dayCount = dayElapsed >= 86400000 ? 0 : state.dayCount;
  if (dayCount + n > budget.dailyLimit) {
    return { ok: false, waitMs: Math.max(0, 86400000 - dayElapsed) };
  }
  if (recent.length + n > budget.shortLimit) {
    const oldest = recent[0] ?? now;
    return { ok: false, waitMs: Math.max(0, budget.shortWindowMs - (now - oldest)) };
  }
  return { ok: true, waitMs: 0 };
}

/** Record `n` spent requests. */
export function rateSpend(state: RateState, budget: RateBudget, n = 1, now = Date.now()): RateState {
  const recent = state.recent.filter((t) => now - t < budget.shortWindowMs);
  for (let i = 0; i < n; i++) recent.push(now);
  const rolled = now - state.dayStart >= 86400000;
  return {
    recent,
    dayStart: rolled ? now : state.dayStart,
    dayCount: (rolled ? 0 : state.dayCount) + n,
  };
}

/**
 * A connector whose backing implementation is not present on this platform or
 * in this build — the seam for a source that is wired but dormant.
 *
 * This is deliberately a first-class concept rather than an omission. A source
 * the athlete could connect but hasn't, a source that needs a native module
 * this build lacks, and a source that FAILED are three different facts, and
 * only the third means "the picture is incomplete". A dormant connector
 * reports `not-configured`, contributes no activities and no coverage, and so
 * leaves every week exactly as unknown as it was before — the reconcile path
 * is byte-identical whether it is in the list or not.
 */
export function dormantConnector(source: ActivitySource, label: string, reason: string): Connector {
  return {
    source,
    label,
    isConfigured: () => false,
    notConfiguredReason: () => reason,
    fetchActivities: async () => emptyResult(source, "not-configured", reason),
  };
}
