import type { AthleteState } from "@engine/types.ts";
import { setAthlete, type StoredAthlete } from "./store";

/**
 * The bundled demo athlete: a mid-pack runner with a real-looking recent
 * training block, so a first launch can generate a genuine plan on-device
 * before any history is imported. Clearly flagged demo=true and labeled in
 * the UI — honesty applies to sample data too.
 */
const DEMO_SEED: AthleteState = {
  ctl: 28,
  atl: 26,
  tsb: 2,
  last4WeeksTss: [180, 190, 195, 200],
  trailingWeeksTss: [160, 170, 175, 180, 180, 190, 195, 200],
  last4Shares: { swim: 0, bike: 0, run: 1 },
  daysToNextRace: null,
  weeksSinceStart: 20,
  breakRatio: 1,
  daysSinceLastSession: 1,
};

export const DEMO_ATHLETE: StoredAthlete = {
  name: "Demo athlete",
  thresholds: {
    ftpWatts: 230,
    lthrBpm: 168,
    // ~4:54/km threshold pace — a ~1:48 half on a good day.
    runThresholdSpeedMps: 3.4,
    swimCssMps: 1.25,
  },
  seed: DEMO_SEED,
  demo: true,
};

export async function seedDemoAthlete(): Promise<StoredAthlete> {
  await setAthlete(DEMO_ATHLETE);
  return DEMO_ATHLETE;
}
