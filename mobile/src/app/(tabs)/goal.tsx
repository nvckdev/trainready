import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { generatePlan, type PlanRequest, type RaceType } from "@engine/plan.ts";
import { Body, Display, Label, Panel, Rule } from "@/components/ui";
import { C, FONT, type } from "@/lib/theme";
import {
  localToday,
  readAthlete,
  writePlan,
  zonesFor,
  type StoredAthlete,
} from "@/lib/store";
import { seedDemoAthlete } from "@/lib/demo";

const RACE_TYPES: Array<{ v: RaceType; label: string }> = [
  { v: "run-5k", label: "5K" },
  { v: "run-10k", label: "10K" },
  { v: "run-half", label: "Half" },
  { v: "run-marathon", label: "Marathon" },
];

const field = {
  borderWidth: 1,
  borderColor: C.hairline,
  backgroundColor: C.fieldSunken,
  color: C.bone,
  fontFamily: FONT.mono,
  fontSize: 14,
  paddingHorizontal: 12,
  paddingVertical: 10,
} as const;

function addDays(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
  const [busy, setBusy] = useState(false);

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

  const generate = async () => {
    setError(null);
    // Same validation discipline as the dashboard action: a malformed date must
    // never reach the engine or overwrite a stored plan.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) {
      setError("Race date must be YYYY-MM-DD.");
      return;
    }
    if (raceDate < addDays(localToday(), 21)) {
      setError("Pick a race at least 3 weeks out — a taper needs runway.");
      return;
    }
    if (!athlete) return;
    setBusy(true);
    try {
      const request: PlanRequest = {
        raceName: raceName.trim() || "A race",
        raceDate,
        raceType,
        daysPerWeek,
        longDay,
        startDate: localToday(),
        goalTime: goalTime.trim() || undefined,
      };
      // The real engine, on this device: same code, same rails, same honesty
      // as the dashboard. Empty history ⇒ the physiology reference schedule
      // (the learned layer states it is warming up in each week's rationale).
      const plan = generatePlan(request, athlete.seed, [], zonesFor(athlete));
      await writePlan({ request, plan });
      router.push("/plan");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Plan generation failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.field }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 14 }}>
        <Label>New goal</Label>
        <Display size={28}>Aim at a race</Display>
        <Body>
          Every week between now and the gun, drafted on this device from{" "}
          {athlete?.demo ? "the demo athlete's training state" : "your training state"}. Every
          session states its why.
        </Body>
        <Rule />

        {error && (
          <Panel style={{ borderColor: C.signal }}>
            <Body style={{ color: C.signalText }}>{error}</Body>
          </Panel>
        )}

        <View style={{ gap: 6 }}>
          <Label>Race name</Label>
          <TextInput
            style={field}
            value={raceName}
            onChangeText={setRaceName}
            placeholder="Harbourfront Half"
            placeholderTextColor={C.boneFaint}
          />
        </View>

        <View style={{ gap: 6 }}>
          <Label>Race date (YYYY-MM-DD)</Label>
          <TextInput
            style={field}
            value={raceDate}
            onChangeText={setRaceDate}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="2026-10-18"
            placeholderTextColor={C.boneFaint}
          />
        </View>

        <View style={{ gap: 6 }}>
          <Label>Distance</Label>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {RACE_TYPES.map((rt) => (
              <Pressable
                key={rt.v}
                accessibilityRole="button"
                onPress={() => setRaceType(rt.v)}
                style={{
                  borderWidth: 1,
                  borderColor: raceType === rt.v ? C.signal : C.hairline,
                  backgroundColor: raceType === rt.v ? C.signal : "transparent",
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                }}
              >
                <Text style={[type.label, { color: raceType === rt.v ? C.field : C.boneMuted }]}>
                  {rt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <Label>Run days per week · {daysPerWeek}</Label>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[4, 5, 6, 7].map((n) => (
              <Pressable
                key={n}
                accessibilityRole="button"
                onPress={() => setDaysPerWeek(n)}
                style={{
                  borderWidth: 1,
                  borderColor: daysPerWeek === n ? C.signal : C.hairline,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                }}
              >
                <Text style={[type.figure, { fontSize: 14, color: daysPerWeek === n ? C.signalText : C.boneMuted }]}>
                  {n}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <Label>Long-run day</Label>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["saturday", "sunday"] as const).map((d) => (
              <Pressable
                key={d}
                accessibilityRole="button"
                onPress={() => setLongDay(d)}
                style={{
                  borderWidth: 1,
                  borderColor: longDay === d ? C.signal : C.hairline,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                }}
              >
                <Text style={[type.label, { color: longDay === d ? C.signalText : C.boneMuted }]}>{d}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <Label>Goal time (optional, H:MM:SS)</Label>
          <TextInput
            style={field}
            value={goalTime}
            onChangeText={setGoalTime}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="1:45:00"
            placeholderTextColor={C.boneFaint}
          />
          <Body style={{ fontSize: 12, color: C.boneFaint }}>
            If the goal is out of reach, the plan says so and projects the honest finish.
          </Body>
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={generate}
          style={{
            backgroundColor: C.signal,
            opacity: busy ? 0.6 : 1,
            paddingVertical: 14,
            alignItems: "center",
            marginTop: 6,
          }}
        >
          <Text style={[type.label, { color: C.field }]}>
            {busy ? "Drafting the season…" : "Generate the plan"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
