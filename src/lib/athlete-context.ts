import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Athlete context (data/app/athlete-context.json, gitignored like the rest
 * of data/). The file predates the intake form and may carry hand-written
 * keys — trainingEras, keyPerformances, injuries, preferences, notes.
 * Rule: we EXTEND that file, never clobber it. Intake answers live under
 * their own `intake` key; everything else is preserved byte-for-byte on
 * write. Every reader returns null when the file (or data/) is absent.
 */

const CONTEXT_PATH = join(process.cwd(), "data", "app", "athlete-context.json");

export const DISCIPLINE_MODES = ["running-only", "triathlon", "bike-focus", "swim-focus"] as const;
export type DisciplineMode = (typeof DISCIPLINE_MODES)[number];

export const STRENGTH_ACCESS = ["none", "bodyweight", "full-gym"] as const;
export type StrengthAccess = (typeof STRENGTH_ACCESS)[number];

export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

// The intake's injury areas and the pain log's regions are the same
// vocabulary and always were (PAIN_REGIONS = INJURY_AREAS). It now has one
// definition, in engine/pain.ts, so both surfaces' pickers and both surfaces'
// rules cannot drift apart. These aliases keep the intake's own naming.
export {
  PAIN_REGIONS as INJURY_AREAS,
  PAIN_REGION_LABEL as INJURY_LABEL,
  type PainRegion as InjuryArea,
} from "../../engine/pain.ts";
import { PAIN_REGIONS as INJURY_AREAS, type PainRegion as InjuryArea } from "../../engine/pain.ts";

export interface IntakeData {
  disciplineMode: DisciplineMode;
  weeklyHours: number;
  strengthAccess: StrengthAccess;
  injuries: InjuryArea[];
  injuryNotes?: string;
  experienceLevel: ExperienceLevel;
  /** Display-only TSS per completed strength session (5–60, default 20).
   *  Never enters the engine, plan.json, or the PMC derivation. */
  strengthTss?: number;
  updatedAt: string; // ISO timestamp, machine-facing
}

/** Free-form injury entries as they exist in the hand-written file. */
export interface RecordedInjury {
  area?: string;
  symptoms?: string;
  status?: string;
  [key: string]: unknown;
}

export interface AthleteContext {
  intake?: IntakeData;
  injuries?: RecordedInjury[];
  preferences?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Absent vs unreadable — the connector layer's distinction, applied to the
 * safety file (E9). An ABSENT context is a legitimate state: no injuries on
 * file. An UNREADABLE one (the file exists but does not parse) is a failure,
 * and reading it as "no injuries" silently drops declared tissue caps from
 * the next automatic reflow — the one place absence-vs-failure has safety
 * stakes, not just accuracy stakes.
 */
export type AthleteContextRead =
  | { status: "ok"; context: AthleteContext }
  | { status: "absent" }
  | { status: "unreadable"; message: string };

/** Pure parse — exported so the unreadable branch is testable. */
export function parseAthleteContext(raw: string): AthleteContextRead {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return { status: "ok", context: parsed as AthleteContext };
    return { status: "unreadable", message: "athlete-context.json is not an object" };
  } catch (e) {
    return { status: "unreadable", message: e instanceof Error ? e.message : String(e) };
  }
}

export function readAthleteContextTagged(): AthleteContextRead {
  if (!existsSync(CONTEXT_PATH)) return { status: "absent" };
  let raw: string;
  try {
    raw = readFileSync(CONTEXT_PATH, "utf8");
  } catch (e) {
    return { status: "unreadable", message: e instanceof Error ? e.message : String(e) };
  }
  return parseAthleteContext(raw);
}

/** Legacy view: collapses both non-ok states to null. Kept for readers where
 *  the distinction has no safety consequence (display fallbacks). Safety
 *  paths use readAthleteContextTagged. */
export function readAthleteContext(): AthleteContext | null {
  const r = readAthleteContextTagged();
  return r.status === "ok" ? r.context : null;
}

/** Merge intake answers into the context file, preserving every other key. */
export function writeIntake(intake: IntakeData): void {
  const existing = readAthleteContext() ?? {};
  const merged: AthleteContext = { ...existing, intake };
  mkdirSync(dirname(CONTEXT_PATH), { recursive: true });
  writeFileSync(CONTEXT_PATH, JSON.stringify(merged, null, 1));
}

// ——— injury-area extraction ————————————————————————————————————
// Priority order for protocol selection: lower-limb tendon issues first
// (highest run-volume consequence), shoulder last (swim-specific).
export const AREA_PRIORITY: InjuryArea[] = ["calf-achilles", "knee", "itb", "hip", "back", "shoulder"];

const AREA_KEYWORDS: Record<InjuryArea, RegExp> = {
  "calf-achilles": /calf|achilles|soleus|gastroc/i,
  itb: /\bitb\b|it band|iliotibial/i,
  knee: /knee|patell/i,
  hip: /hip|glute|piriformis/i,
  shoulder: /shoulder|rotator|labrum/i,
  back: /back|lumbar|spine|sacro|\bsi joint\b/i,
};

/**
 * Union of the structured intake checkboxes and areas inferred from the
 * hand-written injuries[] entries (keyword match on area + symptoms), in
 * fixed priority order. Past injuries count: prevention work targets
 * history, not just active pain.
 */
export function activeInjuryAreas(ctx: AthleteContext | null): InjuryArea[] {
  if (!ctx) return [];
  const found = new Set<InjuryArea>(ctx.intake?.injuries ?? []);
  for (const inj of ctx.injuries ?? []) {
    const text = `${inj.area ?? ""} ${inj.symptoms ?? ""}`;
    for (const area of INJURY_AREAS) {
      if (AREA_KEYWORDS[area].test(text)) found.add(area);
    }
  }
  return AREA_PRIORITY.filter((a) => found.has(a));
}

// ——— parsing helpers (server action input is untrusted) ————————————
export function parseDisciplineMode(v: unknown): DisciplineMode {
  return DISCIPLINE_MODES.includes(v as DisciplineMode) ? (v as DisciplineMode) : "running-only";
}

export function parseStrengthAccess(v: unknown): StrengthAccess {
  return STRENGTH_ACCESS.includes(v as StrengthAccess) ? (v as StrengthAccess) : "none";
}

export function parseExperienceLevel(v: unknown): ExperienceLevel {
  return EXPERIENCE_LEVELS.includes(v as ExperienceLevel) ? (v as ExperienceLevel) : "intermediate";
}

export function parseInjuryAreas(vs: unknown[]): InjuryArea[] {
  const set = new Set(vs.filter((v): v is InjuryArea => INJURY_AREAS.includes(v as InjuryArea)));
  return AREA_PRIORITY.filter((a) => set.has(a));
}
