import type { InjuryArea, StrengthAccess, AthleteContext } from "./athlete-context";
import { AREA_PRIORITY, INJURY_LABEL, activeInjuryAreas } from "./athlete-context";

/**
 * Supplemental strength & injury-prevention protocols. These are templated
 * 10–20 minute sessions layered OUTSIDE the engine plan — no TSS, no PMC
 * effect, never touched by prescription logic. Selection is driven by the
 * injury areas recorded in data/app/athlete-context.json: two blocks per
 * week, injury-matched first, general durability as filler.
 */

export interface StrengthExercise {
  name: string;
  dose: string; // sets × reps / time
  cue?: string;
}

export interface StrengthBlock {
  id: string;
  title: string;
  minutes: number;
  /** Injury areas this block protects. */
  targets: InjuryArea[];
  /** May be used as filler when no recorded injury matches. */
  general: boolean;
  /** One-line why, keyed by matched injury area; `default` when unmatched. */
  why: Partial<Record<InjuryArea, string>> & { default: string };
  exercises: StrengthExercise[];
}

const BODYWEIGHT_BLOCKS: StrengthBlock[] = [
  {
    id: "bw-calf",
    title: "Calf & achilles capacity",
    minutes: 12,
    targets: ["calf-achilles"],
    general: false,
    why: {
      "calf-achilles":
        "Calf/achilles on file — slow eccentric loading is the best-evidenced way to rebuild tendon capacity.",
      default: "Eccentric calf loading builds tendon capacity ahead of run volume.",
    },
    exercises: [
      { name: "Bent-knee eccentric calf lower", dose: "3×12 / leg", cue: "3s down — soleus bias" },
      { name: "Straight-knee heel drop off a step", dose: "3×10 / leg", cue: "slow lowering, rise on two feet" },
      { name: "Single-leg balance, eyes closed", dose: "3×30s / leg" },
    ],
  },
  {
    id: "bw-hip",
    title: "Hip stability",
    minutes: 14,
    targets: ["hip", "itb", "knee"],
    general: true,
    why: {
      hip: "Hip on file — glute med endurance keeps the pelvis level when fatigue arrives late in runs.",
      itb: "ITB on file — ITB pain is usually a hip-control problem; abductor strength treats the cause.",
      knee: "Knee on file — knees mostly fail upstream; hip control cuts valgus load on the joint.",
      default: "Glute med endurance is the cheapest run-injury insurance there is.",
    },
    exercises: [
      { name: "Side-lying hip abduction", dose: "3×15 / side", cue: "slow, heel leads" },
      { name: "Single-leg glute bridge", dose: "3×10 / leg" },
      { name: "Standing hip hike", dose: "3×12 / side" },
      { name: "Side plank + top-leg lift", dose: "3×20s / side" },
    ],
  },
  {
    id: "bw-core",
    title: "Core & spring",
    minutes: 15,
    targets: ["back"],
    general: true,
    why: {
      back: "Back on file — anti-extension core work stabilizes the spine without loading it.",
      default: "Trunk stiffness plus light plyometrics buys running economy at near-zero fatigue cost.",
    },
    exercises: [
      { name: "Front plank", dose: "3×40s" },
      { name: "Bird dog", dose: "3×8 / side", cue: "slow, no pelvis roll" },
      { name: "Dead bug", dose: "3×10 / side" },
      { name: "Low pogo hops", dose: "3×20", cue: "quiet landings — plyo intro" },
    ],
  },
  {
    id: "bw-shoulder",
    title: "Shoulder durability",
    minutes: 10,
    targets: ["shoulder"],
    general: false,
    why: {
      shoulder: "Shoulder on file — scapular control protects the rotator cuff under swim volume.",
      default: "Scapular control keeps the shoulder honest under swim volume.",
    },
    exercises: [
      { name: "Scapular push-up", dose: "3×10" },
      { name: "Prone Y-T-W raise", dose: "3×8 each" },
      { name: "Side plank with rotation", dose: "3×8 / side" },
    ],
  },
];

