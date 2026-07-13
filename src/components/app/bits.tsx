import Link from "next/link";
import { SERIES } from "./charts";
import type { PlannedSessionOut } from "../../../engine/plan.ts";
import {
  easeQualitySessionAction,
  logPainAction,
  logStrengthSetsAction,
  toggleSessionAction,
  toggleStrengthDoneAction,
} from "@/app/app/actions";
import { sessionAdjustments, type WeekBrief } from "@/lib/week-insights";
import {
  PAIN_CONTEXTS,
  PAIN_CONTEXT_LABEL,
  PAIN_REGIONS,
  type PainEntry,
  type ProgressionState,
  type Protocol,
  type ProtocolBlock,
  type SelectedBlock,
  type StrengthCompletion,
} from "@/lib/strength-protocols";
import { effectiveRepRange, progressionKey, suggestionFor } from "@/lib/strength-progression";
import { INJURY_LABEL } from "@/lib/athlete-context";
import type { PainAlert } from "@/lib/pain-rules";
import { deloadSets } from "@/lib/strength-schedule";

export function StatChip({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="border-l border-hairline pl-4 first:border-l-0 first:pl-0">
      <div className="label-mono text-bone-faint">{label}</div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="font-mono text-2xl tabular">{value}</span>
        {unit && <span className="label-mono text-bone-faint">{unit}</span>}
      </div>
    </div>
  );
}

export function EmptyState({ title, body, cta }: { title: string; body: string; cta?: { href: string; label: string } }) {
  return (
    <div className="border border-hairline px-8 py-14 text-center max-w-[52ch] mx-auto mt-10">
      <p className="display-engraved text-xl">{title}</p>
      <p className="text-bone-muted text-[15px] leading-relaxed mt-3">{body}</p>
      {cta && (
        <Link href={cta.href} className="label-mono inline-block mt-6 bg-signal text-field px-6 py-3 hover:bg-bone transition-colors duration-150">
          {cta.label}
        </Link>
      )}
    </div>
  );
}

export const DISC_COLOR: Record<string, string> = {
  run: SERIES.ctl,
  bike: SERIES.atl,
  swim: SERIES.tsb,
  race: "var(--signal)",
  rest: "var(--bone-faint)",
};

