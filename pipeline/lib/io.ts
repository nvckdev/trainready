import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Pipeline is always invoked from the repo root (npm run pipeline)
export const ROOT = process.cwd();
export const RAW = join(ROOT, "data/raw");
export const NORMALIZED = join(ROOT, "data/normalized");
export const DERIVED = join(ROOT, "data/derived");
export const DATASETS = join(ROOT, "data/datasets");
export const REPORTS = join(ROOT, "data/reports");

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function listJson(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 1));
}

export function writeJsonl(path: string, rows: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

export function writeCsv(
  path: string,
  header: string[],
  rows: Array<Array<string | number | null>>
): void {
  mkdirSync(dirname(path), { recursive: true });
  const esc = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  writeFileSync(
    path,
    [header.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n") + "\n"
  );
}

export function isoWeekStart(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Monday=0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function* eachDay(start: string, end: string): Generator<string> {
  const d = new Date(start + "T12:00:00Z");
  const stop = new Date(end + "T12:00:00Z");
  while (d <= stop) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}
