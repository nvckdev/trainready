import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import FitParser from "fit-file-parser";

/**
 * Activity file imports (FIT / TCX / GPX) persisted beside the corpus at
 * data/app/imports.json (gitignored — health-data rule). TCX/GPX are parsed
 * with lightweight built-in XML handling; FIT via fit-file-parser.
 *
 * Consumed by pages ONLY via src/lib/athlete-data.ts (gateway rule).
 */

const IMPORTS_PATH = join(process.cwd(), "data", "app", "imports.json");

export type ImportSport = "run" | "bike" | "swim" | "walk" | "other";

export interface ImportedActivity {
  id: string; // start ISO + sport — stable across re-uploads
  date: string; // YYYY-MM-DD, America/New_York (athlete-facing convention)
  sport: ImportSport;
  durationHr: number;
  distanceKm: number | null;
  avgHr: number | null;
  tssEst: number; // duration-based estimate — always labeled an estimate in UI
  source: "fit" | "tcx" | "gpx" | "intervals.icu";
  fileName?: string;
}

export interface ImportBatch {
  at: string; // ISO timestamp of the upload
  files: number;
  imported: number;
  duplicates: number;
  errors: string[];
}

export interface ImportsStore {
  activities: ImportedActivity[];
  lastBatch?: ImportBatch;
}

/* ---------------- persistence ---------------- */

export function readImports(): ImportsStore {
  try {
    if (!existsSync(IMPORTS_PATH)) return { activities: [] };
    const j = JSON.parse(readFileSync(IMPORTS_PATH, "utf8")) as ImportsStore;
    return { activities: j.activities ?? [], lastBatch: j.lastBatch };
  } catch {
    return { activities: [] };
  }
}

export function writeImports(store: ImportsStore): void {
  mkdirSync(dirname(IMPORTS_PATH), { recursive: true });
  writeFileSync(IMPORTS_PATH, JSON.stringify(store, null, 1));
}

/** Merge new activities into the store, deduping by id. Returns counts. */
export function mergeImports(
  incoming: ImportedActivity[],
  batchMeta: { files: number; errors: string[] }
): ImportBatch {
  const store = readImports();
  const known = new Set(store.activities.map((a) => a.id));
  let imported = 0;
  let duplicates = 0;
  for (const a of incoming) {
    if (known.has(a.id)) {
      duplicates++;
      continue;
    }
    known.add(a.id);
    store.activities.push(a);
    imported++;
  }
  store.activities.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const batch: ImportBatch = {
    at: new Date().toISOString(),
    files: batchMeta.files,
    imported,
    duplicates,
    errors: batchMeta.errors,
  };
  store.lastBatch = batch;
  writeImports(store);
  return batch;
}

/* ---------------- TSS estimation ----------------
 * Same convention as pipeline/lib/estimateTss.ts: TSS ≈ hours × IF² × 100,
 * clamped to [5, 300]. Files carry no workout text to read intensity from,
 * so the IF is a per-sport typical-session default. Always an estimate. */

const SPORT_IF: Record<ImportSport, number> = {
  run: 0.75,
  bike: 0.7,
  swim: 0.72,
  walk: 0.55,
  other: 0.65,
};

export function estimateImportTss(sport: ImportSport, durationHr: number): number {
  const intensity = SPORT_IF[sport];
  const tss = durationHr * intensity * intensity * 100;
  return Math.min(300, Math.max(5, Math.round(tss * 10) / 10));
}

/* ---------------- shared helpers ---------------- */

/** Athlete-facing calendar date in America/New_York (never UTC — rule 16). */
export function nyDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function normalizeSport(raw: string | null | undefined): ImportSport {
  const s = (raw ?? "").toLowerCase();
  if (/run|jog/.test(s)) return "run";
  if (/bik|cycl|ride|velo|e_bik|mtb|gravel/.test(s)) return "bike";
  if (/swim/.test(s)) return "swim";
  if (/walk|hik/.test(s)) return "walk";
  return "other";
}

function finishActivity(p: {
  start: Date;
  sport: ImportSport;
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
  source: ImportedActivity["source"];
  fileName?: string;
}): ImportedActivity | null {
  if (!Number.isFinite(p.start.getTime()) || p.durationSec <= 60) return null;
  const durationHr = p.durationSec / 3600;
  return {
    id: `${p.start.toISOString()}|${p.sport}`,
    date: nyDate(p.start),
    sport: p.sport,
    durationHr: Math.round(durationHr * 1000) / 1000,
    distanceKm:
      p.distanceM && p.distanceM > 0 ? Math.round((p.distanceM / 1000) * 100) / 100 : null,
    avgHr: p.avgHr && p.avgHr > 0 ? Math.round(p.avgHr) : null,
    tssEst: estimateImportTss(p.sport, durationHr),
    source: p.source,
    fileName: p.fileName,
  };
}

