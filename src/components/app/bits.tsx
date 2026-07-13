import Link from "next/link";
import { SERIES } from "./charts";
import type { PlannedSessionOut } from "../../../engine/plan.ts";
import { toggleSessionAction } from "@/app/app/actions";
import { sessionAdjustments, type WeekBrief } from "@/lib/week-insights";
import type { SelectedBlock } from "@/lib/strength-protocols";

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

/** Current-week volume + the reasoning behind it. */
export function WeekBriefStrip({ brief }: { brief: WeekBrief }) {
  const remainTss = Math.max(0, brief.targetTss - brief.doneTss);
  return (
    <div className="border border-hairline">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-hairline">
        <span className="label-mono text-bone-faint">
          This week · {brief.weekStart.slice(5)} · {brief.phase} · week {brief.index}/{brief.total}
        </span>
        <span className="label-mono text-bone-faint">
          {brief.doneCount}/{brief.sessionCount} sessions done
        </span>
      </div>
      <div className="px-4 py-4 grid md:grid-cols-[1fr_1fr] gap-5">
        <div className="flex flex-wrap gap-6">
          <div>
            <div className="label-mono text-bone-faint">Target load</div>
            <div className="font-mono text-xl tabular mt-0.5">
              {brief.targetTss} <span className="label-mono text-bone-faint">TSS</span>
            </div>
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
