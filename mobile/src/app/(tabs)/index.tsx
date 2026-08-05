import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import type { PlannedSessionOut, PlanWeek } from "@engine/plan.ts";
import { Body, Button, Display, Label, RecDot, SpecRow, TaperMark } from "@/components/ui";
import { C, type } from "@/lib/theme";
import { currentWeekIndex, toggleSessionDone, useAthlete, usePlan, useToday, useWeeklyReconcile } from "@/lib/store";
import { tapLight, tapSuccess } from "@/lib/haptics";
import { seedDemoAthlete } from "@/lib/demo";
import { readinessFor, recordReadiness } from "@/lib/readiness-store";
import type { ReadinessEntry, ReadinessLevel } from "@engine/readiness.ts";
import { painAlerts, painFor, recordPain } from "@/lib/pain-store";
import { declare as declareTissue, readTissue, resolve as resolveTissue, type TissueRead } from "@/lib/tissue-store";
import {
  PAIN_CONTEXT_LABEL,
  PAIN_CONTEXTS,
  PAIN_REGION_LABEL,
  PAIN_REGIONS,
  type PainAlert,
  type PainContext,
  type PainEntry,
  type PainRegion,
} from "@engine/pain.ts";
import {
  TISSUE_PROVOCATION_LABEL,
  TISSUE_PROVOCATIONS,
  TISSUE_SITE_LABEL,
  TISSUE_SITES,
  TISSUE_STATUS_LABEL,
  TISSUE_STATUSES,
} from "@engine/tissue-declare.ts";
import { deriveTissueCaps, tissueCapSummary, tissueReason, type TissueProvocation, type TissueSite, type TissueStatus } from "@engine/tissue.ts";

/** 0–10 as tappable chips rather than a slider or keypad: this is filled in
 *  outdoors, one-handed, often in the cold. */
const SCORES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"] as const;

const READINESS: Array<{ level: ReadinessLevel; label: string }> = [
  { level: "rough", label: "ROUGH" },
  { level: "ok", label: "OK" },
  { level: "good", label: "GOOD" },
];

/**
 * Morning check-in. One tap, placement only: the engine may move today's hard
 * session later (rough) or pull a later one forward (good), and may change
 * nothing else — the week's load is identical either way, which is what the
 * copy promises and what engine/readiness.ts guarantees.
 */
