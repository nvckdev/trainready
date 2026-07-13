"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { generatePlan, type Plan, type PlanRequest, type RaceType } from "../../../engine/plan.ts";
import { getAthlete, getHistory, getLatestState, localToday } from "@/lib/athlete-data";
import { readPlan, setSessionStatus, writePlan } from "@/lib/plan-io";

function buildAndSave(request: PlanRequest): void {
  const athlete = getAthlete();
  const state = getLatestState();
  if (!athlete || !state) throw new Error("no corpus: import training history first");
  const history = getHistory().map((h) => ({ state: h.state, actualTss: h.actualTss }));
  const plan = generatePlan(request, state, history, athlete.zones);
  carryStatusForward(plan);
  writePlan({ request, plan });
}

/**
 * Re-planning must not erase the athlete's log: copy done/skipped marks from
 * the existing plan (if any) onto matching sessions in the new one. Match on
 * (date, discipline) — titles change when durations shift, so never on title.
 * Only past-or-today sessions carry status forward.
 */
function carryStatusForward(plan: Plan): void {
  const prev = readPlan();
  if (!prev) return;
  const today = localToday();
  const marked = new Map<string, "done" | "skipped">();
  for (const w of prev.plan.weeks)
    for (const s of w.sessions)
      if (s.status && s.date <= today) marked.set(`${s.date}␟${s.discipline}`, s.status);
  if (!marked.size) return;
  for (const w of plan.weeks)
    for (const s of w.sessions) {
      const status = marked.get(`${s.date}␟${s.discipline}`);
      if (status) s.status = status;
    }
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
    // Engine layering keeps engine/plan.ts free of src/ imports, so its
    // default "today" is UTC — always pass the athlete-local date explicitly.
    startDate: localToday(),
  };
  buildAndSave(request);
  revalidatePath("/app", "layout");
  redirect("/app/plan");
}

/** Adaptive re-flow: regenerate every remaining week from today's state. */
export async function replanAction(): Promise<void> {
  const stored = readPlan();
  if (!stored) redirect("/app/start");
  buildAndSave({ ...stored!.request, startDate: localToday() });
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
