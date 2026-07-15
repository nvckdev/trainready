"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { generatePlan, type Plan, type PlanRequest, type RaceType } from "../../../engine/plan.ts";
import { getAthlete, getHistory, getStateAt, getWeekly, localToday } from "@/lib/athlete-data";
import { recomputeRemaining } from "../../../engine/replan.ts";
import { readPlan, retitleSession, setSessionStatus, writePlan } from "@/lib/plan-io";
import {
  parseDisciplineMode,
  parseExperienceLevel,
  parseInjuryAreas,
  parseStrengthAccess,
  writeIntake,
  type IntakeData,
} from "@/lib/athlete-context";
import { logPain, readPainLog, setStrengthDone } from "@/lib/strength-io";
import { SEED_PROTOCOLS } from "@/lib/strength-seed";
import {
  clampStrengthTss,
  parsePainContext,
  parsePainRegion,
  parsePainScore,
} from "@/lib/strength-protocols";
import { deloadSets } from "@/lib/strength-schedule";
import { isPainHeld, surfaceAlerts } from "@/lib/pain-rules";
import { easedVersion } from "@/lib/week-insights";

function buildAndSave(request: PlanRequest): void {
  const athlete = getAthlete();
  // Seed CTL/ATL/TSB from the daily PMC series rolled forward to startDate —
  // the same state the Today header shows — never from the last weekly
  // example alone, whose PMC numbers freeze at that week's Monday.
  const state = getStateAt(request.startDate ?? localToday());
  if (!athlete || !state) throw new Error("no corpus: import training history first");
  const history = getHistory().map((h) => ({
    state: h.state,
    actualTss: h.actualTss,
    weekStart: h.weekStart,
  }));
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
    // Display-only strength TSS (docs/strength-module.md §6) — clamped 5–60.
    strengthTss: clampStrengthTss(formData.get("strengthTss")),
    updatedAt: new Date().toISOString(),
  };
  writeIntake(intake);

  // Start-page toggle "Use demonstrated-capacity anchoring (recommended)",
  // default checked → anchor-v2 (the default path). An UNCHECKED checkbox is
  // absent from FormData, so it threads anchorLegacy=true, routing generation
  // back to the legacy trailing-mean ceiling (engine/learned.ts escape hatch).
  const demonstratedCapacityAnchoring = formData.get("demonstratedCapacityAnchoring") !== null;

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
    anchorLegacy: !demonstratedCapacityAnchoring,
    // Optional race-goal time. Free-text, parsed engine-side (engine/goal.ts):
    // an empty/invalid value simply leaves the goal target inert. Round-trips
    // through plan-io with the rest of the request, so Re-plan keeps the goal.
    goalTime: String(formData.get("goalTime") || "") || undefined,
  };
  buildAndSave(request);
  revalidatePath("/app", "layout");
  redirect("/app/plan");
}

/** Adaptive re-flow: regenerate every remaining week from today's state. */
export async function replanAction(): Promise<void> {
  const stored = readPlan();
  if (!stored) redirect("/app/start");
  recomputeAndSave(stored!);
  revalidatePath("/app", "layout");
  redirect("/app/plan");
}

/**
 * Adaptive recompute from actual fitness (engine/replan.ts). Gathers the real
 * post-week PMC state, executed weekly TSS, and a per-week ledger, reflows the
 * remaining plan, and stamps the honest plan-adjusted note. All corpus I/O is
 * here (rule 12); recomputeRemaining stays pure. Falls back to a naive regen if
 * the corpus/zones are unavailable.
 */
function recomputeAndSave(stored: { request: PlanRequest; plan: Plan }): void {
  const today = localToday();
  const athlete = getAthlete();
  const actualState = getStateAt(today);
  if (!athlete || !actualState) {
    buildAndSave({ ...stored.request, startDate: today });
    return;
  }
  const history = getHistory().map((h) => ({ state: h.state, actualTss: h.actualTss, weekStart: h.weekStart }));
  const weekly = getWeekly();
  const weeklyTss = new Map(weekly.map((r) => [r.weekStart, r.tss]));

  // Completed plan weeks = those whose week starts strictly before the plan
  // week containing today. Build the ledger from executed weekly TSS + status.
  const curIdx = currentWeekIndex(stored.plan.weeks, today);
  const completed = stored.plan.weeks.slice(0, curIdx);
  const ledger = completed.map((wk, i) => {
    const actualTss = weeklyTss.get(wk.weekStart) ?? wk.sessions.filter((s) => s.status === "done").reduce((a, s) => a + s.tss, 0);
    const missed = wk.sessions.filter((s) => s.discipline !== "race" && s.status !== "done").length;
    const prev = completed[i - 1];
    const rampRef = prev ? (weeklyTss.get(prev.weekStart) ?? prev.targetTss) : wk.targetTss;
    return {
      weekStart: wk.weekStart,
      actualTss: Math.round(actualTss),
      plannedTss: wk.targetTss,
      rampCapTss: Math.round(rampRef * 1.2),
      sessionsMissed: missed,
      sessionsPlanned: wk.sessions.length,
    };
  });
  const actualTrailingTss = weekly.slice(-8).map((r) => Math.round(r.tss));

  const result = recomputeRemaining({ stored, actualState, actualTrailingTss, ledger, asOf: today, history, zones: athlete.zones });

  const plan = result.plan;
  plan.meta.lastRecomputed = result.lastRecomputed;
  if (result.note) plan.meta.replanNote = result.note;
  else delete plan.meta.replanNote;
  if (result.recalibration) plan.meta.recalibration = result.recalibration;
  else delete plan.meta.recalibration;

  carryStatusForward(plan);
  writePlan({ request: stored.request, plan });
}

