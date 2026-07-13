import {
  estimateImportTss,
  normalizeSport,
  nyDate,
  type ImportedActivity,
} from "./imports-io";

/**
 * intervals.icu as a remote activity source. Activates only when both env
 * vars are set; otherwise every reader reports unconfigured/empty so the app
 * renders normally. Nothing is persisted — health data never enters git.
 *
 * Consumed ONLY via src/lib/athlete-data.ts — pages never import this
 * module directly (gateway rule).
 */

const API = "https://intervals.icu/api/v1";

export function intervalsConfigured(): boolean {
  return Boolean(process.env.INTERVALS_ICU_API_KEY && process.env.INTERVALS_ICU_ATHLETE_ID);
}

interface IntervalsActivity {
  start_date_local?: string;
  start_date?: string;
  type?: string;
  moving_time?: number; // seconds
  elapsed_time?: number; // seconds
  distance?: number; // meters
  average_heartrate?: number;
  icu_training_load?: number;
  name?: string;
}

/** Recent activities mapped to the imports shape. Returns [] on any failure
 *  (unconfigured, network, auth) — never throws into a page render. */
export async function getIntervalsActivities(days = 42): Promise<ImportedActivity[]> {
  if (!intervalsConfigured()) return [];
  try {
    const oldest = nyDate(new Date(Date.now() - days * 86400000));
    const auth = Buffer.from(`API_KEY:${process.env.INTERVALS_ICU_API_KEY}`).toString("base64");
    const res = await fetch(
      `${API}/athlete/${process.env.INTERVALS_ICU_ATHLETE_ID}/activities?oldest=${oldest}`,
      { headers: { Authorization: `Basic ${auth}` }, cache: "no-store" }
    );
    if (!res.ok) return [];
    const acts = (await res.json()) as IntervalsActivity[];

    const out: ImportedActivity[] = [];
    for (const a of acts) {
      const startRaw = a.start_date_local ?? a.start_date;
      if (!startRaw) continue;
      const start = new Date(startRaw);
      if (!Number.isFinite(start.getTime())) continue;
      const durationSec = a.moving_time ?? a.elapsed_time ?? 0;
      if (durationSec <= 60) continue;
      const sport = normalizeSport(a.type);
      const durationHr = durationSec / 3600;
      // start_date_local is already the athlete's wall-clock date; only a
      // UTC start_date needs converting to America/New_York.
      const date = a.start_date_local
        ? a.start_date_local.slice(0, 10)
        : nyDate(start);
      out.push({
        id: `${start.toISOString()}|${sport}`,
        date,
        sport,
        durationHr: Math.round(durationHr * 1000) / 1000,
        distanceKm:
          a.distance && a.distance > 0 ? Math.round((a.distance / 1000) * 100) / 100 : null,
        avgHr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
        // intervals.icu computes real training load when it can — prefer it.
        tssEst:
          a.icu_training_load && a.icu_training_load > 0
            ? Math.round(a.icu_training_load)
            : estimateImportTss(sport, durationHr),
        source: "intervals.icu",
      });
    }
    return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  } catch {
    return [];
  }
}
