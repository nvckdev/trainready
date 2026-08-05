import {
  declareTissue,
  type TissueConstraint,
  type TissueProvocation,
  type TissueSite,
  type TissueStatus,
} from "./tissue.ts";

/**
 * The typed tissue-declaration boundary — ONE implementation, both surfaces.
 *
 * The validation and the active-set resolution lived in src/lib and were
 * therefore dashboard-only. Mobile now writes declarations too, and a second
 * copy of "which declaration is binding today" is exactly the duplication that
 * has caused every mobile-lags-dashboard incident in this repo — with injury
 * caps as the payload rather than a cosmetic label.
 *
 * Pure: the surfaces own persistence (data/app/tissue-declarations.json on the
 * dashboard, AsyncStorage on mobile) and both parse through parseDeclarations.
 *
 * The refusal discipline (E9, and the half of it E9 left open): a declaration
 * that fails validation makes the WHOLE read unreadable rather than being
 * skipped. Dropping one bad entry from a safety file is the failure being
 * designed out — free-text injuries used to yield no constraint, no parse
 * error and no complaint — so a partial read is never handed back as though it
 * were complete. This is the opposite of the pain log, where filtering is
 * right: a bad pain row costs one data point, a dropped declaration costs a
 * cap.
 */

/** Closed sets, mirroring the engine's own unions so a declaration cannot
 *  express a site or status generatePlan has never heard of. */
export const TISSUE_SITES: TissueSite[] = [
  "achilles", "calf", "plantar-fascia", "shin", "knee", "itb", "hip", "foot", "hamstring",
];
export const TISSUE_STATUSES: TissueStatus[] = ["niggle", "tendinopathy", "acute"];
export const TISSUE_PROVOCATIONS: TissueProvocation[] = ["impact", "volume", "speed", "rotation"];
/** Most limiting first — used to collapse two open declarations on one site. */
const SEVERITY: TissueStatus[] = ["acute", "tendinopathy", "niggle"];

/** Plain-language labels — the athlete is describing a body, not filling in a
 *  taxonomy, so both surfaces say what each choice means for their training. */
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

export interface TissueDeclaration {
  site: TissueSite;
  status: TissueStatus;
  provocation: TissueProvocation;
  /** YYYY-MM-DD, athlete-local. The declaration binds from this day. */
  declaredOn: string;
  /** YYYY-MM-DD when it healed, INCLUSIVE — or null while it is open. */
  resolvedOn: string | null;
  /** The athlete's own words, shown as the plan's "why" beside the cap. */
  note?: string;
}

export interface DeclarationsRead {
  declarations: TissueDeclaration[];
  status: "ok" | "absent" | "unreadable";
  message?: string;
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Validate a parsed store. Returns "unreadable" with a reason on the FIRST bad
 * entry and no declarations at all — see the module note on why a partial read
 * is worse than no read.
 */
export function parseDeclarations(raw: unknown): DeclarationsRead {
  if (raw == null) return { declarations: [], status: "absent" };
  if (typeof raw !== "object") return { declarations: [], status: "unreadable", message: "not an object" };
  const list = (raw as { declarations?: unknown }).declarations;
  if (!Array.isArray(list)) return { declarations: [], status: "unreadable", message: "declarations is not an array" };

  const out: TissueDeclaration[] = [];
  for (const [i, e] of list.entries()) {
    const bad = (why: string): DeclarationsRead => ({
      declarations: [],
      status: "unreadable",
      message: `declaration ${i + 1}: ${why}`,
    });
    if (typeof e !== "object" || e === null) return bad("not an object");
    const d = e as Record<string, unknown>;
    if (!TISSUE_SITES.includes(d.site as TissueSite)) return bad(`unknown site "${String(d.site)}"`);
    if (!TISSUE_STATUSES.includes(d.status as TissueStatus)) return bad(`unknown status "${String(d.status)}"`);
    if (!TISSUE_PROVOCATIONS.includes(d.provocation as TissueProvocation)) {
      return bad(`unknown provocation "${String(d.provocation)}"`);
    }
    if (!isDate(d.declaredOn)) return bad(`declaredOn "${String(d.declaredOn)}" is not YYYY-MM-DD`);
    if (d.resolvedOn != null && !isDate(d.resolvedOn)) {
      return bad(`resolvedOn "${String(d.resolvedOn)}" is not YYYY-MM-DD or null`);
    }
    if (d.note != null && typeof d.note !== "string") return bad("note is not a string");
    out.push({
      site: d.site as TissueSite,
      status: d.status as TissueStatus,
      provocation: d.provocation as TissueProvocation,
      declaredOn: d.declaredOn,
      resolvedOn: (d.resolvedOn as string | null) ?? null,
      ...(d.note != null ? { note: d.note as string } : {}),
    });
  }
  return { declarations: out, status: "ok" };
}

/**
 * The declarations binding on `today`: declared on or before it, not resolved
 * before it, one per site with the most limiting status winning.
 *
 * The resolution day is INCLUSIVE — an athlete marking a niggle resolved this
 * morning still trained under it this week, and a cap that vanished mid-week
 * would make the week's own plan unexplainable.
 */
export function activeDeclarations(declarations: TissueDeclaration[], today: string): TissueDeclaration[] {
  const bySite = new Map<TissueSite, TissueDeclaration>();
  for (const d of declarations) {
    if (d.declaredOn > today) continue;
    if (d.resolvedOn != null && d.resolvedOn < today) continue;
    const prev = bySite.get(d.site);
    if (!prev || SEVERITY.indexOf(d.status) < SEVERITY.indexOf(prev.status)) bySite.set(d.site, d);
  }
  return [...bySite.values()];
}

/** A declaration in the engine's own terms. The caps come from the engine's
 *  deriveTissueCaps, so neither surface ever invents a cap of its own. */
export function toConstraint(d: TissueDeclaration): TissueConstraint {
  return declareTissue(d.site, d.status, d.provocation, d.note?.trim() || undefined);
}

/** Append a declaration to a list. Append-only: a resolved injury stays on the
 *  record, because "when did this start and when did it settle" is the question
 *  the athlete will actually ask next season. */
export function withDeclaration(
  declarations: TissueDeclaration[],
  d: TissueDeclaration
): TissueDeclaration[] {
  return [...declarations, d];
}

/** Mark every open declaration for a site resolved as of `date`. */
export function withResolved(
  declarations: TissueDeclaration[],
  site: TissueSite,
  date: string
): TissueDeclaration[] {
  return declarations.map((d) =>
    d.site === site && d.resolvedOn == null ? { ...d, resolvedOn: date } : d
  );
}
