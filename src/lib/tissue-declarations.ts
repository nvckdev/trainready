import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  declareTissue,
  type TissueConstraint,
  type TissueProvocation,
  type TissueSite,
  type TissueStatus,
} from "../../engine/tissue.ts";

/**
 * Structured tissue declarations — the durable source of injury caps,
 * replacing hand-edited athlete-context.json entries.
 *
 * E9 closed half the hole it found: a safety file that does not PARSE now
 * refuses the reflow instead of reading as "no injuries on file". The other
 * half stayed open. A declared injury is free text — `area`, `symptoms`,
 * `status` — and tissue-constraints.ts infers site, clinical status and
 * provocation from it by keyword. Text the keywords do not recognise returns
 * null: no parse error, no warning, no cap. The athlete has declared an
 * injury, the file is perfectly valid JSON, and the plan does not know.
 *
 * A declaration is therefore typed at the boundary. Every field is a closed
 * set the engine already defines, so there is nothing to infer and nothing to
 * misread — and an entry that fails validation makes the whole read
 * UNREADABLE rather than being skipped. That asymmetry is the point: silently
 * dropping one bad entry from a safety file is precisely the failure being
 * designed out, so a partial read is never handed back as though it were
 * complete. Callers on the automatic path already know how to refuse an
 * unreadable safety file (replan-auto.ts).
 *
 * Health data: data/app/, gitignored, never leaves the machine.
 *
 * src/lib gateway (rule 12) — pages and actions read declarations only here.
 */

const PATH = "data/app/tissue-declarations.json";

/** Closed sets, mirroring the engine's own unions so a declaration cannot
 *  express a site or status generatePlan has never heard of. */
const SITES: TissueSite[] = [
  "achilles", "calf", "plantar-fascia", "shin", "knee", "itb", "hip", "foot", "hamstring",
];
const STATUSES: TissueStatus[] = ["niggle", "tendinopathy", "acute"];
const PROVOCATIONS: TissueProvocation[] = ["impact", "volume", "speed", "rotation"];
/** Most limiting first — used to collapse two open declarations on one site. */
const SEVERITY: TissueStatus[] = ["acute", "tendinopathy", "niggle"];

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
 * Validate a parsed file. Returns "unreadable" with a reason on the FIRST bad
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
    if (!SITES.includes(d.site as TissueSite)) return bad(`unknown site "${String(d.site)}"`);
    if (!STATUSES.includes(d.status as TissueStatus)) return bad(`unknown status "${String(d.status)}"`);
    if (!PROVOCATIONS.includes(d.provocation as TissueProvocation)) {
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

/** Read the store. An absent file is a real state; a corrupt one is a failure
 *  the caller must handle, exactly as E9 set for athlete-context.json. */
export function readDeclarations(): DeclarationsRead {
  try {
    if (!existsSync(PATH)) return { declarations: [], status: "absent" };
    return parseDeclarations(JSON.parse(readFileSync(PATH, "utf8")));
  } catch (e) {
    return { declarations: [], status: "unreadable", message: e instanceof Error ? e.message : String(e) };
  }
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
 *  deriveTissueCaps, so the app never invents a cap of its own. */
export function toConstraint(d: TissueDeclaration): TissueConstraint {
  return declareTissue(d.site, d.status, d.provocation, d.note?.trim() || undefined);
}

/** Append a declaration. Writing is append-only: a resolved injury stays on
 *  the record, because "when did this start and when did it settle" is the
 *  question the athlete will actually ask next season. */
export function appendDeclaration(d: TissueDeclaration): void {
  const read = readDeclarations();
  // Never overwrite a file we could not understand — that would destroy the
  // very entries the refusal is protecting.
  if (read.status === "unreadable") return;
  const next = [...read.declarations, d];
  mkdirSync(dirname(PATH), { recursive: true });
  writeFileSync(PATH, JSON.stringify({ declarations: next }, null, 2));
}

/** Mark every open declaration for a site resolved as of `date`. */
export function resolveDeclaration(site: TissueSite, date: string): void {
  const read = readDeclarations();
  if (read.status !== "ok") return;
  const next = read.declarations.map((d) =>
    d.site === site && d.resolvedOn == null ? { ...d, resolvedOn: date } : d
  );
  mkdirSync(dirname(PATH), { recursive: true });
  writeFileSync(PATH, JSON.stringify({ declarations: next }, null, 2));
}
