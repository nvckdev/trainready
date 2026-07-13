"use client";

import { useState } from "react";
import type { DisciplineMode } from "@/lib/athlete-context";

/**
 * Distance + discipline-mode selects with a live consistency warning:
 * a triathlon distance trains three sports, so pairing it with running-only
 * mode is almost certainly a mistake. Warning only — submission stays
 * possible, the athlete may know something we don't.
 */

const RACE_TYPES = [
  ["run-5k", "5K"],
  ["run-10k", "10K"],
  ["run-half", "Half marathon"],
  ["run-marathon", "Marathon"],
  ["sprint", "Sprint tri"],
  ["olympic", "Olympic tri"],
  ["half-ironman", "70.3"],
  ["ironman", "Ironman"],
] as const;

const MODES: [DisciplineMode, string][] = [
  ["running-only", "Running only"],
  ["triathlon", "Triathlon"],
  ["bike-focus", "Bike focus"],
  ["swim-focus", "Swim focus"],
];

const isTri = (t: string) => !t.startsWith("run-");

export function RaceDisciplineFields({
  fieldClass,
  defaultRaceType = "run-half",
  defaultMode = "running-only",
}: {
  fieldClass: string;
  defaultRaceType?: string;
  defaultMode?: DisciplineMode;
}) {
  const [raceType, setRaceType] = useState(defaultRaceType);
  const [mode, setMode] = useState<string>(defaultMode);
  const mismatch = isTri(raceType) && mode === "running-only";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="raceType" className="label-mono text-bone-faint block mb-2">Distance</label>
          <select
            id="raceType"
            name="raceType"
            className={fieldClass}
            value={raceType}
            onChange={(e) => setRaceType(e.target.value)}
          >
            {RACE_TYPES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="disciplineMode" className="label-mono text-bone-faint block mb-2">Training mode</label>
          <select
            id="disciplineMode"
            name="disciplineMode"
            className={fieldClass}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            {MODES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>
      {mismatch && (
        <p role="alert" className="border border-hairline px-3 py-2.5 text-[13px] leading-relaxed text-signal-bright">
          A triathlon distance trains three sports — this plan will still prescribe swim and
          bike sessions. Pick a run distance, or switch training mode to triathlon.
        </p>
      )}
    </div>
  );
}
