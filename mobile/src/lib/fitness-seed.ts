import { dailyExecutedTss, isDayCovered, type Coverage, type ImportedActivity } from "../../engine/activity.ts";
import { seedStateAt, type GapEvidence, type SeededState } from "../../engine/seed.ts";
import type { Plan } from "../../engine/plan.ts";
import type { AthleteState } from "../../engine/types.ts";

/**
 * The phone's fitness seed — the E8 discipline, on mobile's evidence.
 *
 * Until 2026-08-06 mobile had TWO private PMC replays (executedDailyPmc and
 * evidenceSeedState) that filled every day since the pairing anchor with
 * `tssByDate.get(date) ?? 0` and consulted no coverage. Every day no source
 * looked at and the athlete never tapped was silently counted as a proven
 * rest day: zeroLoadDays was 0 by construction, so E8's refusal could never
 * fire, and five untapped training weeks decayed CTL toward a beginner value
 * that the reflow then rebuilt the whole season from — the Mobile-1 fiction,
 * re-entered through the fitness side. The two replays also disagreed with
 * each other by one day (evidenceSeedState rolled THROUGH the target day,
 * seedStateAt stops at its morning), ~12 TSB on a hard training day.
 *
 * Both are gone. The series handed to the engine is the single pairing-anchor
 * row, and engine/seed.ts's own pinned gap loop rolls every day since —
 * counting, per day, whether it is EVIDENCE or ASSUMPTION. One recursion, one
 * provenance rule, shared with the dashboard; mobile no longer carries a PMC
 * copy at all.
 *
 * What counts as evidence on a phone (the athlete's calendar, `localDate`):
 *   - a recorded load — a tapped session or an imported activity — vouches
 *     for itself;
 *   - a day inside a source's coverage window is an authoritative rest;
 *   - a day the PLAN scheduled nothing is rest by prescription. The plan is
 *     the phone's ledger — done-marks only mean anything against it — and the
 *     residual unknown (unprescribed extra training) can only ADD load, the
 *     same one-directional bound MAX_ASSUMED_GAP_DAYS is calibrated for.
 *   - a day the plan scheduled a session and nothing vouches for is an
 *     ASSUMPTION: did they train and not tap, or skip? Either answer moves
 *     fitness, so it counts toward the refusal.
 */

/** Days (athlete calendar) on which the plan prescribed actual training. */
function scheduledDays(plan: Plan | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const w of plan?.weeks ?? []) {
    for (const s of w.sessions) {
      if (s.discipline === "rest") continue;
      out.add(s.date);
    }
  }
  return out;
}

export function mobileGapEvidence(
  plan: Plan | null | undefined,
  imported: ImportedActivity[],
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
  const load = dailyExecutedTss(doneByDate, imported, ctx, localDate);
  const scheduled = scheduledDays(plan);
  return {
    load,
    covered: (day) => isDayCovered(coverage, day) || !scheduled.has(day),
  };
}

/**
 * The athlete's fitness state at the morning of `asOf`, with provenance.
 *
 * The series is ONLY the anchor row — the day the seed's CTL/ATL were
 * measured (pairing). Handing engine/seed.ts a longer, pre-rolled series
 * would hide however many assumed days went into rolling it, which is
 * precisely the hole this replaces. No anchor (pre-anchor pairing codes) ⇒
 * the raw seed, with nothing to account for.
 */
export function seedActualState(
  seed: AthleteState,
  anchor: string | undefined,
  plan: Plan | null | undefined,
  asOf: string,
  imported: ImportedActivity[],
  coverage: Coverage[],
  ctx: { runThresholdMps?: number; lthrBpm?: number },
  localDate: (isoInstant: string) => string
): SeededState {
  if (!anchor) return { ...seed, anchorDate: null, zeroLoadDays: 0, evidencedDays: 0 };
  return seedStateAt(
    seed,
    [{ date: anchor, ctl: seed.ctl, atl: seed.atl }],
    asOf,
    mobileGapEvidence(plan, imported, coverage, ctx, localDate)
  );
}
