import type { Protocol } from "./strength-protocols";

/**
 * Seed protocol library — PLACEHOLDER CONTENT.
 *
 * Every exercise, set/rep scheme, tempo, and load below is a provisional
 * stand-in pending the athlete-provided versions of these protocols. This
 * file is data only — edit doses/exercises freely; nothing else in the app
 * hard-codes protocol content. Scheduling behavior (daily vs weekly, rehab
 * exemptions, race-week deload) is driven by the `rehab` flag and each
 * block's `freqPerWeek`, so edits here reshape the calendar automatically.
 *
 * Rep ranges are reps unless a block's tempo note says seconds.
 */
export const SEED_PROTOCOLS: Protocol[] = [
  {
    // PLACEHOLDER — daily calf/tendon rehab, aligned with the existing
    // bw-calf/gym-calf eccentric template content (slow lowering, soleus
    // bias). Activates only when calf/achilles is on file.
    id: "rehab-calf",
    name: "Calf & achilles rehab",
    rehab: true,
    minutes: 10,
    why: "Daily therapeutic dose — slow eccentric loading is the best-evidenced way to rebuild tendon capacity, and rehab dose is not training stress.",
    targets: ["calf-achilles"],
    blocks: [
      {
        exercise: "Bent-knee eccentric calf lower",
        sets: 3,
        repRange: [10, 15],
        tempo: "3-0-1 — 3s down, soleus bias",
        loadRule: { kind: "bodyweight" },
        freqPerWeek: 7,
      },
      {
        exercise: "Straight-knee heel drop off a step",
        sets: 3,
        repRange: [8, 12],
        tempo: "3-0-1 — slow lowering, rise on two feet",
        loadRule: { kind: "bodyweight" },
        freqPerWeek: 7,
      },
      {
        exercise: "Single-leg isometric calf hold",
        sets: 3,
        repRange: [30, 45],
        tempo: "seconds / side, mid-range hold",
        loadRule: { kind: "bodyweight" },
        freqPerWeek: 7,
      },
    ],
  },
  {
    // PLACEHOLDER — runner general strength, 2×/wk. Substitute bodyweight
    // variants (split squat, single-leg bridge) when no gym access.
    id: "runner-strength",
    name: "Runner general strength",
    minutes: 25,
    why: "Twice-weekly lower-body strength is the cheapest run-injury insurance there is, and it buys running economy at near-zero aerobic cost.",
    blocks: [
      {
        exercise: "Rear-foot-elevated split squat",
        sets: 3,
        repRange: [6, 10],
        tempo: "2-0-1 — controlled down",
        loadRule: { kind: "external", unit: "kg", increment: 2.5 },
        freqPerWeek: 2,
      },
      {
        exercise: "Hip thrust",
        sets: 3,
        repRange: [8, 12],
        loadRule: { kind: "external", unit: "kg", increment: 2.5 },
        freqPerWeek: 2,
      },
      {
        exercise: "Single-leg calf raise",
        sets: 3,
        repRange: [8, 12],
        tempo: "3-0-1 — full range, slow down",
        loadRule: { kind: "external", unit: "kg", increment: 2.5 },
        freqPerWeek: 2,
      },
      {
        exercise: "Side plank",
        sets: 3,
        repRange: [30, 45],
        tempo: "seconds / side",
        loadRule: { kind: "bodyweight" },
        freqPerWeek: 2,
      },
    ],
  },
  {
    // PLACEHOLDER — upper body, 1–2×/wk. Seeded at 1×/wk (bump freqPerWeek
    // to 2 on all blocks when the athlete confirms the higher frequency).
    id: "upper-body",
    name: "Upper body",
    minutes: 20,
    why: "Once or twice a week keeps posture, arm drive, and swim durability honest without stealing recovery from the run plan.",
    blocks: [
      {
        exercise: "Push-up",
        sets: 3,
        repRange: [8, 15],
        loadRule: { kind: "bodyweight" },
        freqPerWeek: 1,
      },
      {
        exercise: "One-arm dumbbell row",
        sets: 3,
        repRange: [8, 12],
        loadRule: { kind: "external", unit: "kg", increment: 2.5 },
        freqPerWeek: 1,
      },
      {
        exercise: "Band pull-apart",
        sets: 3,
        repRange: [12, 15],
        loadRule: { kind: "band", ladder: ["yellow", "red", "green", "blue"], index: 0 },
        freqPerWeek: 1,
      },
      {
        exercise: "Overhead press",
        sets: 3,
        repRange: [6, 10],
        loadRule: { kind: "external", unit: "kg", increment: 2.5 },
        freqPerWeek: 1,
      },
    ],
  },
];
