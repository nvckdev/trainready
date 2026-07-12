import { getLatestState, hasCorpus } from "@/lib/athlete-data";
import { EmptyState } from "@/components/app/bits";
import { generatePlanAction } from "../actions";

export const dynamic = "force-dynamic";

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

export default function StartPage() {
  if (!hasCorpus()) {
    return <EmptyState title="No training data connected" body="Run the extraction pipeline (pipeline/README.md), then reload." />;
  }
  const state = getLatestState();
  // Server component, force-dynamic: rendered per request, so "now" is stable
  // for the lifetime of this render.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const minDate = new Date(now + 21 * 86400000).toISOString().slice(0, 10);
  const defaultDate = new Date(now + 112 * 86400000).toISOString().slice(0, 10);

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
            <label htmlFor="raceType" className="label-mono text-bone-faint block mb-2">Distance</label>
            <select id="raceType" name="raceType" className={field} defaultValue="run-half">
              {RACE_TYPES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        </div>
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
