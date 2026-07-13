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

/**
 * Retitle + restructure one session, matched on (date, title) like
 * setSessionStatus. Guards rule 17: if the new title would collide with a
 * sibling session on the same date, a numeric suffix keeps titles unique
 * within the date. Duration, discipline, weekday, and status are untouched.
 */
export function retitleSession(
  date: string,
  title: string,
  next: { title: string; structure: string; why: string; tss: number }
): boolean {
  const stored = readPlan();
  if (!stored) return false;
  for (const w of stored.plan.weeks) {
    const target = w.sessions.find((s) => s.date === date && s.title === title);
    if (!target) continue;
    const siblings = w.sessions.filter((s) => s !== target && s.date === date);
    let newTitle = next.title;
    for (let n = 2; siblings.some((s) => s.title === newTitle); n++) {
      newTitle = `${next.title} (${n})`;
    }
    target.title = newTitle;
    target.structure = next.structure;
    target.why = next.why;
    target.tss = next.tss;
    writePlan(stored);
    return true;
  }
  return false;
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
