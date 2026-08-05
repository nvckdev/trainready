import type { Zone } from "./types.ts";

/**
 * Tissue constraints as a REAL model (feature 4) — replacing the ad-hoc
 * "calf conservatism factor" (the old unconditional INJURY_CAP_KM in goal.ts).
 *
 * A constraint is a structured, JUSTIFIED reason to cap load at a specific
 * tissue: site + clinical status + what provokes it + the caps it implies, each
 * publishing WHY it caps what it caps. Constraints are user-declared or inferred
 * from the pain tracker (app layer) and threaded into generatePlan via the
 * request — the engine stays pure and never reaches into src/.
 *
 * The evidence discipline (Fokkema 2020 found NO volume–injury association):
 * caps are applied ONLY when a constraint is actually present. With none active
 * the resolver returns null and every cap site in the generator takes its
 * pre-existing path — a healthy athlete is never capped prophylactically, and
 * their plan is byte-identical whether the constraint field is absent or [].
 *
 * Pure module. No PMC, no backtest, no src imports.
 */

export type TissueSite =
  | "achilles"
  | "calf"
  | "plantar-fascia"
  | "shin"
  | "knee"
  | "itb"
  | "hip"
  | "foot"
  | "hamstring";

/** Clinical severity, mildest → most limiting. */
export type TissueStatus = "niggle" | "tendinopathy" | "acute";

/** What loading pattern aggravates the tissue — drives WHICH caps bind. */
export type TissueProvocation = "impact" | "volume" | "speed" | "rotation";

/** The levers a constraint can pull. All optional: a constraint caps only what
 *  its provocation justifies (a rotation-provoked tendon caps speed, not volume). */
export interface TissueCaps {
  /** Hard ceiling on weekly running km. */
  weeklyKm?: number;
  /** Hard ceiling on the long-run km. */
  longRunKm?: number;
  /** Highest running intensity zone allowed (blocks anything above it). */
  maxSessionIntensity?: Zone;
  /** Week-over-week ramp ceiling as a multiplier (1.10 = +10%/wk max). */
  rampCeiling?: number;
}

export interface TissueConstraint {
  site: TissueSite;
  status: TissueStatus;
  provocation: TissueProvocation;
  /** The caps this constraint imposes (populate via deriveTissueCaps or declare). */
  caps: TissueCaps;
  /** Optional human "why". Falls back to a derived sentence (tissueReason). */
  why?: string;
}

// Zone intensity order (Z1 → Z3), for resolving the most-restrictive ceiling.
const ZONE_ORDER: Zone[] = ["recovery", "easy", "tempo", "threshold", "cv", "vo2", "race"];
const zoneRank = (z: Zone) => ZONE_ORDER.indexOf(z);

/**
 * Default caps for a declared constraint, by status + provocation. A helper for
 * the declaration/inference layer — the athlete says "calf tendinopathy,
 * rotation-provoked" and this fills sensible caps. `status` scales severity
 * (sev 0 = acute/most-limiting → 2 = niggle); `provocation` selects WHICH lever
 * binds, so a cap is only imposed where it is justified:
 *   impact/rotation → long-run km   (the repeated loading of long efforts)
 *   volume          → weekly + long km
 *   speed           → intensity ceiling
 * A ramp ceiling is added ONLY for an acute flare (feature 3's base-richness
 * otherwise governs the ramp — we don't double-limit it for a chronic niggle).
 */
export function deriveTissueCaps(status: TissueStatus, provocation: TissueProvocation): TissueCaps {
  const caps: TissueCaps = {};
  const sev = status === "acute" ? 0 : status === "tendinopathy" ? 1 : 2;
  if (status === "acute") caps.rampCeiling = 1.05; // hold the ramp only during a flare
  switch (provocation) {
    case "impact":
      caps.longRunKm = [14, 22, 28][sev];
      break;
    case "rotation":
      // Lower-leg tendons (e.g. calf/Achilles): the long run's repeated loading
      // is the aggravator, not weekly total — cap the single longest effort.
      caps.longRunKm = [16, 24, 30][sev];
      break;
    case "volume":
      caps.weeklyKm = [24, 38, 52][sev];
      caps.longRunKm = [16, 26, 32][sev];
      break;
    case "speed":
      caps.maxSessionIntensity = (["easy", "threshold", "cv"] as const)[sev];
      break;
  }
  return caps;
}