function ReadinessCheckIn({ today }: { today: string }) {
  const [entry, setEntry] = useState<ReadinessEntry | null | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void readinessFor(today).then((e) => {
      if (live) setEntry(e);
    });
    return () => {
      live = false;
    };
  }, [today]);

  const answer = async (level: ReadinessLevel) => {
    tapLight();
    const r = await recordReadiness(level, today);
    setEntry(r.entry);
    setNote(r.note);
  };

  // Undefined while the log loads: render nothing rather than flash an
  // unanswered state at someone who already answered.
  if (entry === undefined) return null;

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
      <Label style={{ color: C.boneFaint }}>HOW DID YOU WAKE UP?</Label>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        {READINESS.map((r) => {
          const on = entry?.level === r.level;
          return (
            <Pressable
              key={r.level}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Readiness ${r.label.toLowerCase()}`}
              onPress={() => void answer(r.level)}
              style={{
                flex: 1,
                paddingVertical: 10,
                alignItems: "center",
                borderWidth: 1,
                borderColor: on ? C.signalText : C.hairline,
                backgroundColor: on ? C.fieldRaised : "transparent",
              }}
            >
              <Label style={{ fontSize: 10, color: on ? C.signalText : C.boneMuted }}>{r.label}</Label>
            </Pressable>
          );
        })}
      </View>
      {(note ?? entry?.swap?.note) && (
        <Body style={{ fontSize: 12.5, lineHeight: 18, marginTop: 8 }}>{note ?? entry?.swap?.note}</Body>
      )}
      {entry && !entry.swap && (
        <Body style={{ fontSize: 12.5, lineHeight: 18, marginTop: 8 }}>
          Logged. Today&apos;s session stands as planned.
        </Body>
      )}
    </View>
  );
}

/** A row of choices that reads as one control. Used for every pain and
 *  declaration field so the whole surface is thumb-sized and needs no
 *  keyboard — this gets used standing outside after a run. */
function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  labelFor,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labelFor: (v: T) => string;
}) {
  return (
    <View style={{ marginTop: 12 }}>
      <Label style={{ color: C.boneFaint, fontSize: 10 }}>{label}</Label>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
        {options.map((o) => {
          const on = o === value;
          return (
            <Pressable
              key={o}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={labelFor(o)}
              onPress={() => {
                tapLight();
                onChange(o);
              }}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderWidth: 1,
                borderColor: on ? C.signalText : C.hairline,
                backgroundColor: on ? C.fieldRaised : "transparent",
              }}
            >
              <Label style={{ fontSize: 10, color: on ? C.signalText : C.boneMuted }}>{labelFor(o)}</Label>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Pain check-in and injury declarations — the phone's daily health input,
 * sitting with the readiness tap as one surface.
 *
 * Offline by construction: everything here writes to on-device storage, which
 * is the only way a daily input survives the moment it is actually used —
 * standing outside after a run, often with no signal.
 *
 * The model, the three alert rules and the declaration validation are all
 * engine/ modules shared with the dashboard. Nothing about "is this athlete
 * injured" is decided here; this screen only collects and renders it.
 */
function HealthCheckIn({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  const [todays, setTodays] = useState<PainEntry[]>([]);
  const [alerts, setAlerts] = useState<PainAlert[]>([]);
  const [tissue, setTissue] = useState<TissueRead | null>(null);

  const [region, setRegion] = useState<PainRegion>(PAIN_REGIONS[0]);
  const [score, setScore] = useState(0);
  const [context, setContext] = useState<PainContext>("after-session");

  const [declaring, setDeclaring] = useState(false);
  const [site, setSite] = useState<TissueSite>("calf");
  const [status, setStatus] = useState<TissueStatus>("niggle");
  const [provocation, setProvocation] = useState<TissueProvocation>("volume");

  useEffect(() => {
    let live = true;
    void Promise.all([painFor(today), readTissue(today), painAlerts(today)]).then(([p, t, a]) => {
      if (!live) return;
      setTodays(p);
      setTissue(t);
      setAlerts(a);
    });
    return () => {
      live = false;
    };
  }, [today]);

  const log = async () => {
    tapSuccess();
    const r = await recordPain(region, score, context, today);
    setTodays(r.entries);
    setAlerts(r.alerts);
  };

  // The caps an athlete is about to agree to, shown BEFORE the button that
  // applies them — the same promise the dashboard card makes.
  const preview = tissueCapSummary({ site, status, provocation, caps: deriveTissueCaps(status, provocation) });

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? "Hide pain check-in" : "Open pain check-in"}
        onPress={() => {
          tapLight();
          setOpen((v) => !v);
        }}
        style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
      >
        <Label style={{ color: C.boneFaint }}>ANYTHING HURT?</Label>
        <Label style={{ color: C.boneMuted, fontSize: 10 }}>{open ? "CLOSE" : todays.length > 0 ? "LOGGED" : "LOG"}</Label>
      </Pressable>

      {alerts.length > 0 && (
        <View style={{ marginTop: 8, borderLeftWidth: 2, borderLeftColor: C.signalText, paddingLeft: 10 }}>
          {alerts.map((a) => (
            <Body key={a.region + a.rule} style={{ fontSize: 12.5, lineHeight: 18, color: C.signalText }}>
              {a.detail}
            </Body>
          ))}
          <Body style={{ fontSize: 12, lineHeight: 17, color: C.boneMuted, marginTop: 4 }}>
            Consider easing the next quality session. Nothing here changes your plan by itself.
          </Body>
        </View>
      )}

      {tissue?.status === "unreadable" && (
        <Body style={{ fontSize: 12.5, lineHeight: 18, color: C.signalText, marginTop: 8 }}>
          Your injury limits could not be read, so the plan will not re-plan without them. Re-declare below.
        </Body>
      )}

      {tissue && tissue.active.length > 0 && (
        <View style={{ marginTop: 10 }}>
          {tissue.constraints.map((c) => (
            <View key={c.site} style={{ marginTop: 6 }}>
              <Label style={{ fontSize: 10 }}>{TISSUE_SITE_LABEL[c.site]}</Label>
              <Body style={{ fontSize: 12, lineHeight: 17, color: C.boneMuted }}>{tissueReason(c)}</Body>
              <Body style={{ fontSize: 12, lineHeight: 17, color: C.boneMuted }}>Caps: {tissueCapSummary(c)}</Body>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Mark ${TISSUE_SITE_LABEL[c.site]} resolved`}
                onPress={() => {
                  tapSuccess();
                  void resolveTissue(c.site, today).then(setTissue);
                }}
                style={{ marginTop: 6, alignSelf: "flex-start", borderWidth: 1, borderColor: C.hairline, paddingVertical: 7, paddingHorizontal: 12 }}
              >
                <Label style={{ fontSize: 10, color: C.boneMuted }}>RESOLVED</Label>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {open && (
        <View style={{ marginTop: 4 }}>
          <Choice label="WHERE" options={PAIN_REGIONS} value={region} onChange={setRegion} labelFor={(r) => PAIN_REGION_LABEL[r]} />
          <Choice
            label="HOW MUCH · 0–10"
            options={SCORES}
            value={String(score) as (typeof SCORES)[number]}
            onChange={(v) => setScore(Number(v))}
            labelFor={(v) => v}
          />
          <Choice label="WHEN" options={PAIN_CONTEXTS} value={context} onChange={setContext} labelFor={(c) => PAIN_CONTEXT_LABEL[c]} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Log pain reading"
            onPress={() => void log()}
            style={{ marginTop: 12, borderWidth: 1, borderColor: C.signalText, paddingVertical: 11, alignItems: "center" }}
          >
            <Label style={{ fontSize: 10, color: C.signalText }}>LOG</Label>
          </Pressable>
          {todays.length > 0 && (
            <Body style={{ fontSize: 12, lineHeight: 17, color: C.boneMuted, marginTop: 8 }}>
              {todays.map((e) => `${PAIN_REGION_LABEL[e.region]} ${e.score0to10}/10 · ${PAIN_CONTEXT_LABEL[e.context].toLowerCase()}`).join("  ·  ")}
            </Body>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={declaring ? "Hide injury declaration" : "Declare an injury"}
            onPress={() => {
              tapLight();
              setDeclaring((v) => !v);
            }}
            style={{ marginTop: 16 }}
          >
            <Label style={{ color: C.boneFaint, fontSize: 10 }}>
              {declaring ? "CLOSE DECLARATION" : "DECLARE AN INJURY \u2192"}
            </Label>
          </Pressable>

          {declaring && (
            <View>
              <Choice label="WHERE" options={TISSUE_SITES} value={site} onChange={setSite} labelFor={(x) => TISSUE_SITE_LABEL[x]} />
              <Choice label="HOW BAD" options={TISSUE_STATUSES} value={status} onChange={setStatus} labelFor={(x) => TISSUE_STATUS_LABEL[x].split(" \u2014 ")[0]} />
              <Choice label="WHAT SETS IT OFF" options={TISSUE_PROVOCATIONS} value={provocation} onChange={setProvocation} labelFor={(x) => TISSUE_PROVOCATION_LABEL[x].split(" \u2014 ")[0]} />
              <Body style={{ fontSize: 12, lineHeight: 17, color: C.boneMuted, marginTop: 10 }}>
                This will cap your training: {preview}.
              </Body>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Declare this injury"
                onPress={() => {
                  tapSuccess();
                  void declareTissue(site, status, provocation, undefined, today).then((t) => {
                    setTissue(t);
                    setDeclaring(false);
                  });
                }}
                style={{ marginTop: 10, borderWidth: 1, borderColor: C.signalText, paddingVertical: 11, alignItems: "center" }}
              >
                <Label style={{ fontSize: 10, color: C.signalText }}>DECLARE</Label>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function openSession(s: PlannedSessionOut): void {
  router.push({ pathname: "/session", params: { date: s.date, title: s.title } });
}

/** The plan week containing `today` (or the next upcoming one). */
function currentWeek(weeks: PlanWeek[], today: string): { week: PlanWeek; index: number } | null {
  const i = currentWeekIndex(weeks, today);
  if (i >= 0) return { week: weeks[i], index: i };
  if (weeks.length && today < weeks[0].weekStart) return { week: weeks[0], index: 0 };
  return null;
}

/** "FRI 18 JUL" from a YYYY-MM-DD date. */
function heroDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  const day = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const num = d.getUTCDate();
  const mon = d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return `${day} ${num} ${mon}`.toUpperCase();
}

/** Parse the engine's structure text into spec-sheet rows (WARMUP / MAIN / …). */
function specRows(structure: string): Array<{ label: string; text: string }> {
  return structure
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(WARMUP|MAIN|COOLDOWN|STRIDES|RECOVERY|SET)\s*(.*)$/i);
      return m ? { label: m[1].toUpperCase(), text: m[2] || line } : { label: "", text: line };
    });
}

function UpcomingRow({ s, last }: { s: PlannedSessionOut; last: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${s.weekday} ${s.title}, open session report`}
      onPress={() => openSession(s)}
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: C.hairline,
        borderBottomWidth: last ? 1 : 0,
        borderBottomColor: C.hairline,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, flex: 1 }}>
        <Label style={{ fontSize: 10 }}>{s.weekday.toUpperCase()}</Label>
        <Text style={[type.body, { fontSize: 15, color: C.bone }]} numberOfLines={1}>
          {s.title}
        </Text>
      </View>
      <Text style={[type.figure, { fontSize: 11, color: C.boneFaint }]}>
        {Math.round(s.durationHr * 60)} MIN · {s.tss} TSS
      </Text>
    </Pressable>
  );
}

export default function TodayScreen() {
  useWeeklyReconcile();
  const athlete = useAthlete();
  const stored = usePlan();
  const { width } = useWindowDimensions();
  const markW = Math.min(width - 40, 420);

  // First launch: seed the demo athlete once hydration proves none exists.
  useEffect(() => {
    if (athlete === null) void seedDemoAthlete();
  }, [athlete]);

  const ready = athlete !== undefined && stored !== undefined;
  const today = useToday();
  const raceDate = stored?.request.raceDate;
  const raceDay = !!raceDate && today === raceDate;
  const finished = !!raceDate && today > raceDate;

  const found = stored && !finished ? currentWeek(stored.plan.weeks, today) : null;
  const todaySessions = found ? found.week.sessions.filter((s) => s.date === today) : [];
  const upcoming = stored
    ? stored.plan.weeks
        .flatMap((w) => w.sessions)
        .filter((s) => s.date > today)
        .slice(0, 3)
    : [];
  const doneCount = found ? found.week.sessions.filter((s) => s.status === "done").length : 0;

  const onToggle = (s: PlannedSessionOut) => {
    if (s.status === "done") tapLight();
    else tapSuccess();
    toggleSessionDone(s.date, s.title);
  };

  const header = (
    <View style={{ paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Display size={20}>Taper</Display>
        <RecDot />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        onPress={() => router.push("/settings")}
        hitSlop={8}
        style={{ borderWidth: 1, borderColor: C.hairline, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}
      >
        <Label style={{ fontSize: 10 }}>{athlete?.demo ? "DEMO DATA" : "SETTINGS"}</Label>
      </Pressable>
    </View>
  );

  const footer = (
    <Label style={{ fontSize: 10, textAlign: "center", padding: 20 }}>
      PLANS ARE GENERATED ON THIS DEVICE · NOT MEDICAL ADVICE
    </Label>
  );

  // ——— hydrating: hold the field, no half-rendered layout ————————————————
  if (!ready) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: C.field }} edges={["top"]} />;
  }

  // ——— race morning: the plan's last word ————————————————————————————————
  if (raceDay) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.field }} edges={["top"]}>
        {header}
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
            <Display size={40}>{heroDate(today)}</Display>
            <View style={{ marginTop: 10 }}>
              <TaperMark width={markW} />
            </View>
          </View>
          <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 32, alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <RecDot size={6} />
              <Label style={{ color: C.signalText }}>RACE DAY</Label>
            </View>
            <Display size={30} style={{ marginTop: 12, textAlign: "center" }}>
              {stored!.plan.meta.raceName}
            </Display>
            <Body style={{ marginTop: 14, textAlign: "center" }}>
              The work is banked. Trust the taper.
            </Body>
          </View>
          {footer}
        </View>
      </SafeAreaView>
    );
  }

  // ——— after the race: close the season, invite the next ——————————————————
  if (finished) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.field }} edges={["top"]}>
        {header}
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
            <Display size={40}>{heroDate(today)}</Display>
            <View style={{ marginTop: 10 }}>
              <TaperMark width={markW} muted />
            </View>
          </View>
          <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 32, alignItems: "center" }}>
            <Label>SEASON COMPLETE</Label>
            <Display size={30} style={{ marginTop: 12, textAlign: "center" }}>
              {stored!.plan.meta.raceName} is in the books
            </Display>
            <Body style={{ marginTop: 14, textAlign: "center" }}>
              Recover first. When you're ready, the next block starts from a new goal.
            </Body>
            <View style={{ marginTop: 26, alignSelf: "stretch" }}>
              <Button label="SET THE NEXT GOAL" variant="secondary" onPress={() => router.push("/goal")} />
            </View>
          </View>
          {footer}
        </View>
      </SafeAreaView>
    );
  }

  // ——— rest day / no plan: centered composition ————————————————————————
  if (!found || todaySessions.length === 0) {
    const next = upcoming[0];
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.field }} edges={["top"]}>
        {header}
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
            <Display size={40}>{heroDate(today)}</Display>
            <View style={{ marginTop: 10 }}>
              <TaperMark width={markW} muted={!found} />
            </View>
          </View>
          <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 32, alignItems: "center" }}>
            {found ? (
              <>
                <Label>REST DAY</Label>
                <Display size={30} style={{ marginTop: 12, textAlign: "center" }}>
                  Nothing scheduled today
                </Display>
                <Body style={{ marginTop: 14, textAlign: "center" }}>
                  The easy days are doing real work.
                </Body>
                {next && (
                  <>
                    <View style={{ width: 120, borderTopWidth: 1, borderTopColor: C.hairline, marginTop: 26 }} />
                    <Text style={[type.figure, { fontSize: 11, color: C.boneFaint, marginTop: 12 }]}>
                      NEXT: {next.weekday.toUpperCase()} · {next.title.toUpperCase()} ·{" "}
                      {Math.round(next.durationHr * 60)} MIN
                    </Text>
                  </>
                )}
              </>
            ) : (
              <>
                <Display size={30} style={{ textAlign: "center" }}>No active plan</Display>
                <Body style={{ marginTop: 12, textAlign: "center" }}>
                  Set a race and the engine drafts a season around it, on this device.
                </Body>
                <View style={{ marginTop: 26, alignSelf: "stretch" }}>
                  <Button label="SET A RACE GOAL" variant="secondary" onPress={() => router.push("/goal")} />
                </View>
              </>
            )}
          </View>
          {/* A rest day is exactly when something hurts enough to be resting,
              so the health check-in belongs here too — a daily input that
              disappears on rest days is not a daily input. Readiness stays on
              session days only: it reorders sessions, and there are none. */}
          {found && <HealthCheckIn today={today} />}
          {footer}
        </View>
      </SafeAreaView>
    );
  }

  const hero = todaySessions[0];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.field }} edges={["top"]}>
      {header}
      <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
          <Display size={40}>{heroDate(today)}</Display>
          <View style={{ marginTop: 10 }}>
            <TaperMark width={markW} />
          </View>
        </View>

        {found && (
          <>
            <View style={{ flexDirection: "row", paddingHorizontal: 20, paddingTop: 16 }}>
              {[
                { v: String(Math.round(found.week.projected.ctl)), l: "FITNESS CTL" },
                { v: String(Math.round(found.week.projected.tsb)), l: "FORM TSB" },
              ].map((it, i) => (
                <View key={it.l} style={{ flexDirection: "row", flex: 1 }}>
                  {i > 0 && <View style={{ width: 1, backgroundColor: C.hairline, marginRight: 16 }} />}
                  <View style={{ flex: 1 }}>
                    <Text style={[type.figure, { fontSize: 22 }]}>{it.v}</Text>
                    <Label style={{ marginTop: 2 }}>{it.l}</Label>
                  </View>
                </View>
              ))}
              <View style={{ width: 1, backgroundColor: C.hairline, marginRight: 16 }} />
              <View style={{ flex: 1 }}>
                <Text style={[type.figure, { fontSize: 22 }]}>
                  {found.index + 1}
                  <Text style={{ color: C.boneFaint }}>/{stored!.plan.weeks.length}</Text>
                </Text>
                <Label style={{ marginTop: 2 }}>WEEK · {found.week.phase.toUpperCase()}</Label>
              </View>
            </View>

            <View
              style={{
                marginHorizontal: 20,
                marginTop: 18,
                borderTopWidth: 1,
                borderTopColor: C.hairline,
                paddingTop: 10,
              }}
            >
              <Text style={[type.figure, { fontSize: 12, color: C.boneMuted }]}>
                TARGET {found.week.targetTss} TSS · {doneCount}/{found.week.sessions.length} SESSIONS DONE
              </Text>
            </View>
          </>
        )}

        <ReadinessCheckIn today={today} />
        <HealthCheckIn today={today} />

        {hero && (
          <View style={{ marginHorizontal: 20, marginTop: 16, backgroundColor: C.fieldRaised, borderRadius: 22, padding: 20 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open session report for ${hero.title}`}
              onPress={() => openSession(hero)}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Label style={{ color: C.signalText }}>TODAY · {hero.discipline.toUpperCase()}</Label>
                <Text style={[type.figure, { fontSize: 11, color: C.boneFaint }]}>
                  {Math.round(hero.durationHr * 60)} MIN · {hero.tss} TSS
                </Text>
              </View>
              <Display size={30} style={{ marginTop: 10 }}>{hero.title}</Display>
            </Pressable>
            {hero.workout && hero.structure ? (
              <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: C.hairline }}>
                {specRows(hero.structure).map((r, i, arr) => (
                  <SpecRow key={i} label={r.label} text={r.text} last={i === arr.length - 1} />
                ))}
              </View>
            ) : null}
            <Body style={{ fontSize: 13, lineHeight: 19, marginTop: 14 }}>{hero.why}</Body>
            <View style={{ marginTop: 16 }}>
              <Button
                label={hero.status === "done" ? `✓ DONE · ${hero.tss} TSS LOGGED` : "MARK DONE"}
                variant={hero.status === "done" ? "done" : "primary"}
                onPress={() => onToggle(hero)}
              />
            </View>
          </View>
        )}

        {upcoming.length > 0 && (
          <>
            <Label style={{ marginHorizontal: 20, marginTop: 22 }}>UPCOMING</Label>
            <View style={{ marginHorizontal: 20, marginTop: 8 }}>
              {upcoming.map((s, i) => (
                <UpcomingRow key={s.date + s.title} s={s} last={i === upcoming.length - 1} />
              ))}
            </View>
          </>
        )}
        {footer}
      </ScrollView>
    </SafeAreaView>
  );
}
