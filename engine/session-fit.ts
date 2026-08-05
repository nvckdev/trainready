/**
 * Duration algebra for session templates: spend a budget EXACTLY.
 *
 * A session's declared duration and its structured content are one quantity
 * measured two ways, so they must agree at construction — the same rule the
 * damp path now follows (engine/session-scale.ts). Before this, six templates
 * could not express their own declared duration: bike-vo2 built a fixed 47
 * minutes whatever it was asked for (1.88x a 25-minute slot, 0.31x a
 * 150-minute one), bike-long added its 2 × 20 min tempo ON TOP of a ride
 * duration that already covered it (2.60x), and run-tempo's 15-minute work
 * floor plus run-vo2's 4-rep floor overran short sessions by ~25%.
 *
 * The rule these helpers encode: the budget is hard, and the interval SET is
 * what yields to it. Reps come down before the warmup does — a VO2 session
 * with no warmup is an injury, whereas a VO2 session with three reps instead
 * of four is simply a shorter session, which is what was asked for. Whatever
 * is left after the set is spent on warmup and cooldown, so the total lands on
 * the budget with no residual to round away.
 *
 * Deliberately free of zones, templates and plan types: this is arithmetic,
 * and it is tested as arithmetic.
 */

/**
 * Split the time left over after an interval set into a warmup and a cooldown
 * that, with the set, sum to exactly `budgetSec`.
 *
 * `warmShare` is the warmup's fraction of the leftover (0.6 gives the warmup
 * three fifths, matching how the templates already weighted the two). The
 * cooldown takes the remainder rather than its own rounded share, which is
 * what makes the total exact instead of merely close.
 */
export function fitAround(
  budgetSec: number,
  setSec: number,
  warmShare: number
): { warmSec: number; coolSec: number } {
  const spare = Math.max(0, Math.round(budgetSec) - Math.round(setSec));
  const warmSec = Math.round(spare * warmShare);
  return { warmSec, coolSec: spare - warmSec };
}

/**
 * The most reps that fit in `roomSec`, never fewer than `minReps` and never
 * more than `maxReps`.
 *
 * Recovery runs BETWEEN reps only — n reps carry n-1 recoveries — because
 * that is what the athlete actually does and what the watch executes. A
 * trailing recovery would be time the plan never scheduled.
 *
 * `minReps` wins over the room: below it the session is no longer the session
 * it claims to be, and the caller is better off shortening the warmup (or not
 * scheduling this kind at all) than prescribing a single rep and calling it a
 * VO2 set.
 */
export function repsWithin(
  roomSec: number,
  repSec: number,
  recoverySec: number,
  minReps: number,
  maxReps: number
): number {
  if (!(repSec > 0)) return minReps;
  // n reps cost n·rep + (n-1)·rec, so the largest n with cost ≤ room is
  // floor((room + rec) / (rep + rec)).
  const fits = Math.floor((roomSec + recoverySec) / (repSec + recoverySec));
  return Math.min(maxReps, Math.max(minReps, fits));
}

/**
 * Place a fixed insert (a tempo block inside a long ride) in the middle of a
 * session, returning the easy time on either side of it. Lead plus insert plus
 * tail is exactly `budgetSec` whenever the insert fits.
 *
 * `fits: false` means the insert is longer than the whole session; the caller
 * drops it rather than overrunning, and gets the budget back as lead/tail.
 */
export function splitAround(
  budgetSec: number,
  insertSec: number
): { leadSec: number; tailSec: number; fits: boolean } {
  const budget = Math.round(budgetSec);
  const insert = Math.round(insertSec);
  if (insert <= 0 || insert >= budget) {
    const leadSec = Math.round(budget * 0.6);
    return { leadSec, tailSec: budget - leadSec, fits: false };
  }
  const spare = budget - insert;
  // Slightly more before than after: the hard part belongs past the midpoint
  // of a long ride, once the athlete is warm.
  const leadSec = Math.round(spare * 0.6);
  return { leadSec, tailSec: spare - leadSec, fits: true };
}
