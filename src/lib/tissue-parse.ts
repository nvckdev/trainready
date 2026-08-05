/**
 * Tissue declaration vocabulary and parsers — MOVED to engine/tissue-declare.ts
 * when mobile gained the declaration flow. Re-exported for the dashboard's
 * existing import sites; the definitions are shared so the two surfaces cannot
 * offer different sites or infer different caps.
 */
export {
  TISSUE_PROVOCATION_LABEL,
  TISSUE_PROVOCATIONS,
  TISSUE_SITE_LABEL,
  TISSUE_SITES,
  TISSUE_STATUS_LABEL,
  TISSUE_STATUSES,
  parseTissueProvocation,
  parseTissueSite,
  parseTissueStatus,
} from "../../engine/tissue-declare.ts";
