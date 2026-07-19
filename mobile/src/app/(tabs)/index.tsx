import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import type { PlannedSessionOut, PlanWeek } from "@engine/plan.ts";
import { Body, Display, Label, Panel, Rule, StatChip } from "@/components/ui";
import { C, type } from "@/lib/theme";
import {
  localToday,
  readAthlete,
  readPlan,
  toggleSessionDone,
  type StoredAthlete,
  type StoredPlan,
} from "@/lib/store";
import { seedDemoAthlete } from "@/lib/demo";

/** The plan week containing `today` (or the next upcoming one). */
function currentWeek(weeks: PlanWeek[], today: string): { week: PlanWeek; index: number } | null {
  for (let i = 0; i < weeks.length; i++) {
    const end = weeks[i + 1]?.weekStart ?? "9999-12-31";
    if (today >= weeks[i].weekStart && today < end) return { week: weeks[i], index: i };
  }
  if (weeks.length && today < weeks[0].weekStart) return { week: weeks[0], index: 0 };
  return null;
}

function SessionRow({ s, onToggle }: { s: PlannedSessionOut; onToggle: () => void }) {
  const done = s.status === "done";
  return (
    <View style={{ borderWidth: 1, borderColor: C.hairline, padding: 12, gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Label>{s.weekday} {s.date.slice(5)}</Label>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={done ? `Mark ${s.title} not done` : `Mark ${s.title} done`}
          onPress={onToggle}
          style={{
            borderWidth: 1,
            borderColor: done ? C.signal : C.hairline,
            backgroundColor: done ? C.signal : "transparent",
            paddingHorizontal: 10,
            paddingVertical: 5,
          }}
        >
          <Text style={[type.label, { color: done ? C.field : C.boneMuted }]}>
            {done ? "Done" : "Mark done"}
          </Text>
        </Pressable>
      </View>
      <Text style={[type.figure, { fontSize: 16, color: C.bone }]}>{s.title}</Text>
      <Label>{Math.round(s.durationHr * 60)} min · {s.tss} TSS · {s.discipline}</Label>
      {s.structure ? <Body style={{ fontSize: 13, lineHeight: 19 }}>{s.structure}</Body> : null}
      <Body style={{ fontSize: 12, lineHeight: 18, color: C.boneFaint }}>{s.why}</Body>
    </View>
  );
}

export default function TodayScreen() {
  const [athlete, setAthlete] = useState<StoredAthlete | null>(null);
  const [stored, setStored] = useState<StoredPlan | null>(null);
  const [ready, setReady] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        let a = await readAthlete();
        if (!a) a = await seedDemoAthlete();
        const p = await readPlan();
        if (alive) {
          setAthlete(a);
          setStored(p);
          setReady(true);
        }
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

  const today = localToday();
  const found = stored ? currentWeek(stored.plan.weeks, today) : null;
  const todaySessions = found ? found.week.sessions.filter((s) => s.date === today) : [];
  const upcoming = found
    ? found.week.sessions.filter((s) => s.date > today).slice(0, 3)
    : [];

  const onToggle = async (s: PlannedSessionOut) => {
    const next = await toggleSessionDone(s.date, s.title);
    if (next) setStored({ ...next });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.field }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.signal }} />
          <Display size={20}>Taper</Display>
          {athlete?.demo ? <Label style={{ color: C.signalText }}>Demo data</Label> : null}
        </View>
        <Rule />

        <Display size={34}>Today</Display>

        {found && stored ? (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 20 }}>
              <StatChip label="Fitness" value={String(Math.round(found.week.projected.ctl))} unit="CTL proj." />
              <StatChip label="Form" value={String(Math.round(found.week.projected.tsb))} unit="TSB proj." />
              <StatChip
                label="Week"
                value={`${found.index + 1}/${stored.plan.weeks.length}`}
                unit={found.week.phase}
              />
            </View>

            <Panel>
              <Label>This week</Label>
              <Body style={{ marginTop: 6 }}>
                {found.week.phase === "taper" || found.week.phase === "race"
                  ? "Race week is close. Load falls, intensity stays; trust the taper."
                  : `Target ${found.week.targetTss} TSS. ${found.week.sessions.filter((s) => s.status === "done").length}/${found.week.sessions.length} sessions done.`}
              </Body>
            </Panel>

            {todaySessions.length > 0 ? (
              <View style={{ gap: 10 }}>
                <Label>Today's session{todaySessions.length > 1 ? "s" : ""}</Label>
                {todaySessions.map((s) => (
                  <SessionRow key={s.date + s.title} s={s} onToggle={() => onToggle(s)} />
                ))}
              </View>
            ) : (
              <Panel>
                <Label>Rest day</Label>
                <Body style={{ marginTop: 6 }}>
                  Nothing scheduled today. The easy days are doing real work.
                </Body>
              </Panel>
            )}

            {upcoming.length > 0 && (
              <View style={{ gap: 10 }}>
                <Label>Up next</Label>
                {upcoming.map((s) => (
                  <SessionRow key={s.date + s.title} s={s} onToggle={() => onToggle(s)} />
                ))}
              </View>
            )}
          </>
        ) : ready ? (
          <Panel>
            <Label>No active plan</Label>
            <Body style={{ marginTop: 6 }}>
              Point Taper at a race and it drafts every week between now and the gun,
              generated on this device from {athlete?.demo ? "the demo athlete's" : "your"} training state.
            </Body>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/goal")}
              style={{ backgroundColor: C.signal, paddingVertical: 12, paddingHorizontal: 16, marginTop: 12, alignSelf: "flex-start" }}
            >
              <Text style={[type.label, { color: C.field }]}>Set a goal</Text>
            </Pressable>
          </Panel>
        ) : null}

        <Label style={{ marginTop: 8 }}>
          Plans are generated on this device · not medical advice
        </Label>
      </ScrollView>
    </SafeAreaView>
  );
}
