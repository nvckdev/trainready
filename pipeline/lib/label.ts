import { join } from "node:path";
import { DERIVED, listJson, RAW, readJson, writeJsonl } from "./io.ts";
import type { PmcPoint, RaceLabel, Session } from "./types.ts";

type LooseEvent = Record<string, unknown>;

function eventDate(e: LooseEvent): string | null {
  for (const k of ["date", "eventDate", "event_date", "startDate", "start_date"]) {
    const v = e[k];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return null;
}

function eventName(e: LooseEvent): string {
  for (const k of ["name", "title", "eventName", "event_name"]) {
    const v = e[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "Unnamed event";
}

function readEvents(): Array<{ date: string; name: string }> {
  const out: Array<{ date: string; name: string }> = [];
  for (const f of listJson(join(RAW, "events"))) {
    const data = readJson<unknown>(f);
    const list = Array.isArray(data)
      ? data
      : ((data as Record<string, unknown>).events as LooseEvent[] | undefined) ?? [];
    for (const e of list) {
      const date = eventDate(e as LooseEvent);
      if (date) out.push({ date, name: eventName(e as LooseEvent) });
    }
  }
  return out;
}

/**
 * Race days from two signals: the events calendar, and detection (a day whose
 * sessions include race-leg titles: Swim/Bike/Run Leg, Transition, Warmup+race
 * notes). Multi-leg detected days are triathlon race days.
 */
export function labelRaces(sessions: Session[], pmc: PmcPoint[]): RaceLabel[] {
  const pmcByDate = new Map(pmc.map((p) => [p.date, p]));
  const byDate = new Map<string, Session[]>();
  for (const s of sessions) {
    byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  }

  const labels = new Map<string, RaceLabel>();

  for (const ev of readEvents()) {
    const legs = byDate.get(ev.date) ?? [];
    labels.set(ev.date, makeLabel(ev.date, ev.name, "events", legs, pmcByDate.get(ev.date)));
  }

  for (const [date, daySessions] of byDate) {
    if (labels.has(date)) continue;
    const legCount = daySessions.filter((s) => s.isRaceLeg).length;
    if (legCount >= 2) {
      labels.set(
        date,
        makeLabel(date, "Detected race day", "detected", daySessions, pmcByDate.get(date))
      );
    }
  }

  const out = [...labels.values()].sort((a, b) => a.date.localeCompare(b.date));
  writeJsonl(join(DERIVED, "races.jsonl"), out);
  return out;
}

function makeLabel(
  date: string,
  name: string,
  source: RaceLabel["source"],
  legs: Session[],
  pmc: PmcPoint | undefined
): RaceLabel {
  return {
    date,
    name,
    source,
    legs: legs.map((l) => l.id),
    totalTss: legs.length ? legs.reduce((s, l) => s + (l.tss ?? 0), 0) : null,
    totalHours: legs.length ? legs.reduce((s, l) => s + (l.durationHr ?? 0), 0) : null,
    ctlAtRace: pmc?.ctl ?? null,
    atlAtRace: pmc?.atl ?? null,
    tsbAtRace: pmc?.tsb ?? null,
  };
}
