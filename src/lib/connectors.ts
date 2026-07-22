import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ActivitySport, Coverage, ImportedActivity } from "../../engine/activity.ts";
import {
  emptyResult,
  rateCheck,
  rateSpend,
  emptyRateState,
  STRAVA_BUDGET,
  type Connector,
  type FetchResult,
  type RateState,
} from "../../engine/connector.ts";
import { getStravaTokens, getWeekly, readImports, stravaConfigured } from "@/lib/athlete-data";

/**
 * Concrete connectors for the dashboard (rule 12: all I/O lives in src/lib).
 *
 * On what is and is not a live connector here:
 *
 *  - Strava       — a genuine runtime integration. The app holds OAuth tokens
 *                   and calls the API during a request.
 *  - Files        — FIT/TCX/GPX the athlete uploaded. Positive evidence only,
 *                   never coverage (see engine/connector.ts).
 *  - TrainingPeaks — NOT reachable at runtime. TP data enters this repo through
 *                   an agent-driven MCP extraction (.claude/skills/taper-extract)
 *                   that writes data/raw, which the pipeline derives into
 *                   data/derived/weekly.csv. There is no TP API client, no
 *                   cookie handling, and no MCP client in the dependency tree,
 *                   so a live TP connector is a from-scratch build, not a
 *                   wrapper. What ships here reads the DERIVED corpus and
 *                   reports coverage only through its real last-synced date —
 *                   which is the honest thing the app can say today, and it
 *                   keeps the re-auth story truthful (a stale corpus surfaces
 *                   as "needs a refresh", never as a week of no training).
 */

const RATE_PATH = join(process.cwd(), "data", "app", "rate-state.json");

function readRate(source: string): RateState {
  try {
    if (!existsSync(RATE_PATH)) return emptyRateState();
    const all = JSON.parse(readFileSync(RATE_PATH, "utf8")) as Record<string, RateState>;
    return all[source] ?? emptyRateState();
  } catch {
    return emptyRateState();
  }
}

function writeRate(source: string, state: RateState): void {
  try {
    let all: Record<string, RateState> = {};
    if (existsSync(RATE_PATH)) all = JSON.parse(readFileSync(RATE_PATH, "utf8")) as Record<string, RateState>;
    all[source] = state;
    mkdirSync(join(process.cwd(), "data", "app"), { recursive: true });
    writeFileSync(RATE_PATH, JSON.stringify(all, null, 1));
  } catch {
    /* rate accounting is best-effort; never break a sync over it */
  }
}

const iso = (d: Date) => d.toISOString();
const dateOnly = (s: string) => s.slice(0, 10);

function mapStravaSport(type: string): ActivitySport {
  const t = (type || "").toLowerCase();
  if (t.includes("run")) return "run";
  if (t.includes("ride") || t.includes("cycl") || t.includes("bike")) return "bike";
  if (t.includes("swim")) return "swim";
  if (t.includes("weight") || t.includes("strength") || t.includes("workout")) return "strength";
  return "other";
}

interface StravaActivityRaw {
  id?: number;
  start_date?: string;
  type?: string;
  sport_type?: string;
  distance?: number;
  elapsed_time?: number;
  moving_time?: number;
  average_heartrate?: number;
  total_elevation_gain?: number;
  suffer_score?: number;
}

/**
 * Strava. Real OAuth, real fetch, real rate budget.
 *
 * Failure handling is the point: a 401 becomes `unauthorized` (the athlete
 * must reconnect), a 429 becomes `rate-limited`, anything else becomes
 * `unavailable` — and NONE of them contribute coverage. Only a genuinely
 * successful page-through reports a window, and that window starts at the
 * OLDEST activity returned when the last page came back full, because a
 * truncated read cannot vouch for what it never reached.
 */
