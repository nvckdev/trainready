import { sinceForSync } from "../../engine/connector.ts";

/**
 * The sync's time window — PURE, so the E10 wiring is testable.
 *
 * Two decisions ride here, both burned before:
 *  - `since` must reach the plan's first week (an 18-week plan outruns the
 *    default 120-day lookback, and a shorter window silently un-covers the
 *    plan's early weeks — E10).
 *  - `pruneBefore` exists only against a KNOWN horizon: no plan ⇒ no prune,
 *    because erasing to the default window is the E10 bug in miniature.
 *    With a plan, retention keeps a month of pre-plan margin.
 *
 * The engine's own C8/C9 tests pin sinceForSync and mergeSyncEvidence; what
 * they explicitly cannot see is THIS call site's wiring — the engine test
 * pins the un-wired path as byte-identical — so sync-window.test.ts pins it
 * here, with a kill-run against each line.
 */
export function syncWindow(
  planStart: string | undefined,
  todayIso: string
): { since: string; pruneBefore: string | undefined } {
  return {
    since: sinceForSync(planStart, todayIso),
    pruneBefore: planStart
      ? new Date(Date.parse(planStart + "T12:00:00Z") - 30 * 86400000).toISOString().slice(0, 10)
      : undefined,
  };
}