const GYM_BLOCKS: StrengthBlock[] = [
  {
    id: "gym-calf",
    title: "Calf & achilles loading",
    minutes: 15,
    targets: ["calf-achilles"],
    general: false,
    why: {
      "calf-achilles":
        "Calf/achilles on file — heavy slow eccentrics are the best-evidenced way to rebuild tendon capacity.",
      default: "Heavy calf work builds tendon capacity ahead of run volume.",
    },
    exercises: [
      { name: "Seated calf raise, heavy", dose: "4×8", cue: "3s eccentric — soleus bias" },
      { name: "Single-leg calf raise on step, dumbbell in hand", dose: "3×10 / leg", cue: "full range, slow down" },
      { name: "Single-leg balance on pad", dose: "3×30s / leg" },
    ],
  },
  {
    id: "gym-hip",
    title: "Hip & glute strength",
    minutes: 18,
    targets: ["hip", "itb", "knee"],
    general: true,
    why: {
      hip: "Hip on file — abductor strength keeps the pelvis level when fatigue arrives late in runs.",
      itb: "ITB on file — ITB pain is usually a hip-control problem; loaded abduction treats the cause.",
      knee: "Knee on file — knees mostly fail upstream; hip strength cuts valgus load on the joint.",
      default: "Loaded hip work is the highest-yield injury insurance for run volume.",
    },
    exercises: [
      { name: "Banded lateral walk", dose: "3×12 steps / side" },
      { name: "Barbell hip thrust", dose: "4×8" },
      { name: "Rear-foot-elevated split squat", dose: "3×8 / leg" },
      { name: "Side plank", dose: "3×30s / side" },
    ],
  },
  {
    id: "gym-core",
    title: "Core & plyo progression",
    minutes: 15,
    targets: ["back"],
    general: true,
    why: {
      back: "Back on file — anti-rotation and hinge-pattern work stabilizes the spine under load.",
      default: "Trunk stiffness plus low-dose jumps buys running economy at near-zero fatigue cost.",
    },
    exercises: [
      { name: "Pallof press", dose: "3×10 / side" },
      { name: "Back extension", dose: "3×10", cue: "slow, no lumbar snap" },
      { name: "Box jump, step down", dose: "4×5", cue: "stick the landing" },
      { name: "Farmer carry", dose: "3×40m" },
    ],
  },
  {
    id: "gym-shoulder",
    title: "Shoulder durability",
    minutes: 12,
    targets: ["shoulder"],
    general: false,
    why: {
      shoulder: "Shoulder on file — cuff and scapular work protects the joint under swim volume.",
      default: "Cuff and scapular work keeps the shoulder honest under swim volume.",
    },
    exercises: [
      { name: "Cable external rotation", dose: "3×12 / side" },
      { name: "Face pull", dose: "3×12" },
      { name: "Incline Y-raise", dose: "3×10" },
    ],
  },
];

export interface SelectedBlock {
  block: StrengthBlock;
  /** One-line why, tied to the recorded injury when one matched. */
  why: string;
  /** Label of the matched injury area, if any. */
  matched: string | null;
}

/**
 * Pick this week's two supplemental blocks: injury-matched blocks first (in
 * area priority order), general durability blocks as filler. Deterministic —
 * same context in, same week out. Empty when access is "none".
 */
export function selectWeeklyBlocks(access: StrengthAccess, areas: InjuryArea[]): SelectedBlock[] {
  if (access === "none") return [];
  const pool = access === "full-gym" ? GYM_BLOCKS : BODYWEIGHT_BLOCKS;
  const picked: SelectedBlock[] = [];
  const taken = new Set<string>();

  for (const area of AREA_PRIORITY) {
    if (picked.length === 2) break;
    if (!areas.includes(area)) continue;
    const block = pool.find((b) => !taken.has(b.id) && b.targets.includes(area));
    if (!block) continue;
    taken.add(block.id);
    picked.push({ block, why: block.why[area] ?? block.why.default, matched: INJURY_LABEL[area] });
  }
  for (const block of pool) {
    if (picked.length === 2) break;
    if (block.general && !taken.has(block.id)) {
      taken.add(block.id);
      picked.push({ block, why: block.why.default, matched: null });
    }
  }
  return picked;
}

/** Convenience: this week's blocks straight from the stored context. */
export function supplementalForContext(ctx: AthleteContext | null): SelectedBlock[] {
  const access = ctx?.intake?.strengthAccess;
  if (!ctx || !access || access === "none") return [];
  return selectWeeklyBlocks(access, activeInjuryAreas(ctx));
}
