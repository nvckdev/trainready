export type Discipline =
  | "swim"
  | "bike"
  | "run"
  | "strength"
  | "walk"
  | "other"
  | "unknown";

/** Shape of one workout in the raw tp_get_workouts dumps. */
export interface RawWorkout {
  id: string;
  date: string; // YYYY-MM-DD
  title: string | null;
  type: "completed" | "planned";
  sport: string | null; // null in summary exports; inferred downstream
  duration_planned: number | null; // hours
  duration_actual: number | null; // hours
  distance_planned_km: number | null;
  distance_actual_km: number | null;
  tss: number | null;
  tss_planned: number | null;
  tss_actual: number | null;
  description: string | null;
}

export interface RawChunk {
  workouts: RawWorkout[];
  count: number;
  date_range?: { start: string; end: string };
}

/** Canonical completed session after normalization. */
export interface Session {
  id: string;
  date: string;
  title: string | null;
  discipline: Discipline;
  disciplineConfidence: number; // 0..1
  durationHr: number | null;
  distanceKm: number | null;
  tss: number | null;
  /** Planned pairing, when TrainingPeaks merged a plan into the completion. */
  plannedDurationHr: number | null;
  plannedDistanceKm: number | null;
  plannedTss: number | null;
  /** Estimated planned TSS where TrainingPeaks didn't compute one. */
  plannedTssEst: number | null;
  isRaceLeg: boolean;
}

/** Unmatched planned workout (kept for future compliance modeling). */
export interface PlannedSession {
  id: string;
  date: string;
  title: string | null;
  discipline: Discipline;
  durationHr: number | null;
  distanceKm: number | null;
  tss: number | null;
  /** tss when present, otherwise duration×IF² estimate. */
  tssEst: number | null;
}

export interface DayAggregate {
  date: string;
  tss: number;
  hours: number;
  sessions: number;
  tssByDiscipline: Partial<Record<Discipline, number>>;
  kmByDiscipline: Partial<Record<Discipline, number>>;
}

export interface PmcPoint {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number; // yesterday's ctl − atl (TrainingPeaks convention)
}

export interface WeekAggregate {
  weekStart: string; // Monday
  tss: number;
  hours: number;
  sessions: number;
  tssByDiscipline: Partial<Record<Discipline, number>>;
  rampPct: number | null; // vs mean of prior 4 weeks
}

export interface RaceLabel {
  date: string;
  name: string;
  source: "events" | "detected";
  legs: string[]; // session ids
  totalTss: number | null;
  totalHours: number | null;
  ctlAtRace: number | null;
  atlAtRace: number | null;
  tsbAtRace: number | null;
}
