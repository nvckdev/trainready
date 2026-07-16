/**
 * Evidence-honesty layer (feature 6). Every prescriptive claim the app makes
 * carries an internal confidence tier, so copy never implies causal certainty
 * the evidence lacks. The tiers, strongest → weakest:
 *   rct            — randomised controlled trial (but ours are small, n≈30)
 *   observational  — associations from cohort data (faster runners also train
 *                    more, so effects overstate causation)
 *   elite-practice — descriptive: this is how elites train, not proof it's optimal
 *   heuristic      — our reasoned default; say "we think", never "research shows"
 *
 * Pure, dependency-free, and NEVER imported by engine/backtest.ts (a lint test
 * asserts that) — it is copy metadata, not a number that touches a prediction.
 */

export type EvidenceTier = "rct" | "observational" | "elite-practice" | "heuristic";

export interface EvidenceClaim {
  tier: EvidenceTier;
  /** Citation or the honest "this is a heuristic" source. */
  source: string;
  /** Exactly what we assert — phrased at the confidence the tier allows. */
  plainClaim: string;
}

/** The registry: claim-id → its evidence. Copy references these ids. */
export const EVIDENCE: Record<string, EvidenceClaim> = {
  "intensity-distribution": {
    tier: "elite-practice",
    source: "Seiler 2010; descriptive elite training-log data",
    plainClaim: "Elite endurance athletes spend ~80–92% of training time easy; base/build weeks target that band.",
  },
  "fokkema-volume": {
    tier: "observational",
    source: "Fokkema et al. 2020, Scand J Med Sci Sports, n=556",
    plainClaim:
      "Weekly volume over 32 km and a longest run over 21 km are each associated with faster half-marathon times, with no associated injury-risk increase — an observational link, not proof of cause.",
  },
  "polarized-vs-threshold": {
    tier: "rct",
    source: "Stöggl & Sperlich 2014 and similar, small samples (n≈30)",
    plainClaim: "Polarized training outperformed threshold training in a few small randomised trials.",
  },
  "base-reacquisition": {
    tier: "observational",
    source: "Mujika & Padilla 2000; retraining case studies",
    plainClaim:
      "Previously well-trained athletes retain fitness above untrained baseline and reacquire their base faster than a first build — observational and case-study evidence.",
  },
  "tissue-load-management": {
    tier: "heuristic",
    source: "clinical load-management practice (our default, not a trial)",
    plainClaim:
      "We ease load at an aggravated tissue based on your declared symptoms; we think this reduces flare risk, but it is a reasoned default, not a proven prescription.",
  },
  "cross-training-transfer": {
    tier: "heuristic",
    source: "cross-training transfer practice (our default)",
    plainClaim:
      "Non-impact aerobic work can hold some aerobic fitness when running is limited; transfer to running is partial, so we count it separately from running fitness.",
  },
};

export type EvidenceId = keyof typeof EVIDENCE;

/** Phrases that assert causal certainty our evidence does not support. Copy that
 *  is not RCT-backed must never use them (say "we think" / "is linked to" instead). */
export const BANNED_CAUSAL: RegExp[] = [
  /\bresearch shows\b/i,
  /\bstudies show\b/i,
  /\bstudies prove\b/i,
  /\bscientifically proven\b/i,
  /\bclinically proven\b/i,
  /\bproven to\b/i,
  /\bguaranteed to\b/i,
  /\bresearch proves\b/i,
];

/** Does this user-facing string overclaim causal certainty? */
export function isBannedCausalClaim(text: string): boolean {
  return BANNED_CAUSAL.some((re) => re.test(text));
}

/** Strip // line comments and block comments so a copy lint scans STRINGS, not
 *  the honest notes we leave in code comments. Good enough for lint purposes. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** All registered claim ids (for referential-integrity checks). */
export function evidenceIds(): string[] {
  return Object.keys(EVIDENCE);
}

/** Short human label per tier, for the UI badge. */
export const TIER_LABEL: Record<EvidenceTier, string> = {
  rct: "randomised trial (small)",
  observational: "observational",
  "elite-practice": "elite practice",
  heuristic: "our best guess",
};