const num = (block: string, tag: string): number | null => {
  const m = block.match(new RegExp(`<${tag}>\\s*([\\d.]+)`));
  return m ? parseFloat(m[1]) : null;
};

/* ---------------- TCX ---------------- */

export function parseTcx(xml: string, fileName?: string): ImportedActivity[] {
  const out: ImportedActivity[] = [];
  const activities = xml.match(/<Activity\b[^>]*>[\s\S]*?<\/Activity>/g) ?? [];
  for (const block of activities) {
    const sport = normalizeSport(block.match(/Sport="([^"]*)"/)?.[1]);
    const startRaw =
      block.match(/<Id>\s*([^<\s]+)\s*<\/Id>/)?.[1] ??
      block.match(/<Lap\b[^>]*StartTime="([^"]+)"/)?.[1];
    if (!startRaw) continue;

    let durationSec = 0;
    let distanceM = 0;
    let hrWeighted = 0;
    let hrSec = 0;
    for (const lap of block.match(/<Lap\b[\s\S]*?<\/Lap>/g) ?? []) {
      // Trackpoints carry their own DistanceMeters — read lap summaries only.
      const summary = lap.replace(/<Track>[\s\S]*?<\/Track>/g, "");
      const t = num(summary, "TotalTimeSeconds") ?? 0;
      durationSec += t;
      distanceM += num(summary, "DistanceMeters") ?? 0;
      const hr = summary.match(/<AverageHeartRateBpm>[\s\S]*?<Value>\s*(\d+)/)?.[1];
      if (hr && t > 0) {
        hrWeighted += parseInt(hr, 10) * t;
        hrSec += t;
      }
    }

    const a = finishActivity({
      start: new Date(startRaw),
      sport,
      durationSec,
      distanceM: distanceM > 0 ? distanceM : null,
      avgHr: hrSec > 0 ? hrWeighted / hrSec : null,
      source: "tcx",
      fileName,
    });
    if (a) out.push(a);
  }
  return out;
}

/* ---------------- GPX ---------------- */

const R_EARTH_M = 6371000;
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(a));
}

export function parseGpx(xml: string, fileName?: string): ImportedActivity[] {
  const out: ImportedActivity[] = [];
  const tracks = xml.match(/<trk\b[\s\S]*?<\/trk>/g) ?? [];
  for (const trk of tracks) {
    const meta = trk.replace(/<trkseg>[\s\S]*?<\/trkseg>/g, "");
    const sport = normalizeSport(
      meta.match(/<type>\s*([^<]+?)\s*<\/type>/)?.[1] ?? meta.match(/<name>\s*([^<]+?)\s*<\/name>/)?.[1]
    );

    const times: Date[] = [];
    for (const m of trk.matchAll(/<time>\s*([^<\s]+)\s*<\/time>/g)) {
      const d = new Date(m[1]);
      if (Number.isFinite(d.getTime())) times.push(d);
    }
    if (times.length < 2) continue;

    let distanceM = 0;
    let prev: { lat: number; lon: number } | null = null;
    for (const m of trk.matchAll(/<trkpt\b([^>]*)>/g)) {
      const lat = parseFloat(m[1].match(/lat="([-\d.]+)"/)?.[1] ?? "");
      const lon = parseFloat(m[1].match(/lon="([-\d.]+)"/)?.[1] ?? "");
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (prev) distanceM += haversineM(prev.lat, prev.lon, lat, lon);
      prev = { lat, lon };
    }

    const hrs = [...trk.matchAll(/<(?:\w+:)?hr>\s*(\d+)\s*<\/(?:\w+:)?hr>/g)].map((m) =>
      parseInt(m[1], 10)
    );

    const a = finishActivity({
      start: times[0],
      sport,
      durationSec: (times[times.length - 1].getTime() - times[0].getTime()) / 1000,
      distanceM: distanceM > 0 ? distanceM : null,
      avgHr: hrs.length ? hrs.reduce((s, h) => s + h, 0) / hrs.length : null,
      source: "gpx",
      fileName,
    });
    if (a) out.push(a);
  }
  return out;
}

/* ---------------- FIT ---------------- */

export async function parseFit(buf: ArrayBuffer, fileName?: string): Promise<ImportedActivity[]> {
  const parser = new FitParser({ force: true, mode: "list" });
  const data = await parser.parseAsync(buf);
  const out: ImportedActivity[] = [];
  for (const s of data.sessions ?? []) {
    if (!s.start_time) continue;
    const a = finishActivity({
      start: new Date(s.start_time),
      sport: normalizeSport(s.sport),
      durationSec: s.total_timer_time ?? s.total_elapsed_time ?? 0,
      distanceM: s.total_distance ?? null,
      avgHr: s.avg_heart_rate ?? null,
      source: "fit",
      fileName,
    });
    if (a) out.push(a);
  }
  return out;
}
