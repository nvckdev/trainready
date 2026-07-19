import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { generatePlan, type PlanRequest, type RaceType } from "@engine/plan.ts";
import { DateSheet, fmtLong } from "@/components/calendar";
import { Body, Button, Display, Label, RecDot, TaperMark, useReduceMotion } from "@/components/ui";
import { C, FONT, type } from "@/lib/theme";
import { localToday, readAthlete, writePlan, zonesFor, type StoredAthlete } from "@/lib/store";
import { seedDemoAthlete } from "@/lib/demo";

const RACE_TYPES: Array<{ v: RaceType; label: string }> = [
  { v: "run-5k", label: "5K" },
  { v: "run-10k", label: "10K" },
  { v: "run-half", label: "HALF" },
  { v: "run-marathon", label: "MARA" },
];

function addDays(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weeksOut(raceDate: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) return null;
  const ms = Date.parse(raceDate + "T12:00:00Z") - Date.parse(today + "T12:00:00Z");
  return Math.round(ms / (7 * 86400000));
}

/** Selection chip: signal border + sunken bed + dot when selected. */
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flex: 1,
        height: 44,
        borderWidth: 1,
        borderColor: selected ? C.signal : C.hairline,
        backgroundColor: selected ? C.fieldSunken : "transparent",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 6,
      }}
    >
      {selected && <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.signal }} />}
      <Text style={[type.figure, { fontSize: 12, color: selected ? C.signalText : C.boneMuted }]}>{label}</Text>
    </Pressable>
  );
}

/** The one theatrical beat: rules extend, the session counter ticks, then the
 *  finished plan appears. Reduced motion jumps straight to the result. */
function GeneratingScreen({ sessionCount, weekCount }: { sessionCount: number; weekCount: number }) {
  const reduce = useReduceMotion();
  const [counter, setCounter] = useState(reduce ? sessionCount : 0);
  const bars = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  const { width } = useWindowDimensions();

  useEffect(() => {
    if (reduce) {
      setCounter(sessionCount);
      bars.forEach((b) => b.setValue(1));
      return;
    }
    const t0 = Date.now();
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / 1400);
      const e = 1 - Math.pow(1 - p, 3);
      setCounter(Math.round(sessionCount * e));
      if (p >= 1) clearInterval(id);
    }, 40);
    bars.forEach((b, i) => {
      Animated.timing(b, {
        toValue: 1,
        duration: 900 + i * 150,
        delay: i * 400,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }).start();
    });
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, sessionCount]);

  const steps = [
    "PERIODIZING BASE → BUILD → TAPER",
    "FITTING INTENSITY DISTRIBUTION",
    "CHECKING GOAL AGAINST PROJECTED LOAD",
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.field, justifyContent: "center", paddingHorizontal: 32 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <RecDot size={6} />
        <Label style={{ color: C.signalText }}>DRAFTING SEASON</Label>
      </View>
      <Display size={34} style={{ marginTop: 14 }}>
        {weekCount} weeks,{"\n"}drawn once
      </Display>
      <View style={{ marginTop: 28, gap: 14 }}>
        {steps.map((s, i) => (
          <View key={s}>
            <Label style={{ fontSize: 9, marginBottom: 5 }}>{s}</Label>
            <View style={{ height: 2, backgroundColor: C.fieldSunken, overflow: "hidden" }}>
              <Animated.View
                style={{
                  height: 2,
                  backgroundColor: i === 2 ? C.signal : C.bone,
                  transform: [{ scaleX: bars[i] }, { translateX: 0 }],
                  width: "100%",
                  // scale from the left edge
                  transformOrigin: "left",
                }}
              />
            </View>
          </View>
        ))}
      </View>
      <Text style={[type.figure, { fontSize: 20, marginTop: 32 }]}>
        {counter}
        <Text style={{ fontSize: 11, color: C.boneFaint }}> SESSIONS PLACED</Text>
      </Text>
      <View style={{ marginTop: 26 }}>
        <TaperMark width={Math.min(width - 64, 300)} />
      </View>
      <Body style={{ fontSize: 12, marginTop: 14 }}>Runs on this device. Nothing leaves it.</Body>
    </View>
  );
}

