import { fmtHMS, fmtPace, type CapabilityProfile, type RaceDayPlan } from "../../../engine/raceday.ts";

/**
 * Race-day execution + capability cards. Pure presentation over the engine's
 * race models (engine/raceday.ts). Bone/hairline/label-mono to match bits.tsx;
 * the ember signal marks the honest headline number.
 */

export function RaceDayCard({ plan, raceName, raceDate }: { plan: RaceDayPlan; raceName: string; raceDate: string }) {
  return (
    <div className="border border-hairline">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-hairline">
        <span className="label-mono text-bone-faint">Race-day execution · {raceName}</span>
        <span className="label-mono text-bone-faint">{raceDate}</span>
      </div>

      <div className="px-4 py-5 flex flex-wrap items-end gap-8 border-b border-hairline">
        <div>
          <div className="label-mono text-bone-faint">Target finish</div>
          <div className="font-mono text-3xl tabular text-signal-bright mt-1">{fmtHMS(plan.targetSec)}</div>
        </div>
        <div>
          <div className="label-mono text-bone-faint">Goal pace</div>
          <div className="font-mono text-xl tabular mt-1">{fmtPace(plan.avgPaceSecPerKm)}</div>
        </div>
        {plan.weatherAdjusted && plan.tempC != null && (
          <div>
            <div className="label-mono text-bone-faint">Heat-adjusted</div>
            <div className="font-mono text-xl tabular mt-1">{Math.round(plan.tempC)}°C</div>
          </div>
        )}
      </div>

      {/* Pacing table — negative-split thirds */}
      <div className="px-4 py-4 border-b border-hairline">
        <div className="label-mono text-bone-faint mb-3">Pacing · {plan.strategy.includes("negative") ? "negative split" : "even effort"}</div>
        <div className="space-y-2">
          {plan.splits.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-bone-muted w-28 shrink-0">{s.label}</span>
              <span className="font-mono tabular text-bone flex-1">{fmtPace(s.paceSecPerKm)}</span>
              <span className="font-mono tabular text-bone-faint">{fmtHMS(s.cumulativeSec)}</span>
            </div>
          ))}
        </div>
        <p className="text-[12.5px] leading-relaxed text-bone-muted mt-3">{plan.strategy}</p>
      </div>

      {/* Fuelling schedule */}
      {plan.fuel.length > 0 && (
        <div className="px-4 py-4 border-b border-hairline">
          <div className="label-mono text-bone-faint mb-3">
            Fuelling · {plan.carbsPerHourG[0] === 0 ? "≤" : `${plan.carbsPerHourG[0]}–`}{plan.carbsPerHourG[1]} g carbs/hr · ~{plan.fluidPerHourMl} mL/hr
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1.5">
            {plan.fuel.slice(0, 12).map((f, i) => (
              <div key={i} className="flex items-baseline gap-2 text-[13px]">
                <span className="font-mono tabular text-signal-bright w-12 shrink-0">{f.atMin}′</span>
                <span className="text-bone">{f.label}</span>
                <span className="text-bone-faint">{f.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Honest notes */}
      <div className="px-4 py-4">
        <ul className="space-y-1.5">
          {plan.notes.map((n, i) => (
            <li key={i} className="text-[12.5px] leading-relaxed text-bone-muted">{n}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function CapabilityCard({ cap }: { cap: CapabilityProfile }) {
  const pct = cap.pctOfPeak != null ? Math.round(cap.pctOfPeak * 100) : null;
  return (
    <div className="border border-hairline">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-hairline">
        <span className="label-mono text-bone-faint">Current capability · what you could race today</span>
        <span className="label-mono text-bone-faint">est · from your fitness</span>
      </div>

      {pct != null && (
        <div className="px-4 py-4 border-b border-hairline">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <span className="label-mono text-bone-faint">Toward peak-era capability</span>
            <span className="font-mono tabular text-bone">{pct}%</span>
          </div>
          <div className="h-1.5 bg-hairline overflow-hidden">
            <div className="h-full bg-signal" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[12.5px] leading-relaxed text-bone-muted mt-2">
            Current run fitness (VDOT {cap.vdotNow.toFixed(1)}) against your demonstrated peak
            (VDOT {cap.vdotPeak?.toFixed(1)}). Base and speed carry — CTL alone understates you.
          </p>
        </div>
      )}

      <div className="px-4 py-4 grid grid-cols-2 md:grid-cols-4 gap-y-4 gap-x-3">
        {cap.distances.map((d) => (
          <div key={d.label}>
            <div className="label-mono text-bone-faint">{d.label}</div>
            <div className="font-mono text-lg tabular mt-0.5">{fmtHMS(d.finishSec)}</div>
            <div className="label-mono text-bone-faint mt-0.5">{fmtPace(d.paceSecPerKm)}</div>
          </div>
        ))}
      </div>
      <p className="px-4 pb-4 label-mono text-bone-faint">
        Equivalent finishes from today&apos;s fitness via the same history-anchored model — estimates, not predictions.
      </p>
    </div>
  );
}
