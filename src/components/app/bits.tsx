import Link from "next/link";
import { SERIES } from "./charts";
import type { PlannedSessionOut } from "../../../engine/plan.ts";
import { toggleSessionAction } from "@/app/app/actions";

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

export function SessionCard({ s, compact = false }: { s: PlannedSessionOut; compact?: boolean }) {
  const done = s.status === "done";
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
        <div className="px-4 py-4 grid md:grid-cols-[1fr_240px] gap-5">
          <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-bone-muted">{s.structure}</pre>
          <div className="border-l border-hairline pl-5">
            <div className="label-mono text-signal-bright mb-1.5">Why</div>
            <p className="text-[13px] leading-relaxed text-bone-muted">{s.why}</p>
          </div>
        </div>
      )}
    </div>
  );
}
