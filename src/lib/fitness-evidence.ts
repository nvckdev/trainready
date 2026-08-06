import { dedupeActivities, dailyExecutedTss, isDayCovered, type Coverage, type ImportedActivity } from "../../engine/activity.ts";
import type { GapEvidence } from "../../engine/seed.ts";
import { thresholdMpsFromZones } from "../../engine/zones.ts";
import type { Plan } from "../../engine/plan.ts";
import { getAthlete } from "@/lib/athlete-data";
import { nyDate } from "@/lib/imports-io";
import { readSyncStore } from "@/lib/sync-io";

/**
 * What the athlete did between the last extracted corpus day and today (E8).
 *
 * The corpus is refreshed by an agent-driven extraction, so it always trails
 * reality by days or weeks. getStateAt used to roll that tail forward at ZERO
 * load — the plain absence-is-not-zero mistake, in the one place it silently
 * rewrites a whole season: the reconcile gate would correctly fire on real
 * Strava evidence, and then the reflow prescribed every remaining week from a
 * CTL that had decayed ~40% over three stale weeks.
 *
 * This is deliberately NOT a second execution model. It is the same merged
 * daily stream the gate judges on — dailyExecutedTss over the deduped sync
 * activities plus the stored plan's done-marks — handed to the same PMC
 * recursion that was already in engine/seed.ts. One ruler, one recursion.
 */
/**
 * The pure core: gap evidence from explicit inputs. Exported so the wiring —
 * which source feeds which field — is testable; gapEvidence() below is the
 * thin reader that gathers the live inputs and MUST add nothing else.
 */
export function gapEvidenceFrom(
  plan: Plan | null | undefined,
  activities: ImportedActivity[],
  coverage: Coverage[],
  ctx: { runThresholdMps?: number; lthrBpm?: number },
  localDate: (isoInstant: string) => string
): GapEvidence {
  // Done-marks are positive-only evidence, exactly as in the weekly rollup:
  // a tapped session proves training happened, an untapped day proves
  // nothing. They never contribute coverage.
  const doneByDate = new Map<string, number>();
  for (const w of plan?.weeks ?? []) {
    for (const s of w.sessions) {
      if (s.status !== "done") continue;
      doneByDate.set(s.date, (doneByDate.get(s.date) ?? 0) + s.tss);
    }
  }
  const load = dailyExecutedTss(doneByDate, activities, ctx, localDate);
  return { load, covered: (day) => isDayCovered(coverage, day) };
}

export function gapEvidence(plan?: Plan | null): GapEvidence {
  const athlete = getAthlete();
  const ctx = athlete
    ? { runThresholdMps: thresholdMpsFromZones(athlete.zones), lthrBpm: athlete.thresholds.lthrBpm }
    : {};
  const sync = readSyncStore();
  return gapEvidenceFrom(
    plan,
    dedupeActivities(sync.activities),
    sync.coverage,
    ctx,
    // Bucket on the athlete's calendar, the same clock the plan's dates and
    // the weekly rollup use (E7) — an evening run belongs to the day the
    // athlete ran it.
    (iso) => nyDate(new Date(iso))
  );
}