export default function GoalScreen() {
  const [athlete, setAthlete] = useState<StoredAthlete | null>(null);
  const [raceName, setRaceName] = useState("");
  const [raceDate, setRaceDate] = useState(addDays(localToday(), 112));
  const [raceType, setRaceType] = useState<RaceType>("run-half");
  const [daysPerWeek, setDaysPerWeek] = useState(5);
  const [longDay, setLongDay] = useState<"saturday" | "sunday">("sunday");
  const [goalTime, setGoalTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pickingDate, setPickingDate] = useState(false);
  const [generating, setGenerating] = useState<{ sessions: number; weeks: number } | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      readAthlete().then(async (a) => {
        const resolved = a ?? (await seedDemoAthlete());
        if (alive) setAthlete(resolved);
      });
      return () => {
        alive = false;
      };
    }, [])
  );

  const today = localToday();
  const wk = weeksOut(raceDate, today);
  const dateInvalid = wk === null || raceDate < addDays(today, 21);
  const dateError = wk === null ? "Race date must be YYYY-MM-DD." : dateInvalid ? "Pick a race at least 3 weeks out. A taper needs runway." : null;

  const generate = async () => {
    setError(null);
    if (dateInvalid || !athlete) return;
    try {
      const request: PlanRequest = {
        raceName: raceName.trim() || "A race",
        raceDate,
        raceType,
        daysPerWeek,
        longDay,
        startDate: today,
        goalTime: goalTime.trim() || undefined,
      };
      // The real engine, on this device — same code, same rails, same honesty
      // as the dashboard. Then the drafting moment plays before the reveal.
      const plan = generatePlan(request, athlete.seed, [], zonesFor(athlete));
      await writePlan({ request, plan });
      const sessions = plan.weeks.reduce((a, w) => a + w.sessions.length, 0);
      setGenerating({ sessions, weeks: plan.weeks.length });
      setTimeout(() => {
        setGenerating(null);
        router.push("/plan");
      }, 1700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Plan generation failed.");
    }
  };

  if (generating) {
    return <GeneratingScreen sessionCount={generating.sessions} weekCount={generating.weeks} />;
  }

  /** The sunken bed shared by inputs and the tappable date readout. */
  const fieldBox = (err: boolean) =>
    ({
      height: 48,
      backgroundColor: C.fieldSunken,
      borderWidth: 1,
      borderColor: err ? C.signal : C.hairline,
      paddingHorizontal: 14,
    }) as const;

  const fieldStyle = (err: boolean) =>
    ({ ...fieldBox(err), color: C.bone, fontFamily: FONT.body, fontSize: 15 }) as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.field }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <Label>RACE INTAKE</Label>
          <Display size={44} style={{ marginTop: 6 }}>Goal</Display>
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 22, gap: 20 }}>
          {error && (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.signal, marginTop: 5 }} />
              <Body style={{ fontSize: 13, lineHeight: 19, color: C.signalText, flex: 1 }}>{error}</Body>
            </View>
          )}

          <View>
            <Label style={{ marginBottom: 8 }}>RACE NAME</Label>
            <TextInput
              style={fieldStyle(false)}
              value={raceName}
              onChangeText={setRaceName}
              placeholder="Valley Half Marathon"
              placeholderTextColor={C.boneFaint}
            />
          </View>

          <View>
            <Label style={{ marginBottom: 8, color: dateError ? C.signalText : C.boneFaint }}>RACE DATE</Label>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Race date, ${fmtLong(raceDate)}. Opens calendar.`}
              onPress={() => setPickingDate(true)}
              style={[
                fieldBox(!!dateError),
                { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
              ]}
            >
              <Text style={[type.figure, { fontSize: 14 }]}>{fmtLong(raceDate)}</Text>
              {wk !== null && (
                <Label style={{ fontSize: 10, color: dateError ? C.signalText : C.boneFaint }}>
                  {wk} WK OUT
                </Label>
              )}
            </Pressable>
            {dateError && (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "flex-start" }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.signal, marginTop: 5 }} />
                <Body style={{ fontSize: 13, lineHeight: 19, color: C.signalText, flex: 1 }}>{dateError}</Body>
              </View>
            )}
          </View>

          <View>
            <Label style={{ marginBottom: 8 }}>DISTANCE</Label>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {RACE_TYPES.map((rt) => (
                <Chip key={rt.v} label={rt.label} selected={raceType === rt.v} onPress={() => setRaceType(rt.v)} />
              ))}
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 16 }}>
            <View style={{ flex: 1 }}>
              <Label style={{ marginBottom: 8 }}>RUN DAYS / WK</Label>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {[4, 5, 6, 7].map((n) => (
                  <Chip key={n} label={String(n)} selected={daysPerWeek === n} onPress={() => setDaysPerWeek(n)} />
                ))}
              </View>
            </View>
            <View style={{ width: 130 }}>
              <Label style={{ marginBottom: 8 }}>LONG-RUN DAY</Label>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {(["saturday", "sunday"] as const).map((d) => (
                  <Chip
                    key={d}
                    label={d.slice(0, 3).toUpperCase()}
                    selected={longDay === d}
                    onPress={() => setLongDay(d)}
                  />
                ))}
              </View>
            </View>
          </View>

          <View>
            <Label style={{ marginBottom: 8 }}>GOAL TIME · OPTIONAL</Label>
            <TextInput
              style={[fieldStyle(false), { fontFamily: FONT.mono, fontSize: 16 }]}
              value={goalTime}
              onChangeText={setGoalTime}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="1:45:00"
              placeholderTextColor={C.boneFaint}
            />
            <Body style={{ fontSize: 12, lineHeight: 18, marginTop: 8 }}>
              If the goal is out of reach, the plan says so and projects the honest finish.
            </Body>
          </View>
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: 20, paddingBottom: 14 }}>
        <Button label="GENERATE THE PLAN" height={52} disabled={dateInvalid} onPress={generate} />
      </View>
      {pickingDate && (
        <DateSheet
          value={raceDate}
          minDate={addDays(today, 21)}
          today={today}
          onCancel={() => setPickingDate(false)}
          onConfirm={(d) => {
            setRaceDate(d);
            setPickingDate(false);
          }}
        />
      )}
    </SafeAreaView>
  );
}
