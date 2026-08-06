import type { PlanRequest, RaceType } from "../../engine/plan.ts";
import type { TissueConstraint } from "../../engine/tissue.ts";

/**
 * Build the Goal screen's PlanRequest — pure, so the gauntlet can pin the
 * wiring.
 *
 * Until 2026-08-06 this literal lived inline in goal.tsx and threaded
 * priorWeights but NOT tissueConstraints: a phone-declared injury bound
 * nothing in any plan the Goal tab built, and the caps the declaration screen
 * had just previewed appeared only if a weekly reconcile later happened to
 * fire. The engine was never wrong — the request was. That is exactly the
 * failure class engine tests cannot see, so the construction now lives here
 * where a test can call it, and goal.tsx is a thin caller.
 *
 * The unreadable-store refusal (E9) is enforced HERE, not at the call site,
 * so no future caller of this builder can forget it: a corrupt safety store
 * throws rather than silently producing an uncapped plan, matching the
 * dashboard (src/app/app/actions.ts).
 */

export interface GoalFormInput {
  raceName: string;
  raceDate: string;
  raceType: RaceType;
  daysPerWeek: number;
  longDay: "saturday" | "sunday";
  today: string;
  goalTime: string;
  priorWeights: PlanRequest["priorWeights"];
  tuneup?: { date: string; raceType: RaceType; name?: string };
}

export interface TissueForRequest {
  constraints: TissueConstraint[];
  status: "ok" | "absent" | "unreadable";
  message?: string;
}

export function buildGoalRequest(form: GoalFormInput, tissue: TissueForRequest): PlanRequest {
  if (tissue.status === "unreadable") {
    throw new Error(
      `Your injury declarations could not be read (${tissue.message ?? "parse error"}) — re-declare them before generating a plan.`
    );
  }
  return {
    raceName: form.raceName.trim() || "A race",
    raceDate: form.raceDate,
    raceType: form.raceType,
    daysPerWeek: form.daysPerWeek,
    longDay: form.longDay,
    startDate: form.today,
    goalTime: form.goalTime.trim() || undefined,
    priorWeights: form.priorWeights,
    tissueConstraints: tissue.constraints,
    ...(form.tuneup
      ? { tuneups: [{ date: form.tuneup.date, raceType: form.tuneup.raceType, name: form.tuneup.name }] }
      : {}),
  };
}
