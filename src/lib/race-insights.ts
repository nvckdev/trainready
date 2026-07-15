import { getPmc, getAthleteLocation } from "./athlete-data";
import { loadRaceAnchors, raceDistanceKm } from "../../engine/goal.ts";
import {
  capabilityProfile,
  raceDayPlan,
  type CapabilityProfile,
  type RaceDayPlan,
} from "../../engine/raceday.ts";
import type { Plan } from "../../engine/plan.ts";

/**
 * Server-side accessors for the race-day execution plan and the capability
 * profile. Pages read athlete data through src/lib only (rule 12); these
 * compose the corpus (getPmc, loadRaceAnchors) with the pure engine models
 * (engine/raceday.ts). All null-safe when the corpus is absent.
 */

/** What the athlete could run today across standard distances + % toward the
 *  demonstrated peak-era ceiling. */
export function getCapability(asOf: string): CapabilityProfile | null {
  const pmc = getPmc();
  if (!pmc.length) return null;
  const currentCtl = pmc[pmc.length - 1].ctl;
  return capabilityProfile(currentCtl, loadRaceAnchors(), asOf);
}

/** Race-day pacing + fuelling + (optional) heat adjustment for a run goal race.
 *  Returns null for non-run races (no run goal distance yet) or absent data. */
export async function getRaceDayPlan(plan: Plan, asOf: string): Promise<RaceDayPlan | null> {
  const distanceKm = raceDistanceKm(plan.meta.raceType);
  if (distanceKm == null) return null;

  // Optional race-day forecast: only when a location is recorded AND the race
  // is within Open-Meteo's ~16-day horizon; otherwise no heat adjustment.
  let tempC: number | null = null;
  const loc = getAthleteLocation();
  const daysToRace = Math.round((Date.parse(plan.meta.raceDate) - Date.parse(asOf)) / 86400000);
  if (loc && daysToRace >= 0 && daysToRace <= 15) {
    tempC = await fetchRaceDayHigh(loc.lat, loc.lon, plan.meta.raceDate);
  }

  return raceDayPlan({
    distanceKm,
    projectedRaceCtl: plan.meta.projectedRaceCtl,
    anchors: loadRaceAnchors(),
    asOf,
    tempC,
  });
}

async function fetchRaceDayHigh(lat: number, lon: number, date: string): Promise<number | null> {
  try {
    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${lat}&longitude=${lon}` +
      `&daily=temperature_2m_max&timezone=America%2FNew_York` +
      `&start_date=${date}&end_date=${date}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const j = (await res.json()) as { daily?: { temperature_2m_max?: number[] } };
    const t = j.daily?.temperature_2m_max?.[0];
    return typeof t === "number" ? t : null;
  } catch {
    return null;
  }
}
