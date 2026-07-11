import type { Discipline, RawWorkout } from "./types.ts";

/**
 * The summary export carries `sport: null`, so discipline is inferred from
 * title/description keywords plus a speed sanity check (km & duration).
 * Returns the discipline and a 0..1 confidence.
 */

const KEYWORDS: Array<[Discipline, RegExp, number]> = [
  // Swim: set notation is distinctive ("WARMUP (500)", "8 x 50", pull, kick)
  ["swim", /\bswim|pool|open water|css\b/i, 3],
  ["swim", /\b(pull|kick|paddles|stroke|catch-?up|fingertip|scull)\b/i, 2],
  ["swim", /\b\d+\s?x\s?(25|50|75|100|150|200|400|500)\b(?!m? @)/i, 1],
  ["swim", /WARMUP \(\d{3,4}\)/, 2],

  // Bike: power language
  ["bike", /\b(bike|ride|riding|cycling|zwift|watopia|trainer|spin)\b/i, 3],
  ["bike", /\b(ftp|watts?|\d+\s?w\b|cadence|rpm|out of (the )?saddle)\b/i, 2],
  ["bike", /\bramp (up )?50-\d{2}%|zone 2 effort|% ?ftp\b/i, 2],

  // Run: pace language
  ["run", /\b(run|running|jog|shakeout|strides?|treadmill|track|tempo|endurance run)\b/i, 3],
  ["run", /\d:\d{2}\s?\/?\s?km|min\/km|\/km\b/i, 2],
  ["run", /\b(200|400|800|1200|1600)m? @/i, 1],

  // Strength & co
  ["strength", /\b(strength|gym|lift|weights|core|mobility|yoga|stretch)\b/i, 3],
  ["walk", /\b(walk|hike|hiking)\b/i, 3],
];

const RACE_LEG = /\b(transition|t1|t2|bike leg|run leg|swim leg|race)\b/i;

function speedMps(w: RawWorkout): number | null {
  const km = w.distance_actual_km ?? w.distance_planned_km;
  const hr = w.duration_actual ?? w.duration_planned;
  if (!km || !hr || hr <= 0.02) return null;
  return (km * 1000) / (hr * 3600);
}

export function inferDiscipline(w: RawWorkout): {
  discipline: Discipline;
  confidence: number;
  isRaceLeg: boolean;
} {
  const text = `${w.title ?? ""}\n${w.description ?? ""}`;
  const scores = new Map<Discipline, number>();
  for (const [d, re, weight] of KEYWORDS) {
    if (re.test(text)) scores.set(d, (scores.get(d) ?? 0) + weight);
  }

  // Speed evidence: swims are < 1.9 m/s, runs 1.9–5.2, rides > 5.2
  const mps = speedMps(w);
  if (mps !== null) {
    if (mps < 1.9) scores.set("swim", (scores.get("swim") ?? 0) + 2);
    else if (mps < 5.2) scores.set("run", (scores.get("run") ?? 0) + 2);
    else scores.set("bike", (scores.get("bike") ?? 0) + 3);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const isRaceLeg = RACE_LEG.test(w.title ?? "");

  if (ranked.length === 0) {
    return { discipline: "unknown", confidence: 0, isRaceLeg };
  }
  const [top, topScore] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  const confidence = Math.min(1, (topScore - second * 0.5) / 5);
  return { discipline: top, confidence: Math.max(0.1, confidence), isRaceLeg };
}
