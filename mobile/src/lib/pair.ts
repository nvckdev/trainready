import type { StoredAthlete } from "./store";

/**
 * Dashboard → phone pairing. The dashboard's Import page prints a one-line
 * code — `TAPER1.` + base64url(JSON) — carrying name, thresholds, and the
 * PMC seed anchored on real logged history. Pasting it here replaces the
 * demo athlete with the athlete the dashboard actually measured.
 */

interface PairPayload {
  v: number;
  name: string;
  thresholds: StoredAthlete["thresholds"];
  seed: StoredAthlete["seed"];
  anchor?: string;
  tz?: string;
  prior?: number[];
}

function b64urlToUtf8(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  // binary string → UTF-8
  let pct = "";
  for (let i = 0; i < bin.length; i++) {
    pct += "%" + bin.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return decodeURIComponent(pct);
}

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function decodePairCode(raw: string): { athlete: StoredAthlete; anchor?: string } | { error: string } {
  const code = raw.trim().replace(/\s+/g, "");
  if (!code) return { error: "Paste the code from the dashboard's Import page." };
  if (!code.startsWith("TAPER1.")) return { error: "That doesn't look like a Taper code (missing TAPER1 prefix)." };
  let payload: PairPayload;
  try {
    payload = JSON.parse(b64urlToUtf8(code.slice("TAPER1.".length))) as PairPayload;
  } catch {
    return { error: "Code didn't decode — copy it again, whitespace and all is fine." };
  }
  if (payload.v !== 1) return { error: `Code version ${payload.v} is newer than this app understands. Update the app.` };
  const t = payload.thresholds;
  const s = payload.seed;
  if (!t || !num(t.runThresholdSpeedMps) || !num(t.lthrBpm) || !num(t.ftpWatts) || !num(t.swimCssMps)) {
    return { error: "Code is missing thresholds." };
  }
  if (!s || !num(s.ctl) || !num(s.atl) || !num(s.tsb) || !Array.isArray(s.last4WeeksTss)) {
    return { error: "Code is missing the fitness seed." };
  }
  const prior =
    Array.isArray(payload.prior) && payload.prior.length === 11 && payload.prior.every(num)
      ? payload.prior
      : undefined;
  const anchor = typeof payload.anchor === "string" ? payload.anchor : undefined;
  const tz = typeof payload.tz === "string" ? payload.tz : undefined;
  return {
    athlete: {
      name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : "Athlete",
      thresholds: t,
      seed: s,
      demo: false,
      ...(prior ? { priorWeights: prior } : {}),
      // Persisted ON the athlete (M3/M5): the tz makes both surfaces agree on
      // "today"; the anchor lets stale seeds decay and re-pairs not
      // double-count.
      ...(anchor ? { anchor } : {}),
      ...(tz ? { tz } : {}),
    },
    anchor,
  };
}
