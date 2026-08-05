/**
 * Pain surface rules — MOVED to engine/pain.ts.
 *
 * Mobile writes the pain log now, and both surfaces must apply the same three
 * alert rules to the same series. A second copy of "is this athlete injured"
 * is the duplication class behind every mobile-lags-dashboard incident in this
 * repo, so the rules live in engine/ and this file only re-exports them for
 * the dashboard's existing import sites.
 */
export {
  isPainHeld,
  surfaceAlerts,
  weeklyPainAverages,
  type PainAlert,
} from "../../engine/pain.ts";
