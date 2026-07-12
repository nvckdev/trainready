import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Plan, PlanRequest } from "../../engine/plan.ts";

/** The athlete's active plan lives beside the corpus (gitignored). */

const PLAN_PATH = join(process.cwd(), "data", "app", "plan.json");

export interface StoredPlan {
  request: PlanRequest;
  plan: Plan;
}

export function readPlan(): StoredPlan | null {
  try {
    if (!existsSync(PLAN_PATH)) return null;
    return JSON.parse(readFileSync(PLAN_PATH, "utf8")) as StoredPlan;
  } catch {
    return null;
  }
}

export function writePlan(stored: StoredPlan): void {
  mkdirSync(dirname(PLAN_PATH), { recursive: true });
  writeFileSync(PLAN_PATH, JSON.stringify(stored, null, 1));
}

export function setSessionStatus(
  date: string,
  title: string,
  status: "done" | "skipped" | null
): void {
  const stored = readPlan();
  if (!stored) return;
  for (const w of stored.plan.weeks) {
    for (const s of w.sessions) {
      if (s.date === date && s.title === title) {
        if (status === null) delete s.status;
        else s.status = status;
      }
    }
  }
  writePlan(stored);
}
