import { getPmc, getStravaSnapshot, getStravaTokens, hasCorpus, localToday, stravaConfigured } from "@/lib/athlete-data";
import { readAthleteContext } from "@/lib/athlete-context";
import { supplementalForContext } from "@/lib/strength-protocols";
import { readPlan } from "@/lib/plan-io";
import { readPainLog, readProtocolsState, isStrengthDone } from "@/lib/strength-io";
import { activeProtocols, scheduleStrengthWeek } from "@/lib/strength-schedule";
import { surfaceAlerts } from "@/lib/pain-rules";
import { INJURY_LABEL } from "@/lib/athlete-context";
import { QUALITY, briefForWeek, currentWeek, easedVersion } from "@/lib/week-insights";
import {
  DayStrengthChecklist,
  EmptyState,
  PainAlertBanner,
  PainQuickEntry,
  SessionCard,
  StatChip,
  SupplementalCard,
  WeekBriefStrip,
  type EaseSuggestionView,
  type StrengthItemView,
} from "@/components/app/bits";
import { WeatherHint } from "@/components/app/weather-hint";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  if (!hasCorpus()) {
    // Deployed site has no data/ directory — Strava OAuth stands in.
    const tokens = await getStravaTokens();
    const snapshot = tokens ? await getStravaSnapshot() : null;
    if (snapshot) {
      const latest = snapshot.pmc[snapshot.pmc.length - 1];
      return (
        <div>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <h1 className="display-engraved text-3xl">Today</h1>
            <div className="flex gap-6">
              <StatChip label="Fitness" value={String(Math.round(latest?.ctl ?? 0))} unit="CTL" />
              <StatChip label="Fatigue" value={String(Math.round(latest?.atl ?? 0))} unit="ATL" />
              <StatChip label="Form" value={String(Math.round(latest?.tsb ?? 0))} unit="TSB" />
            </div>
          </div>
          <div className="rule mt-5 mb-8" />
          <div className="border border-hairline">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-hairline">
              <span className="label-mono text-bone-faint">Connected via Strava · last 120 days · estimated load</span>
              <a href="/api/strava/disconnect" className="label-mono text-bone-faint hover:text-bone transition-colors duration-150">
                Disconnect
              </a>
            </div>
            <div className="px-4 py-4 flex flex-wrap gap-8">
              <div>
                <div className="label-mono text-bone-faint">Last 7 days</div>
                <div className="font-mono text-xl tabular mt-0.5">
                  {Math.round(snapshot.weekTss)} <span className="label-mono text-bone-faint">TSS est</span>
                </div>
              </div>
              <div>
                <div className="label-mono text-bone-faint">Run mileage · 7d</div>
                <div className="font-mono text-xl tabular mt-0.5">
                  {snapshot.weekRunKm.toFixed(1)} <span className="label-mono text-bone-faint">km</span>
                </div>
              </div>
              <div>
                <div className="label-mono text-bone-faint">Activities · 120d</div>
                <div className="font-mono text-xl tabular mt-0.5">{snapshot.activityCount}</div>
              </div>
            </div>
            <p className="px-4 pb-4 text-[12.5px] leading-relaxed text-bone-muted max-w-[62ch]">
              Fitness numbers here are estimated from Strava relative effort and duration — good for trend,
              not for prescription. Full plans still come from the local corpus (see pipeline/README.md).
            </p>
          </div>
        </div>
      );
    }
    return (
      <EmptyState
        title="No training data connected"
        body={
          stravaConfigured()
            ? "Connect Strava to see your fitness, fatigue, and weekly mileage here — or run the local extraction pipeline (pipeline/README.md) for full plan generation."
            : "Taper reads your history from the local corpus (data/). Run the extraction pipeline described in pipeline/README.md, then reload."
        }
        cta={stravaConfigured() ? { href: "/api/strava/login", label: "Connect Strava" } : undefined}
      />
    );
  }

  const pmc = getPmc();
  const latest = pmc[pmc.length - 1];
  const stored = readPlan();
  const today = localToday();

  const upcoming = stored
    ? stored.plan.weeks
        .flatMap((w) => w.sessions)
        .filter((s) => s.date >= today)
        .slice(0, 4)
    : [];
  const [next, ...rest] = upcoming;
  const daysToRace = stored
    ? Math.max(0, Math.round((Date.parse(stored.plan.meta.raceDate) - Date.parse(today)) / 86400000))
    : null;
  const weekBrief = stored ? briefForWeek(stored.plan, today, stored.plan.meta.raceName) : null;
  const tsb = latest ? latest.tsb : null;

  // Pain layer — the log is health data (data/app/pain-log.json, gitignored)
  // read through the strength-io gateway. Surface rules are pure functions;
  // their consequences are advisory: a banner, a convert-to-easy suggestion
  // on the next quality session, and a scheduler hold. The engine's plan is
  // never altered without the athlete's click.
  const painEntries = readPainLog();
  const painAlerts = surfaceAlerts(painEntries, today);
  const todaysPain = painEntries.filter((e) => e.date === today);
  let easeSuggestion: EaseSuggestionView | null = null;
  if (painAlerts.length > 0 && stored) {
    const nextQuality = stored.plan.weeks
      .flatMap((w) => w.sessions)
      .find(
        (s) =>
          s.date >= today &&
          s.status !== "done" &&
          s.discipline !== "race" &&
          s.discipline !== "rest" &&
          QUALITY.test(s.title)
      );
    const eased = nextQuality ? easedVersion(nextQuality) : null;
    if (nextQuality && eased) {
      easeSuggestion = {
        date: nextQuality.date,
        weekday: nextQuality.weekday,
        title: nextQuality.title,
        easedTitle: eased.title,
      };
    }
  }

  // Strength layer — scheduled per-day around the plan week when protocols
  // are active (intake context + optional protocols-state.json), falling
  // back to the stateless weekly SupplementalCard otherwise. Both render
  // nothing without recorded context; strength never enters plan.json.
  const ctx = readAthleteContext();
  const strengthState = readProtocolsState();
  const protocols = activeProtocols(ctx, strengthState);
  // Pain hold (§4): non-rehab protocols targeting an alerted region skip
  // scheduling until the rule clears; rehab work stays daily-eligible.
  const alertRegions = new Set(painAlerts.map((a) => a.region));
  const held = protocols.filter(
    (p) => !p.rehab && (p.targets ?? []).some((t) => alertRegions.has(t))
  );
  const schedulable = protocols.filter((p) => !held.includes(p));
  const found = stored ? currentWeek(stored.plan, today) : null;
  let strengthItems: StrengthItemView[] = [];
  let strengthNotes: string[] = held.map(
    (p) =>
      `${p.name} on hold — pain surfacing in ${(p.targets ?? [])
        .filter((t) => alertRegions.has(t))
        .map((t) => INJURY_LABEL[t].toLowerCase())
        .join(", ")}; let the tissue settle`
  );
  if (found && schedulable.length > 0) {
    const schedule = scheduleStrengthWeek(
      found.week,
      stored!.plan.weeks[found.index + 1] ?? null,
      schedulable,
      today
    );
    strengthItems = schedule.days.map((d) => ({
      date: d.date,
      weekday: d.weekday,
      protocol: d.protocol,
      deload: d.deload,
      done: isStrengthDone(strengthState, d.date, d.protocol.id),
    }));
    strengthNotes = [...strengthNotes, ...schedule.notes];
  }
  // Fall back to the stateless weekly card only when the protocol layer is
  // inactive — never when it is active but pain-held (the hold IS the message).
  const supplemental = protocols.length > 0 && found ? [] : supplementalForContext(ctx);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h1 className="display-engraved text-3xl">Today</h1>
        <div className="flex gap-6">
          <StatChip label="Fitness" value={String(Math.round(latest?.ctl ?? 0))} unit="CTL" />
          <StatChip label="Fatigue" value={String(Math.round(latest?.atl ?? 0))} unit="ATL" />
          <StatChip label="Form" value={String(Math.round(latest?.tsb ?? 0))} unit="TSB" />
          {daysToRace !== null && <StatChip label="Race in" value={String(daysToRace)} unit="days" />}
        </div>
      </div>
      <WeatherHint />
      <div className="rule mt-5 mb-8" />

      {painAlerts.length > 0 && (
        <div className="mb-8">
          <PainAlertBanner alerts={painAlerts} suggestion={easeSuggestion} />
        </div>
      )}

      {!stored ? (
        <EmptyState
          title="No active plan"
          body="Point Taper at a race and it will draft the season from your current fitness."
          cta={{ href: "/app/start", label: "Set a goal" }}
        />
      ) : !next ? (
        <EmptyState
          title="Season complete"
          body="Every planned session is behind you. Set the next goal when you're ready."
          cta={{ href: "/app/start", label: "New goal" }}
        />
      ) : (
        <div className="space-y-8">
          {weekBrief && <WeekBriefStrip brief={weekBrief} />}
          <div>
            <p className="label-mono text-bone-muted mb-3">
              {next.date === today ? "Today's session" : `Next session · ${next.weekday} ${next.date.slice(5)}`}
            </p>
            <SessionCard s={next} tsb={tsb} />
          </div>
          {rest.length > 0 && (
            <div>
              <p className="label-mono text-bone-muted mb-3">Then</p>
              <div className="space-y-2">
                {rest.map((s) => (
                  <SessionCard key={s.date + s.title} s={s} compact />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {strengthItems.length > 0 && (
        <div className="mt-8">
          <DayStrengthChecklist items={strengthItems} notes={strengthNotes} today={today} />
        </div>
      )}
      {supplemental.length > 0 && (
        <div className="mt-8">
          <SupplementalCard blocks={supplemental} />
        </div>
      )}
      <div className="mt-8">
        <PainQuickEntry todays={todaysPain} />
      </div>
    </div>
  );
}