export const stravaConnector: Connector = {
  source: "strava",
  label: "Strava",
  isConfigured: () => stravaConfigured(),
  async fetchActivities(since: string): Promise<FetchResult> {
    const tokens = await getStravaTokens();
    if (!tokens) return emptyResult("strava", "not-configured", "Strava is not connected.");

    const PER_PAGE = 200;
    const MAX_PAGES = 3;
    let rate = readRate("strava");
    const budget = rateCheck(rate, STRAVA_BUDGET, MAX_PAGES);
    if (!budget.ok) {
      return {
        ...emptyResult("strava", "rate-limited", "Strava's request budget is spent; it will sync again shortly."),
        retryAfter: iso(new Date(Date.now() + budget.waitMs)),
      };
    }

    const after = Math.floor(Date.parse(since + "T00:00:00Z") / 1000);
    const all: StravaActivityRaw[] = [];
    let truncated = false;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=${PER_PAGE}&page=${page}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${tokens.a}` } });
      rate = rateSpend(rate, STRAVA_BUDGET, 1);
      if (res.status === 401) {
        writeRate("strava", rate);
        return emptyResult("strava", "unauthorized", "Strava needs reconnecting — its authorization expired.");
      }
      if (res.status === 429) {
        writeRate("strava", rate);
        return emptyResult("strava", "rate-limited", "Strava rate limit reached; the next sync will pick up where this stopped.");
      }
      if (!res.ok) {
        writeRate("strava", rate);
        return emptyResult("strava", "unavailable", `Strava returned ${res.status}.`);
      }
      const batch = (await res.json()) as StravaActivityRaw[];
      all.push(...batch);
      if (batch.length < PER_PAGE) break;
      if (page === MAX_PAGES) truncated = true;
    }
    writeRate("strava", rate);

    const activities: ImportedActivity[] = all
      .filter((a) => a.start_date && (a.elapsed_time ?? 0) > 60)
      .map((a) => ({
        source: "strava" as const,
        startTime: new Date(a.start_date!).toISOString(),
        sport: mapStravaSport(a.sport_type || a.type || ""),
        distanceM: a.distance && a.distance > 0 ? a.distance : null,
        durationS: a.elapsed_time ?? 0,
        movingTimeS: a.moving_time ?? null,
        avgHr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
        elevationM: a.total_elevation_gain ?? null,
        externalId: a.id != null ? String(a.id) : null,
        // Strava's suffer_score is a relative-effort number, NOT TSS. Leaving
        // this null routes the activity through the engine's own IF²·100
        // model rather than importing a second, incompatible load scale.
        tss: null,
      }));

    // A truncated read can only vouch from its oldest activity forward.
    const oldest = activities.reduce<string | null>(
      (min, a) => (min === null || a.startTime < min ? a.startTime : min),
      null
    );
    const from = truncated && oldest ? dateOnly(oldest) : since;
    const coverage: Coverage[] = [{ source: "strava", from, to: dateOnly(iso(new Date())) }];
    return { source: "strava", status: "ok", activities, coverage, attemptedAt: iso(new Date()) };
  },
};

/** Uploaded FIT/TCX/GPX. Positive evidence only — never any coverage. */
export const fileConnector: Connector = {
  source: "file",
  label: "Uploaded files",
  isConfigured: () => true,
  async fetchActivities(since: string): Promise<FetchResult> {
    const store = readImports();
    const activities: ImportedActivity[] = store.activities
      .filter((a) => a.date >= dateOnly(since))
      .map((a) => ({
        source: (a.source === "intervals.icu" ? "intervals.icu" : "file") as ImportedActivity["source"],
        startTime: new Date(`${a.date}T12:00:00Z`).toISOString(),
        sport: (a.sport === "walk" ? "other" : a.sport) as ActivitySport,
        distanceM: a.distanceKm != null ? a.distanceKm * 1000 : null,
        durationS: Math.round(a.durationHr * 3600),
        movingTimeS: null,
        avgHr: a.avgHr,
        elevationM: null,
        externalId: a.id,
        tss: a.tssEst > 0 ? a.tssEst : null,
      }));
    // No coverage, deliberately: a dropped file says nothing about the days
    // it does not contain.
    return { source: "file", status: "ok", activities, coverage: [], attemptedAt: iso(new Date()) };
  },
};

/**
 * The corpus is NOT a connector — it is a weekly rollup of measured load, and
 * mixing it into the session stream would double-count every week both cover.
 * It enters through executedByWeek's weeklyMeasured override instead. This
 * pair reports what it can honestly vouch for.
 */
export function corpusWeeklyMeasured(): { measured: Map<string, number>; coverage: Coverage[] } {
  const weekly = getWeekly();
  const measured = new Map(weekly.map((w) => [w.weekStart, Math.round(w.tss)]));
  if (!weekly.length) return { measured, coverage: [] };
  // Coverage runs to the END of the last derived week — a stale extraction
  // then reads as "unknown beyond here", never as weeks of no training.
  const last = weekly[weekly.length - 1].weekStart;
  const to = new Date(Date.parse(last + "T12:00:00Z") + 6 * 86400000).toISOString().slice(0, 10);
  return {
    measured,
    coverage: [{ source: "trainingpeaks", from: weekly[0].weekStart, to }],
  };
}

export function dashboardConnectors(): Connector[] {
  return [stravaConnector, fileConnector];
}
