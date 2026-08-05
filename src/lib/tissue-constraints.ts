import { readAthleteContextTagged, readAthleteContext } from "./athlete-context";
import { activeDeclarations, readDeclarations, toConstraint } from "./tissue-declarations";
import { readPainLog } from "./strength-io";
import { surfaceAlerts } from "./pain-rules";
import type { PainRegion } from "./strength-protocols";
import {
  declareTissue,
  type TissueConstraint,
  type TissueProvocation,
  type TissueSite,
  type TissueStatus,
} from "../../engine/tissue.ts";

/**
 * Tissue-constraint inference (feature 4, app layer). The engine stays pure —
 * it only consumes a TissueConstraint[] on the request. This gateway builds that
 * list from the athlete's own record: hand-declared injuries (durable) plus live
 * pain-tracker alerts (which escalate severity). Returns [] when nothing is on
 * file, so a healthy athlete's plan is byte-identical (no prophylactic caps —
 * Fokkema found no volume↔injury association).
 *
 * src/lib gateway (rule 12): pages/actions read constraints only through here.
 */

// Free-text (declared-injury area/symptoms) → the engine's structured site.
const SITE_KEYWORDS: Array<[RegExp, TissueSite]> = [
  [/calf|achilles|soleus|gastroc/i, "calf"],
  [/plantar|fascia|arch/i, "plantar-fascia"],
  [/shin|tibia|periost/i, "shin"],
  [/\bitb\b|it band|iliotibial/i, "itb"],
  [/hamstring/i, "hamstring"],
  [/knee|patell/i, "knee"],
  [/hip|glute|piriformis/i, "hip"],
  [/foot|metatars|toe/i, "foot"],
];

// Pain-tracker region → site (regions are coarser than declared sites).
const REGION_SITE: Partial<Record<PainRegion, TissueSite>> = {
  "calf-achilles": "calf",
  knee: "knee",
  itb: "itb",
  hip: "hip",
  // back/shoulder are not running load-bearing tissues → no running cap.
};

const TENDON_SITES = new Set<TissueSite>(["calf", "plantar-fascia", "itb"]);

function siteFrom(text: string): TissueSite | null {
  for (const [re, site] of SITE_KEYWORDS) if (re.test(text)) return site;
  return null;
}

/** What loading pattern the symptom text implicates (defaults to volume). */
function provocationFrom(text: string): TissueProvocation {
  if (/rotat|twist|pivot|\bcut\b|turn/i.test(text)) return "rotation";
  if (/speed|fast|sprint|track|tempo|pace/i.test(text)) return "speed";
  if (/impact|pound|downhill|landing|hard surface/i.test(text)) return "impact";
  return "volume";
}

function statusFrom(text: string, site: TissueSite): TissueStatus {
  if (/acute|flare|severe|sharp|can't run|cannot run/i.test(text)) return "acute";
  if (TENDON_SITES.has(site) || /tendin|tendon/i.test(text)) return "tendinopathy";
  return "niggle";
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Pure inference from one declared injury entry → a constraint (or null when
 *  the text names no running-load tissue). Exported for deterministic testing. */
export function declaredConstraint(inj: { area?: string; symptoms?: string; status?: string }): TissueConstraint | null {
  const text = `${inj.area ?? ""} ${inj.symptoms ?? ""} ${inj.status ?? ""}`;
  const site = siteFrom(text);
  if (!site) return null;
  const why = inj.symptoms ? `${cap(site.replace("-", " "))}: ${inj.symptoms}` : undefined;
  return declareTissue(site, statusFrom(text, site), provocationFrom(text), why);
}

/**
 * Build the active tissue constraints for the athlete as of `today`. Declared
 * injuries seed the map; a live pain alert on a matching region escalates that
 * site to `acute` (or adds an alert-only constraint). One constraint per site.
 */
export interface TissueConstraintsRead {
  constraints: TissueConstraint[];
  /** "unreadable" ⇒ a safety file exists but cannot be parsed — callers on
   *  the automatic path must refuse to reflow rather than proceed with the
   *  athlete's declared caps silently dropped. */
  status: "ok" | "absent" | "unreadable";
  message?: string;
  /**
   * Legacy free-text injuries that named no running-load tissue, so produced
   * no constraint.
   *
   * E9 made a file that cannot PARSE refuse the reflow. An injury whose text
   * the keywords do not recognise is the other half of the same hole: valid
   * JSON, a real declaration by the athlete, and no cap — reported by nobody.
   * It does not refuse (that would strand anyone whose file has an entry we
   * cannot map), but it is never silent again: the UI shows it and asks for a
   * structured declaration instead.
   */
  unmapped: string[];
}

/** The safety-aware loader: absent is a real "no injuries on file"; an
 *  unreadable file is a failure the caller must handle, never an empty list. */
export function loadTissueConstraintsTagged(today: string): TissueConstraintsRead {
  // The structured store is the durable source and is checked FIRST: a corrupt
  // one must refuse before anything else is read, for the same reason a
  // corrupt athlete-context does.
  const declared = readDeclarations();
  if (declared.status === "unreadable") {
    return { constraints: [], status: "unreadable", message: `tissue-declarations.json: ${declared.message}`, unmapped: [] };
  }
  const read = readAthleteContextTagged();
  if (read.status === "unreadable") {
    return { constraints: [], status: "unreadable", message: read.message, unmapped: [] };
  }
  return {
    constraints: loadTissueConstraints(today),
    status: declared.status === "ok" ? "ok" : read.status,
    unmapped: unmappedInjuries(),
  };
}

/** Free-text injuries on file that map to no running-load tissue. */
export function unmappedInjuries(): string[] {
  const ctx = readAthleteContext();
  return (ctx?.injuries ?? [])
    .filter((inj) => declaredConstraint(inj) === null)
    .map((inj) => [inj.area, inj.symptoms].filter(Boolean).join(" — ") || "an unnamed entry");
}

export function loadTissueConstraints(today: string): TissueConstraint[] {
  const ctx = readAthleteContext();
  const bySite = new Map<TissueSite, TissueConstraint>();

  // 1 — legacy hand-edited injuries, kept so an existing athlete-context keeps
  // working. Anything it cannot map is reported through unmappedInjuries()
  // rather than dropped.
  for (const inj of ctx?.injuries ?? []) {
    const c = declaredConstraint(inj);
    if (c) bySite.set(c.site, c);
  }

  // 2 — STRUCTURED declarations, the durable source. Typed at the boundary, so
  // there is nothing to infer and nothing to misread; they override a legacy
  // guess for the same site because the athlete chose these values explicitly.
  for (const d of activeDeclarations(readDeclarations().declarations, today)) {
    bySite.set(d.site, toConstraint(d));
  }

  // 3 — live pain alerts escalate/introduce a constraint for the region.
  for (const alert of surfaceAlerts(readPainLog(), today)) {
    const site = REGION_SITE[alert.region];
    if (!site) continue;
    const existing = bySite.get(site);
    // A rest-pain or consecutive-days alert reads as an acute flare.
    const acute = alert.rule === "at-rest" || alert.rule === "consecutive";
    const provocation = existing?.provocation ?? "volume";
    const status: TissueStatus = acute ? "acute" : existing?.status ?? "niggle";
    bySite.set(site, declareTissue(site, status, provocation, `${cap(site.replace("-", " "))}: ${alert.detail}`));
  }

  return [...bySite.values()];
}
