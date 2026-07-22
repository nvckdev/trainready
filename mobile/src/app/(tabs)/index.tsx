import { useEffect } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import type { PlannedSessionOut, PlanWeek } from "@engine/plan.ts";
import { Body, Button, Display, Label, RecDot, SpecRow, TaperMark } from "@/components/ui";
import { C, type } from "@/lib/theme";
import { currentWeekIndex, toggleSessionDone, useAthlete, usePlan, useToday, useWeeklyReconcile } from "@/lib/store";
import { tapLight, tapSuccess } from "@/lib/haptics";
import { seedDemoAthlete } from "@/lib/demo";

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
