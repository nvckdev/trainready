import { EVIDENCE, TIER_LABEL, type EvidenceId, type EvidenceTier } from "../../engine/evidence.ts";

/**
 * App-layer gateway for the evidence registry (feature 6). Pages read confidence
 * tiers through here rather than reaching into engine/ directly (rule 12). The
 * registry is pure engine metadata; this only adds display helpers.
 */

export { EVIDENCE, TIER_LABEL };
export type { EvidenceId, EvidenceTier };

/** The evidence behind a claim-id, or null if unknown (never throws in render). */
export function evidenceFor(id: string) {
  return id in EVIDENCE ? EVIDENCE[id as EvidenceId] : null;
}

/** A muted → prominent visual weight per tier, for a badge. Higher tiers read as
 *  more confident; heuristic reads as the most tentative ("our best guess"). */
export const TIER_TONE: Record<EvidenceTier, string> = {
  rct: "text-bone",
  observational: "text-bone-muted",
  "elite-practice": "text-bone-muted",
  heuristic: "text-bone-faint",
};
