"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { generatePlan, type PlanRequest, type RaceType } from "../../../engine/plan.ts";
import { getAthlete, getHistory, getLatestState } from "@/lib/athlete-data";
import { readPlan, setSessionStatus, writePlan } from "@/lib/plan-io";
import {
  parseDisciplineMode,
  parseExperienceLevel,
  parseInjuryAreas,
  parseStrengthAccess,
  writeIntake,
  type IntakeData,
} from "@/lib/athlete-context";

function buildAndSave(request: PlanRequest): void {
  const athlete = getAthlete();
  const state = getLatestState();
  if (!athlete || !state) throw new Error("no corpus: import training history first");
  const history = getHistory().map((h) => ({ state: h.state, actualTss: h.actualTss }));
  const plan = generatePlan(request, state, history, athlete.zones);
  writePlan({ request, plan });
}

export async function generatePlanAction(formData: FormData): Promise<void> {
  // Persist intake answers first — they extend data/app/athlete-context.json
  // (merge, never clobber) and are useful even if generation fails.
  const notes = String(formData.get("injuryNotes") || "").trim();
  const hours = Number(formData.get("weeklyHours"));
  const intake: IntakeData = {
    disciplineMode: parseDisciplineMode(formData.get("disciplineMode")),
    weeklyHours: Number.isFinite(hours) ? Math.min(30, Math.max(1, hours)) : 8,
    strengthAccess: parseStrengthAccess(formData.get("strengthAccess")),
    injuries: parseInjuryAreas(formData.getAll("injuries")),
    ...(notes ? { injuryNotes: notes } : {}),
    experienceLevel: parseExperienceLevel(formData.get("experienceLevel")),
    updatedAt: new Date().toISOString(),
  };
  writeIntake(intake);

  const request: PlanRequest = {
    raceName: String(formData.get("raceName") || "A race"),
    raceDate: String(formData.get("raceDate")),
    raceType: String(formData.get("raceType")) as RaceType,
    daysPerWeek: Number(formData.get("daysPerWeek") || 6),
    longDay: (String(formData.get("longDay")) === "sunday" ? "sunday" : "saturday") as
      | "saturday"
      | "sunday",
  };
  buildAndSave(request);
  revalidatePath("/app", "layout");
  redirect("/app/plan");
}

/** Adaptive re-flow: regenerate every remaining week from today's state. */
export async function replanAction(): Promise<void> {
  const stored = readPlan();
  if (!stored) redirect("/app/start");
  buildAndSave({ ...stored!.request, startDate: undefined });
  revalidatePath("/app", "layout");
  redirect("/app/plan");
}

export async function toggleSessionAction(formData: FormData): Promise<void> {
  const date = String(formData.get("date"));
  const title = String(formData.get("title"));
  const current = String(formData.get("current") || "");
  setSessionStatus(date, title, current === "done" ? null : "done");
  revalidatePath("/app", "layout");
}
