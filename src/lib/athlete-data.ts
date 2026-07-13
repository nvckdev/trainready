import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AthleteState } from "../../engine/types.ts";
import { deriveZones, type Thresholds, type Zones } from "../../engine/zones.ts";

/**
 * Server-side access to the local athlete corpus (data/, gitignored).
 * Every reader returns null/[] when the corpus is absent so the app can
 * render its connect-your-data empty state instead of crashing.
 */

const ROOT = process.cwd();
const p = (...seg: string[]) => join(ROOT, "data", ...seg);

export interface AthleteProfile {
  name: string;
  thresholds: Thresholds;
  zones: Zones;
}

export function hasCorpus(): boolean {
  return existsSync(p("datasets", "weekly-examples.jsonl"));
}

/**
 * Today's date (YYYY-MM-DD) in the athlete's timezone, America/New_York.
 * A UTC-derived "today" (toISOString-style) flips to tomorrow after ~8pm
 * local. Every athlete-facing "today" must come from here (rule 16).
 * en-CA locale formats as YYYY-MM-DD.
 */
export function localToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export function getAthlete(): AthleteProfile | null {
  try {
    const a = JSON.parse(readFileSync(p("raw", "athlete.json"), "utf8"));
    const thresholds: Thresholds = {
      ftpWatts: a.thresholds.ftpWatts,
      lthrBpm: a.thresholds.lthrBpm,
      runThresholdSpeedMps:
        a.thresholds.runThresholdSpeedMpsAlt ?? a.thresholds.runThresholdSpeedMps,
      swimCssMps: a.thresholds.swimCssMps,
    };
    return {
      name: a.fullName ?? "Athlete",
      thresholds,
      zones: deriveZones(thresholds),
    };
  } catch {
    return null;
  }
}

export interface HistoryEntry {
  weekStart: string;
  state: AthleteState;
  actualTss: number;
}

export function getHistory(): HistoryEntry[] {
  try {
    return readFileSync(p("datasets", "weekly-examples.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const ex = JSON.parse(l);
        return {
          weekStart: ex.weekStart,
          state: ex.features as AthleteState,
          actualTss: ex.targets.weekTss as number,
        };
      });
  } catch {
    return [];
  }
}

export function getLatestState(): AthleteState | null {
  const h = getHistory();
  return h.length ? h[h.length - 1].state : null;
}

export interface PmcRow {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
}

export function getPmc(): PmcRow[] {
  try {
    const [, ...lines] = readFileSync(p("derived", "pmc.csv"), "utf8").trim().split("\n");
    return lines.map((l) => {
      const [date, tss, ctl, atl, tsb] = l.split(",");
      return { date, tss: +tss, ctl: +ctl, atl: +atl, tsb: +tsb };
    });
  } catch {
    return [];
  }
}

export interface WeeklyRow {
  weekStart: string;
  tss: number;
  hours: number;
  swim: number;
  bike: number;
  run: number;
  other: number;
}

export function getWeekly(): WeeklyRow[] {
  try {
    const [, ...lines] = readFileSync(p("derived", "weekly.csv"), "utf8").trim().split("\n");
    return lines.map((l) => {
      const c = l.split(",");
      return {
        weekStart: c[0],
        tss: +c[1],
        hours: +c[2],
        swim: +c[4],
        bike: +c[5],
        run: +c[6],
        other: +c[7],
      };
    });
  } catch {
    return [];
  }
}

/** Optional athlete context (data/app/athlete-context.json, gitignored).
 *  Currently just a home location for the weather hint. Absent → null. */
export function getAthleteLocation(): { lat: number; lon: number } | null {
  try {
    const ctx = JSON.parse(readFileSync(p("app", "athlete-context.json"), "utf8"));
    const { lat, lon } = ctx?.location ?? {};
    if (typeof lat !== "number" || typeof lon !== "number") return null;
    return { lat, lon };
  } catch {
    return null;
  }
}

/* ---------------- Remote source (deployed site, no local corpus) --------
 * Rule: pages read athlete data through this module only. When data/ is
 * absent, Strava (OAuth cookie) can stand in for the corpus with an
 * estimated PMC — clearly labeled an estimate in the UI. */
export {
  getStravaSnapshot,
  readTokens as getStravaTokens,
  stravaConfigured,
  type RemoteSnapshot,
} from "./strava-data";

/* ---------------- File imports (data/app/imports.json, gitignored) ------ */
export { readImports, type ImportBatch, type ImportedActivity } from "./imports-io";

/* ---------------- intervals.icu (env-gated remote source) --------------- */
export { getIntervalsActivities, intervalsConfigured } from "./intervals-data";
