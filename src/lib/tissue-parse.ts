import type { TissueProvocation, TissueSite, TissueStatus } from "../../engine/tissue.ts";

/**
 * Untrusted-input parsers for the tissue declaration form, in the same idiom
 * as strength-protocols' parsePainRegion/parsePainScore: a value outside the
 * engine's own union returns null and the action becomes a no-op.
 *
 * Separate from tissue-declarations.ts because that module touches the
 * filesystem and this one is imported by a "use server" file, where a
 * node:fs import at the top level of a shared helper is a hazard worth
 * avoiding.
 */

export const TISSUE_SITES: TissueSite[] = [
  "achilles", "calf", "plantar-fascia", "shin", "knee", "itb", "hip", "foot", "hamstring",
];
export const TISSUE_STATUSES: TissueStatus[] = ["niggle", "tendinopathy", "acute"];
export const TISSUE_PROVOCATIONS: TissueProvocation[] = ["impact", "volume", "speed", "rotation"];

/** Plain-language labels — the athlete is describing a body, not filling in a
 *  taxonomy, so the form says what each choice means for their training. */
export const TISSUE_SITE_LABEL: Record<TissueSite, string> = {
  achilles: "Achilles", calf: "Calf", "plantar-fascia": "Plantar fascia", shin: "Shin",
  knee: "Knee", itb: "IT band", hip: "Hip / glute", foot: "Foot", hamstring: "Hamstring",
};
export const TISSUE_STATUS_LABEL: Record<TissueStatus, string> = {
  niggle: "Niggle — noticeable, not limiting",
  tendinopathy: "Tendinopathy — warms up, aches after",
  acute: "Acute — sharp, limiting now",
};
export const TISSUE_PROVOCATION_LABEL: Record<TissueProvocation, string> = {
  impact: "Impact — pounding, downhills, hard surfaces",
  volume: "Volume — the more I run, the worse it gets",
  speed: "Speed — fast running sets it off",
  rotation: "Rotation — cuts, turns, uneven ground",
};

export const parseTissueSite = (v: unknown): TissueSite | null =>
  TISSUE_SITES.includes(v as TissueSite) ? (v as TissueSite) : null;
export const parseTissueStatus = (v: unknown): TissueStatus | null =>
  TISSUE_STATUSES.includes(v as TissueStatus) ? (v as TissueStatus) : null;
export const parseTissueProvocation = (v: unknown): TissueProvocation | null =>
  TISSUE_PROVOCATIONS.includes(v as TissueProvocation) ? (v as TissueProvocation) : null;
