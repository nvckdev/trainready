"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { generatePlan, type PlanRequest, type RaceType } from "../../../engine/plan.ts";
import { getAthlete, getHistory, getLatestState } from "@/lib/athlete-data";
import { readPlan, setSessionStatus, writePlan } from "@/lib/plan-io";

function buildAndSave(request: PlanRequest): void {
  const athlete = getAthlete();
  const state = getLatestState();
  if (!athlete || !state) throw new Error("no corpus: import training history first");
  const history = getHistory().map((h) => ({ state: h.state, actualTss: h.actualTss }));
  const plan = generatePlan(request, state, history, athlete.zones);
  writePlan({ request, plan });
}

export async function generatePlanAction(formData: FormData): Promise<void> {
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
