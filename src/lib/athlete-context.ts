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

export const INJURY_AREAS = ["calf-achilles", "knee", "hip", "itb", "shoulder", "back"] as const;
export type InjuryArea = (typeof INJURY_AREAS)[number];

export const INJURY_LABEL: Record<InjuryArea, string> = {
  "calf-achilles": "Calf / achilles",
  knee: "Knee",
  hip: "Hip",
  itb: "ITB",
  shoulder: "Shoulder",
  back: "Back",
};

export interface IntakeData {
  disciplineMode: DisciplineMode;
  weeklyHours: number;
  strengthAccess: StrengthAccess;
  injuries: InjuryArea[];
  injuryNotes?: string;
  experienceLevel: ExperienceLevel;
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

export function readAthleteContext(): AthleteContext | null {
  try {
    if (!existsSync(CONTEXT_PATH)) return null;
    const parsed = JSON.parse(readFileSync(CONTEXT_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as AthleteContext) : null;
  } catch {
    return null;
  }
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
