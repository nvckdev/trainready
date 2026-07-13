import { getLatestState, hasCorpus, localToday } from "@/lib/athlete-data";
import { INJURY_AREAS, INJURY_LABEL, readAthleteContext } from "@/lib/athlete-context";
import { EmptyState } from "@/components/app/bits";
import { RaceDisciplineFields } from "@/components/app/intake-fields";
import { generatePlanAction } from "../actions";

export const dynamic = "force-dynamic";

export default function StartPage() {
  if (!hasCorpus()) {
    return <EmptyState title="No training data connected" body="Run the extraction pipeline (pipeline/README.md), then reload." />;
  }
  const state = getLatestState();
  const intake = readAthleteContext()?.intake ?? null;
  // Server component, force-dynamic: rendered per request, so "today" is
  // stable for the lifetime of this render. Anchored to the athlete's
  // timezone (America/New_York), not UTC — see localToday.
  const todayT = Date.parse(localToday() + "T12:00:00Z");
  const fmtUtc = (t: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date(t));
  const minDate = fmtUtc(todayT + 21 * 86400000);
  const defaultDate = fmtUtc(todayT + 112 * 86400000);

  const field =
    "w-full bg-field-sunken border border-hairline px-3 py-2.5 font-mono text-sm text-bone focus:border-bone outline-none";

  return (
    <div className="max-w-[560px]">
      <p className="label-mono text-bone-muted">New goal</p>
      <h1 className="display-engraved text-3xl mt-1">Aim at a race</h1>
      <p className="text-bone-muted text-[15px] leading-relaxed mt-3">
        Taper drafts every week between now and the gun from your current
        fitness{state ? ` (CTL ${Math.round(state.ctl)}, form ${Math.round(state.tsb)})` : ""},
        learned from {state ? "your full training history" : "physiology priors"}.
        Every session states its why.
      </p>
      <div className="rule mt-6 mb-8" />

      <form action={generatePlanAction} className="space-y-6">
        <div>
          <label htmlFor="raceName" className="label-mono text-bone-faint block mb-2">Race name</label>
          <input id="raceName" name="raceName" required placeholder="Barrelman 70.3" className={field} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="raceDate" className="label-mono text-bone-faint block mb-2">Race date</label>
            <input id="raceDate" name="raceDate" type="date" required min={minDate} defaultValue={defaultDate} className={field} />
          </div>
          <div>
            <label htmlFor="weeklyHours" className="label-mono text-bone-faint block mb-2">Hours available / week</label>
            <input
              id="weeklyHours"
              name="weeklyHours"
              type="number"
              min={2}
              max={30}
              step={0.5}
              required
              defaultValue={intake?.weeklyHours ?? 8}
              className={field}
            />
          </div>
        </div>
        <RaceDisciplineFields fieldClass={field} defaultMode={intake?.disciplineMode ?? "running-only"} />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="daysPerWeek" className="label-mono text-bone-faint block mb-2">Days per week</label>
            <select id="daysPerWeek" name="daysPerWeek" className={field} defaultValue="6">
              {[4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="longDay" className="label-mono text-bone-faint block mb-2">Long day</label>
            <select id="longDay" name="longDay" className={field} defaultValue="saturday">
              <option value="saturday">Saturday</option>
              <option value="sunday">Sunday</option>
            </select>
          </div>
        </div>
        <div className="border border-hairline p-4">
          <label className="flex items-center gap-2.5 text-[13px] text-bone-muted cursor-pointer">
            <input
              type="checkbox"
              name="demonstratedCapacityAnchoring"
              value="1"
              defaultChecked
              className="accent-current"
            />
            Use demonstrated-capacity anchoring (recommended)
          </label>
          <p className="label-mono text-bone-faint mt-2">
            Weights your recent peak weeks over the trailing average, so scheduling gaps don&apos;t suppress your targets.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="strengthAccess" className="label-mono text-bone-faint block mb-2">Strength access</label>
            <select id="strengthAccess" name="strengthAccess" className={field} defaultValue={intake?.strengthAccess ?? "bodyweight"}>
              <option value="none">None</option>
              <option value="bodyweight">Bodyweight only</option>
              <option value="full-gym">Full gym</option>
            </select>
          </div>
          <div>
            <label htmlFor="experienceLevel" className="label-mono text-bone-faint block mb-2">Experience</label>
            <select id="experienceLevel" name="experienceLevel" className={field} defaultValue={intake?.experienceLevel ?? "intermediate"}>
              <option value="beginner">Newer to structure (&lt;2 yrs)</option>
              <option value="intermediate">Consistent (2–5 yrs)</option>
              <option value="advanced">Long history (5+ yrs)</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="strengthTss" className="label-mono text-bone-faint block mb-2">
            Strength session load · TSS
          </label>
          <input
            id="strengthTss"
            name="strengthTss"
            type="number"
            min={5}
            max={60}
            step={5}
            defaultValue={intake?.strengthTss ?? 20}
            className={field}
          />
          <p className="label-mono text-bone-faint mt-2">
            Shown beside weekly totals for completed strength work. Display only — the plan
            engine and your fitness numbers never count it.
          </p>
        </div>
        <fieldset className="border border-hairline p-4">
          <legend className="label-mono text-bone-faint px-2">Injury history · check what applies</legend>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
            {INJURY_AREAS.map((area) => (
              <label key={area} className="flex items-center gap-2.5 text-[13px] text-bone-muted cursor-pointer">
                <input
                  type="checkbox"
                  name="injuries"
                  value={area}
                  defaultChecked={intake?.injuries.includes(area) ?? false}
                  className="accent-current"
                />
                {INJURY_LABEL[area]}
              </label>
            ))}
          </div>
          <div className="mt-4">
            <label htmlFor="injuryNotes" className="label-mono text-bone-faint block mb-2">Notes · anything else Taper should know</label>
            <textarea
              id="injuryNotes"
              name="injuryNotes"
              rows={2}
              placeholder="e.g. left achilles flares past 60 km/week"
              defaultValue={intake?.injuryNotes ?? ""}
              className={field}
            />
          </div>
          <p className="label-mono text-bone-faint mt-3">
            Drives the supplemental prevention work on Today. Stays local (data/, never in git).
          </p>
        </fieldset>
        <button className="label-mono bg-signal text-field px-8 py-4 hover:bg-bone transition-colors duration-150">
          Draft the season
        </button>
        <p className="label-mono text-bone-faint">
          Generating replaces the current plan. Weeks re-flow any time from Plan → Re-plan from today.
        </p>
      </form>
    </div>
  );
}