/** Index of the plan week containing `today` (else the next upcoming week). */
function currentWeekIndex(weeks: Plan["weeks"], today: string): number {
  for (let i = 0; i < weeks.length; i++) {
    const end = weeks[i + 1]?.weekStart ?? "9999-12-31";
    if (today >= weeks[i].weekStart && today < end) return i;
  }
  return today < (weeks[0]?.weekStart ?? "") ? 0 : weeks.length;
}

/**
 * Done-toggle for a scheduled strength day, keyed (date, protocolId).
 * Persists to data/app/protocols-state.json (gitignored) via the
 * strength-io gateway. Input is untrusted: the date must be a calendar
 * date and the protocol must exist in the library, else this is a no-op.
 * A plain toggle records every block's sets as done at prescribed dose
 * ("made", not "top") — per-set logging arrives with progression.
 * Pain holds are re-checked here, not just at render (docs §4): marking a
 * held protocol done via a stale form is a no-op; un-marking stays allowed.
 */
export async function toggleStrengthDoneAction(formData: FormData): Promise<void> {
  const date = String(formData.get("date") || "");
  const protocolId = String(formData.get("protocolId") || "");
  const markDone = String(formData.get("current") || "") !== "done";
  const deload = String(formData.get("deload") || "") === "1";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const protocol = SEED_PROTOCOLS.find((p) => p.id === protocolId);
  if (!protocol) return;
  if (markDone && isPainHeld(protocol, surfaceAlerts(readPainLog(), localToday()))) return;
  setStrengthDone(
    date,
    protocolId,
    markDone,
    protocol.blocks.map((b) => ({
      exercise: b.exercise,
      setsDone: deload ? deloadSets(b.sets) : b.sets,
      allSetsAtTop: false,
    })),
    deload
  );
  revalidatePath("/app", "layout");
}

/**
 * Per-set logging for today's strength session — the progression machine's
 * input (docs/strength-module.md §5). Input is untrusted: the date must be
 * a calendar date, the protocol must exist, sets clamp into [0, prescribed]
 * (deload dose in a race week), and "top of range" only counts when every
 * prescribed set was completed. Persisting recomputes progression from the
 * full completion log, so re-logging a day overwrites rather than
 * double-feeding the machine; deload sessions never feed it at all.
 * Pain holds are re-checked here, not just at render (docs §4): logging a
 * held protocol via a stale form or crafted POST is a no-op, so a hold can
 * never extend a progression streak.
 */
export async function logStrengthSetsAction(formData: FormData): Promise<void> {
  const date = String(formData.get("date") || "");
  const protocolId = String(formData.get("protocolId") || "");
  const deload = String(formData.get("deload") || "") === "1";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const protocol = SEED_PROTOCOLS.find((p) => p.id === protocolId);
  if (!protocol) return;
  if (isPainHeld(protocol, surfaceAlerts(readPainLog(), localToday()))) return;
  const results = protocol.blocks.map((b, i) => {
    const prescribed = deload ? deloadSets(b.sets) : b.sets;
    const n = Number(formData.get(`sets-${i}`));
    const setsDone = Number.isFinite(n) ? Math.min(prescribed, Math.max(0, Math.round(n))) : 0;
    return {
      exercise: b.exercise,
      setsDone,
      allSetsAtTop: setsDone >= prescribed && formData.get(`top-${i}`) === "on",
    };
  });
  setStrengthDone(date, protocolId, true, results, deload);
  revalidatePath("/app", "layout");
}

/**
 * Daily pain check-in, appended to data/app/pain-log.json (gitignored —
 * pain logs are health data and never enter git). Input is untrusted: an
 * unknown region is a no-op, the score clamps to an integer 0–10, and the
 * date is always the athlete-local today — the form never supplies it.
 * One entry per (date, region, context); a re-log overwrites.
 */
export async function logPainAction(formData: FormData): Promise<void> {
  const region = parsePainRegion(formData.get("region"));
  const score = parsePainScore(formData.get("score"));
  if (!region || score === null) return;
  logPain({
    date: localToday(),
    region,
    score0to10: score,
    context: parsePainContext(formData.get("context")),
  });
  revalidatePath("/app", "layout");
}

/**
 * One-click accept of the pain-guard suggestion: convert an upcoming
 * quality session to easy at the same duration, via the (date, title)-keyed
 * plan edit (retitleSession — same matching convention as
 * toggleSessionAction/setSessionStatus). Guarded server-side: the session
 * must exist, still be quality, sit today-or-later, and a pain alert must
 * actually be surfacing — a stale or forged form is a no-op.
 */
export async function easeQualitySessionAction(formData: FormData): Promise<void> {
  const date = String(formData.get("date") || "");
  const title = String(formData.get("title") || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < localToday()) return;
  const stored = readPlan();
  const session = stored?.plan.weeks
    .flatMap((w) => w.sessions)
    .find((s) => s.date === date && s.title === title);
  if (!session || session.status === "done") return;
  const eased = easedVersion(session);
  if (!eased) return;
  if (surfaceAlerts(readPainLog(), localToday()).length === 0) return;
  retitleSession(date, title, eased);
  revalidatePath("/app", "layout");
}

export async function toggleSessionAction(formData: FormData): Promise<void> {
  const date = String(formData.get("date"));
  const title = String(formData.get("title"));
  const current = String(formData.get("current") || "");
  setSessionStatus(date, title, current === "done" ? null : "done");
  revalidatePath("/app", "layout");
}