export function SessionCard({
  s,
  compact = false,
  tsb = null,
}: {
  s: PlannedSessionOut;
  compact?: boolean;
  tsb?: number | null;
}) {
  const done = s.status === "done";
  const adj = compact ? null : sessionAdjustments(s, tsb);
  return (
    <div className={`border border-hairline ${done ? "opacity-55" : ""}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DISC_COLOR[s.discipline] }} aria-hidden="true" />
          <span className="label-mono text-bone-faint">{s.weekday} {s.date.slice(5)}</span>
          <span className={`font-semibold ${done ? "line-through" : ""}`}>{s.title}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-sm tabular text-bone-muted">
            {Math.round(s.durationHr * 60)}min · {s.tss} TSS
          </span>
          {s.discipline !== "race" && (
            <form action={toggleSessionAction}>
              <input type="hidden" name="date" value={s.date} />
              <input type="hidden" name="title" value={s.title} />
              <input type="hidden" name="current" value={s.status ?? ""} />
              <button className="label-mono border border-hairline px-3 py-1.5 hover:border-bone transition-colors duration-150">
                {done ? "Undo" : "Done"}
              </button>
            </form>
          )}
        </div>
      </div>
      {!compact && (
        <>
          <div className="px-4 py-4 grid md:grid-cols-[1fr_240px] gap-5">
            <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-bone-muted">{s.structure}</pre>
            <div className="border-l border-hairline pl-5">
              <div className="label-mono text-signal-bright mb-1.5">Why</div>
              <p className="text-[13px] leading-relaxed text-bone-muted">{s.why}</p>
            </div>
          </div>
          {adj && adj.options.length > 0 && (
            <div className="px-4 py-4 border-t border-hairline">
              <div className="label-mono text-bone-faint mb-3">Acceptable adjustments · match the session to the day</div>
              {adj.nudge && (
                <p className="text-[13px] leading-relaxed text-signal-bright mb-3">{adj.nudge}</p>
              )}
              <div className="grid md:grid-cols-3 gap-4">
                {adj.options.map((o) => (
                  <div key={o.feeling}>
                    <div className="label-mono text-bone mb-1">{o.feeling}</div>
                    <p className="text-[12.5px] leading-relaxed text-bone-muted">{o.advice}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** This week's supplemental strength blocks — outside the engine plan, no
 *  TSS. Callers render nothing when the selection is empty. */
export function SupplementalCard({ blocks }: { blocks: SelectedBlock[] }) {
  if (blocks.length === 0) return null;
  return (
    <div className="border border-hairline">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-hairline">
        <span className="label-mono text-bone-faint">Supplemental · injury prevention</span>
        <span className="label-mono text-bone-faint">outside the plan · no TSS</span>
      </div>
      <div className="grid md:grid-cols-2">
        {blocks.map(({ block, why }, i) => (
          <div key={block.id} className={`px-4 py-4 ${i > 0 ? "border-t md:border-t-0 md:border-l border-hairline" : ""}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold text-[15px]">{block.title}</span>
              <span className="font-mono text-sm tabular text-bone-muted shrink-0">~{block.minutes} min</span>
            </div>
            <ul className="mt-3 space-y-1.5">
              {block.exercises.map((ex) => (
                <li key={ex.name} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-bone-muted">
                    {ex.name}
                    {ex.cue && <span className="text-bone-faint"> — {ex.cue}</span>}
                  </span>
                  <span className="font-mono tabular text-bone shrink-0">{ex.dose}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 pt-3 border-t border-hairline">
              <span className="label-mono text-signal-bright">Why</span>
              <p className="text-[12.5px] leading-relaxed text-bone-muted mt-1">{why}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="px-4 pb-3 label-mono text-bone-faint">
        Twice this week, any easy day. These sit outside the engine plan and add no training load.
      </p>
    </div>
  );
}

/* ——— Scheduled strength checklist ——————————————————————————— */

/** One scheduled strength day, ready to render (done-state resolved). */
export interface StrengthItemView {
  date: string;
  weekday: string;
  protocol: Protocol;
  deload: boolean;
  done: boolean;
  /** Per-exercise results already logged for this (date, protocolId), if any. */
  logged?: StrengthCompletion["results"];
}

function blockDose(b: ProtocolBlock, deload: boolean, state?: ProgressionState | null): string {
  const sets = deload ? deloadSets(b.sets) : b.sets;
  const [lo, hi] = effectiveRepRange(b, state);
  return `${sets}×${lo === hi ? lo : `${lo}–${hi}`}`;
}

/** Not a plan session: no discipline dot — a hairline-bordered "S" glyph in
 *  bone-muted marks strength rows as layered outside the engine plan. */
function StrengthGlyph() {
  return (
    <span
      className="w-5 h-5 border border-hairline flex items-center justify-center label-mono text-bone-muted shrink-0"
      aria-hidden="true"
    >
      S
    </span>
  );
}

/**
 * This week's scheduled strength days, placed around the engine plan by
 * strength-schedule.ts — never written into plan.json, never counted as
 * load. Today's session expands into a set-logging form whose results feed
 * the progression machine (strength-progression.ts): per exercise, sets
 * completed plus a top-of-range toggle, with the machine's current load and
 * nudge rendered beside each exercise. The rest of the week renders as
 * compact rows. Callers render nothing when `items` is empty.
 */
export function DayStrengthChecklist({
  items,
  notes,
  today,
  progression = null,
}: {
  items: StrengthItemView[];
  notes: string[];
  today: string;
  /** Stored progression map keyed `${protocolId}␟${exercise}`. */
  progression?: Record<string, ProgressionState> | null;
}) {
  if (items.length === 0) return null;
  return (
    <div className="border border-hairline">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-hairline">
        <span className="label-mono text-bone-faint">Strength · this week</span>
        <span className="label-mono text-bone-faint">outside the plan · no TSS</span>
      </div>
      {items.map((item) => {
        const expanded = item.date === today;
        const { protocol } = item;
        return (
          <div
            key={item.date + protocol.id}
            className={`border-b border-hairline last:border-b-0 ${item.done ? "opacity-55" : ""}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <StrengthGlyph />
                <span className="label-mono text-bone-faint">
                  {expanded ? "Today" : item.weekday} {item.date.slice(5)}
                </span>
                <span className={`font-semibold ${item.done ? "line-through" : ""}`}>
                  {protocol.name}
                </span>
                {protocol.rehab && <span className="label-mono text-bone-faint">rehab · daily</span>}
                {item.deload && (
                  <span className="label-mono text-signal-bright">race week · sets halved</span>
                )}
              </div>
              <div className="flex items-center gap-4">
                {protocol.minutes && (
                  <span className="font-mono text-sm tabular text-bone-muted">
                    ~{protocol.minutes} min
                  </span>
                )}
                <form action={toggleStrengthDoneAction}>
                  <input type="hidden" name="date" value={item.date} />
                  <input type="hidden" name="protocolId" value={protocol.id} />
                  <input type="hidden" name="current" value={item.done ? "done" : ""} />
                  <input type="hidden" name="deload" value={item.deload ? "1" : ""} />
                  <button className="label-mono border border-hairline px-3 py-1.5 hover:border-bone transition-colors duration-150">
                    {item.done ? "Undo" : "Done"}
                  </button>
                </form>
              </div>
            </div>
            {expanded && (
              <div className="px-4 pb-4">
                <form action={logStrengthSetsAction}>
                  <input type="hidden" name="date" value={item.date} />
                  <input type="hidden" name="protocolId" value={protocol.id} />
                  <input type="hidden" name="deload" value={item.deload ? "1" : ""} />
                  <ul>
                    {protocol.blocks.map((b, i) => {
                      const state = progression?.[progressionKey(protocol.id, b.exercise)] ?? null;
                      const sugg = suggestionFor(b, state, item.deload);
                      const prescribed = item.deload ? deloadSets(b.sets) : b.sets;
                      const logged = item.logged?.find((r) => r.exercise === b.exercise);
                      return (
                        <li
                          key={b.exercise}
                          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 border-t border-hairline first:border-t-0 text-[13px]"
                        >
                          <div className="min-w-0">
                            <span className="text-bone-muted">
                              {b.exercise}
                              {b.tempo && <span className="text-bone-faint"> — {b.tempo}</span>}
                            </span>
                            <span className="font-mono tabular text-bone ml-3">
                              {blockDose(b, item.deload, state)}
                              {sugg.load && <span className="text-bone-muted"> · {sugg.load}</span>}
                            </span>
                            {sugg.hint && (
                              <p className="label-mono text-signal-bright mt-1">{sugg.hint}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-4 shrink-0">
                            <label className="flex items-center gap-2 label-mono text-bone-faint">
                              sets
                              <select
                                name={`sets-${i}`}
                                defaultValue={String(logged?.setsDone ?? prescribed)}
                                className="bg-field-sunken border border-hairline px-2 py-1 font-mono text-sm text-bone focus:border-bone outline-none"
                              >
                                {Array.from({ length: prescribed + 1 }, (_, n) => (
                                  <option key={n} value={n}>
                                    {n}/{prescribed}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="flex items-center gap-2 label-mono text-bone-faint cursor-pointer">
                              <input
                                type="checkbox"
                                name={`top-${i}`}
                                defaultChecked={logged?.allSetsAtTop ?? false}
                                className="accent-current"
                              />
                              top of range
                            </label>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex flex-wrap items-center gap-4 mt-2 pt-3 border-t border-hairline">
                    <button className="label-mono border border-hairline px-4 py-2 hover:border-bone transition-colors duration-150">
                      {item.done ? "Update sets" : "Log sets"}
                    </button>
                    <p className="label-mono text-bone-faint">
                      {item.deload
                        ? "Race week — deload dose; progression is frozen."
                        : "Two top-of-range sessions move a load up; two misses step it back."}
                    </p>
                  </div>
                </form>
                {protocol.why && (
                  <div className="mt-3 pt-3 border-t border-hairline">
                    <span className="label-mono text-signal-bright">Why</span>
                    <p className="text-[12.5px] leading-relaxed text-bone-muted mt-1">{protocol.why}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="px-4 py-3 space-y-1 border-t border-hairline">
        {notes.map((n) => (
          <p key={n} className="label-mono text-bone-faint">
            {n}
          </p>
        ))}
        <p className="label-mono text-bone-faint">
          Placed around your plan — never within 24h of quality or racing. Adds no training load.
        </p>
      </div>
    </div>
  );
}

/* ——— Pain tracker ————————————————————————————————————————— */

/** The pain-guard suggestion, ready to render: one upcoming quality
 *  session and what it becomes if the athlete accepts. */
export interface EaseSuggestionView {
  date: string;
  weekday: string;
  title: string;
  easedTitle: string;
}

/**
 * Pain surface-rule banner (docs/strength-module.md §4): plain-language
 * alerts, a load-reduction + physio recommendation, and — when an upcoming
 * quality session exists — a one-click convert-to-easy suggestion. Same
 * visual family as WeekBriefStrip: bone tokens on hairline borders, never
 * a series color. Callers render nothing when `alerts` is empty.
 */
export function PainAlertBanner({
  alerts,
  suggestion,
}: {
  alerts: PainAlert[];
  suggestion: EaseSuggestionView | null;
}) {
  if (alerts.length === 0) return null;
  return (
    <div className="border border-hairline">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-hairline">
        <span className="label-mono text-signal-bright">Pain surfacing</span>
        <span className="label-mono text-bone-faint">athlete-reported · not a diagnosis</span>
      </div>
      <div className="px-4 py-4 space-y-2">
        {alerts.map((a) => (
          <p key={a.region + a.rule} className="text-[13px] leading-relaxed text-bone-muted">
            {a.detail}
          </p>
        ))}
        <p className="text-[13px] leading-relaxed text-bone max-w-[68ch]">
          Reduce load around the affected tissue this week — ease intensity before volume.
          If it persists, book a physio: Taper explains training, it doesn&apos;t diagnose pain.
        </p>
      </div>
      {suggestion && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-hairline">
          <p className="text-[13px] leading-relaxed text-bone-muted">
            Suggested: convert your next quality session,{" "}
            <span className="text-bone font-semibold">{suggestion.title}</span> ({suggestion.weekday}{" "}
            {suggestion.date.slice(5)}), to <span className="text-bone">{suggestion.easedTitle}</span>{" "}
            — same duration, easy effort only.
          </p>
          <form action={easeQualitySessionAction}>
            <input type="hidden" name="date" value={suggestion.date} />
            <input type="hidden" name="title" value={suggestion.title} />
            <button className="label-mono border border-hairline px-3 py-1.5 hover:border-bone transition-colors duration-150 shrink-0">
              Make it easy
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

const painField =
  "bg-field-sunken border border-hairline px-3 py-2 font-mono text-sm text-bone focus:border-bone outline-none";

/**
 * Daily pain quick-entry (region / score / context). Writes through
 * logPainAction to data/app/pain-log.json — health data, gitignored,
 * never leaves this machine. Today's entries render back as confirmation;
 * re-logging the same region + context overwrites.
 */
export function PainQuickEntry({ todays }: { todays: PainEntry[] }) {
  return (
    <div className="border border-hairline">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-hairline">
        <span className="label-mono text-bone-faint">Pain check-in · today</span>
        <span className="label-mono text-bone-faint">health data · stays on this machine</span>
      </div>
      <form action={logPainAction} className="px-4 py-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="pain-region" className="label-mono text-bone-faint block mb-2">
            Region
          </label>
          <select id="pain-region" name="region" className={painField} defaultValue={PAIN_REGIONS[0]}>
            {PAIN_REGIONS.map((r) => (
              <option key={r} value={r}>
                {INJURY_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pain-score" className="label-mono text-bone-faint block mb-2">
            Score · 0–10
          </label>
          <select id="pain-score" name="score" className={painField} defaultValue="0">
            {Array.from({ length: 11 }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pain-context" className="label-mono text-bone-faint block mb-2">
            When
          </label>
          <select id="pain-context" name="context" className={painField} defaultValue="after-session">
            {PAIN_CONTEXTS.map((c) => (
              <option key={c} value={c}>
                {PAIN_CONTEXT_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <button className="label-mono border border-hairline px-4 py-2.5 hover:border-bone transition-colors duration-150">
          Log
        </button>
      </form>
      {todays.length > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-x-5 gap-y-1">
          {todays.map((e) => (
            <span key={e.region + e.context} className="label-mono text-bone-faint">
              {INJURY_LABEL[e.region]} {e.score0to10}/10 · {PAIN_CONTEXT_LABEL[e.context].toLowerCase()}
            </span>
          ))}
        </div>
      )}
      <p className="px-4 pb-3 label-mono text-bone-faint">
        0 = nothing, 10 = worst imaginable. Three hard days in a row, pain at rest, or a rising week
        raises a flag above — nothing here changes your plan by itself.
      </p>
    </div>
  );
}

/** Display-only strength load beside the week target (docs §6): scheduled
 *  non-rehab sessions × the configured per-session TSS. Never summed into
 *  targetTss — that stays the engine's number. */
export interface StrengthWeekView {
  scheduled: number;
  done: number;
  tss: number;
}

/** Current-week volume + the reasoning behind it. */
export function WeekBriefStrip({
  brief,
  strength = null,
}: {
  brief: WeekBrief;
  strength?: StrengthWeekView | null;
}) {
  const remainTss = Math.max(0, brief.targetTss - brief.doneTss);
  return (
    <div className="border border-hairline">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-hairline">
        <span className="label-mono text-bone-faint">
          This week · {brief.weekStart.slice(5)} · {brief.phase} · week {brief.index}/{brief.total}
        </span>
        <span className="label-mono text-bone-faint">
          {brief.doneCount}/{brief.sessionCount} sessions done
          {strength && strength.scheduled > 0 && ` · ${strength.done}/${strength.scheduled} strength`}
        </span>
      </div>
      <div className="px-4 py-4 grid md:grid-cols-[1fr_1fr] gap-5">
        <div className="flex flex-wrap gap-6">
          <div>
            <div className="label-mono text-bone-faint">Target load</div>
            <div className="font-mono text-xl tabular mt-0.5">
              {brief.targetTss} <span className="label-mono text-bone-faint">TSS</span>
            </div>
            {strength && strength.tss > 0 && (
              <div className="label-mono text-bone-faint mt-1">
                +{strength.tss} TSS strength · display only
              </div>
            )}
          </div>
          <div>
            <div className="label-mono text-bone-faint">Volume</div>
            <div className="font-mono text-xl tabular mt-0.5">
              {brief.plannedHours.toFixed(1)} <span className="label-mono text-bone-faint">hrs</span>
            </div>
          </div>
          {brief.plannedRunKm > 0 && (
            <div>
              <div className="label-mono text-bone-faint">Run mileage</div>
              <div className="font-mono text-xl tabular mt-0.5">
                ≈{Math.round(brief.plannedRunKm)} <span className="label-mono text-bone-faint">km</span>
              </div>
            </div>
          )}
          <div>
            <div className="label-mono text-bone-faint">Remaining</div>
            <div className="font-mono text-xl tabular mt-0.5">
              {remainTss} <span className="label-mono text-bone-faint">TSS</span>
            </div>
          </div>
        </div>
        <div className="md:border-l md:border-hairline md:pl-5">
          <div className="label-mono text-signal-bright mb-1.5">Why this volume</div>
          <ul className="space-y-1">
            {brief.why.map((line, i) => (
              <li key={i} className="text-[12.5px] leading-relaxed text-bone-muted">
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