/** Build a full declared constraint with derived caps — the app's and tests'
 *  one-liner. `why` overrides the derived sentence when the athlete gave a note. */
export function declareTissue(
  site: TissueSite,
  status: TissueStatus,
  provocation: TissueProvocation,
  why?: string
): TissueConstraint {
  return { site, status, provocation, caps: deriveTissueCaps(status, provocation), why };
}

/**
 * What a constraint actually caps, in the athlete's units.
 *
 * Split out of tissueReason so a declaration UI can show the caps BESIDE the
 * athlete's own words rather than instead of them: tissueReason returns the
 * note when there is one, which is right for the plan page and would leave a
 * declaration form unable to say what it was about to do.
 */
export function tissueCapSummary(c: TissueConstraint): string {
  const bits: string[] = [];
  if (c.caps.longRunKm != null) bits.push(`long run held ≤ ${c.caps.longRunKm} km`);
  if (c.caps.weeklyKm != null) bits.push(`weekly volume ≤ ${c.caps.weeklyKm} km`);
  if (c.caps.maxSessionIntensity != null) bits.push(`intensity capped at ${c.caps.maxSessionIntensity}`);
  if (c.caps.rampCeiling != null) bits.push(`ramp held to +${Math.round((c.caps.rampCeiling - 1) * 100)}%/wk`);
  return bits.length ? bits.join(", ") : "load eased";
}

/** Human "why" for a constraint — shown in the UI beside the cap it explains. */
export function tissueReason(c: TissueConstraint): string {
  if (c.why) return c.why;
  const site = c.site.replace("-", " ");
  const prov =
    c.provocation === "rotation" ? "sharp rotational load (cuts, tight turns)"
      : c.provocation === "speed" ? "fast running"
        : c.provocation === "impact" ? "repeated impact"
          : "high running volume";
  return `${cap(site)} ${c.status} aggravated by ${prov}: ${tissueCapSummary(c)}.`;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Resolve the EFFECTIVE caps across all active constraints — the tightest of
 * each lever (an athlete with two constraints gets both limits). Returns null
 * when there are no constraints, which is the linchpin of the byte-identical
 * invariant: null ⇒ every generator cap site takes its pre-existing path.
 */
export function activeTissueCaps(constraints?: TissueConstraint[] | null): TissueCaps | null {
  if (!constraints || constraints.length === 0) return null;
  const out: TissueCaps = {};
  for (const c of constraints) {
    const k = c.caps;
    if (k.weeklyKm != null) out.weeklyKm = Math.min(out.weeklyKm ?? Infinity, k.weeklyKm);
    if (k.longRunKm != null) out.longRunKm = Math.min(out.longRunKm ?? Infinity, k.longRunKm);
    if (k.rampCeiling != null) out.rampCeiling = Math.min(out.rampCeiling ?? Infinity, k.rampCeiling);
    if (k.maxSessionIntensity != null) {
      out.maxSessionIntensity =
        out.maxSessionIntensity == null || zoneRank(k.maxSessionIntensity) < zoneRank(out.maxSessionIntensity)
          ? k.maxSessionIntensity
          : out.maxSessionIntensity;
    }
  }
  // No lever actually bound (e.g. a niggle whose caps were all empty) ⇒ treat as
  // inactive, so the plan is byte-identical to a healthy one.
  return Object.keys(out).length ? out : null;
}

/** All active constraints' reasons (deduped), for the UI. Empty when none. */
export function tissueReasons(constraints?: TissueConstraint[] | null): string[] {
  if (!constraints || constraints.length === 0) return [];
  return [...new Set(constraints.map(tissueReason))];
}
