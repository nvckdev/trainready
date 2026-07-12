import { join } from "node:path";
import { inferDiscipline } from "./sportInfer.ts";
import { estimatePlannedTss } from "./estimateTss.ts";
import { listJson, NORMALIZED, RAW, readJson, writeJson, writeJsonl } from "./io.ts";
import type { PlannedSession, RawChunk, RawWorkout, Session } from "./types.ts";

function nonNullCount(w: RawWorkout): number {
  return Object.values(w).filter((v) => v !== null && v !== undefined).length;
}

export function normalize(): {
  sessions: Session[];
  planned: PlannedSession[];
  stats: Record<string, number>;
} {
  const files = listJson(join(RAW, "workouts"));
  if (files.length === 0) throw new Error("no raw workout chunks in data/raw/workouts");

  // Dedupe across overlapping extraction windows: keep the richest record per id.
  const byId = new Map<string, RawWorkout>();
  let rawTotal = 0;
  for (const f of files) {
    const chunk = readJson<RawChunk>(f);
    for (const w of chunk.workouts) {
      rawTotal++;
      const prev = byId.get(w.id);
      if (!prev || nonNullCount(w) > nonNullCount(prev)) byId.set(w.id, w);
    }
  }

  const sessions: Session[] = [];
  const planned: PlannedSession[] = [];
  let zeroDuration = 0;

  for (const w of [...byId.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const { discipline, confidence, isRaceLeg } = inferDiscipline(w);

    if (w.type === "planned") {
      // "DAY OFF" placeholders carry no load; skip them, keep real plans.
      if (/day off/i.test(w.title ?? "")) continue;
      const tss = w.tss_planned ?? w.tss;
      planned.push({
        id: w.id,
        date: w.date,
        title: w.title,
        discipline,
        durationHr: w.duration_planned,
        distanceKm: w.distance_planned_km,
        tss,
        tssEst:
          tss ??
          estimatePlannedTss({
            discipline,
            durationHr: w.duration_planned,
            distanceKm: w.distance_planned_km,
            title: w.title,
            description: w.description,
          }),
      });
      continue;
    }

    const durationHr = w.duration_actual;
    if (!durationHr || durationHr <= 0) zeroDuration++;

    const hasPlan = w.duration_planned !== null || w.distance_planned_km !== null;
    sessions.push({
      id: w.id,
      date: w.date,
      title: w.title,
      discipline,
      disciplineConfidence: confidence,
      durationHr,
      distanceKm: w.distance_actual_km,
      tss: w.tss_actual ?? w.tss,
      plannedDurationHr: w.duration_planned,
      plannedDistanceKm: w.distance_planned_km,
      plannedTss: w.tss_planned,
      plannedTssEst:
        w.tss_planned ??
        (hasPlan
          ? estimatePlannedTss({
              discipline,
              durationHr: w.duration_planned,
              distanceKm: w.distance_planned_km,
              title: w.title,
              description: w.description,
            })
          : null),
      isRaceLeg,
    });
  }

  const stats = {
    rawRecords: rawTotal,
    uniqueRecords: byId.size,
    duplicatesDropped: rawTotal - byId.size,
    completedSessions: sessions.length,
    plannedUnmatched: planned.length,
    zeroDurationCompleted: zeroDuration,
    unknownDiscipline: sessions.filter((s) => s.discipline === "unknown").length,
    lowConfidence: sessions.filter((s) => s.disciplineConfidence < 0.4).length,
  };

  writeJsonl(join(NORMALIZED, "sessions.jsonl"), sessions);
  writeJsonl(join(NORMALIZED, "planned.jsonl"), planned);
  writeJson(join(NORMALIZED, "normalize-stats.json"), stats);
  return { sessions, planned, stats };
}
