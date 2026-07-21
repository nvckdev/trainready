import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Body, Button, Display, Label } from "@/components/ui";
import { C, FONT, R, type } from "@/lib/theme";
import { setAthlete, setPlan, useAthlete, usePlan } from "@/lib/store";
import { tapLight, tapSuccess } from "@/lib/haptics";

/**
 * Settings — the exit from demo data. Thresholds feed zone derivation, so
 * edits apply to the next generated plan, not the stored one; the copy says
 * so instead of pretending otherwise.
 */

/** "4:54" ↔ metres-per-second, per km. */
function paceToMps(pace: string): number | null {
  const m = pace.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const sec = Number(m[1]) * 60 + Number(m[2]);
  if (sec < 120 || sec > 720) return null; // 2:00–12:00 /km sanity window
  return 1000 / sec;
}

function mpsToPace(mps: number): string {
  const sec = Math.round(1000 / mps);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

const fieldStyle = {
  height: 48,
  backgroundColor: C.fieldSunken,
  borderWidth: 1,
  borderColor: C.hairline,
  paddingHorizontal: 14,
  color: C.bone,
  fontFamily: FONT.body,
  fontSize: 15,
} as const;

export default function SettingsScreen() {
  const athlete = useAthlete();
  const stored = usePlan();
  const [name, setName] = useState("");
  const [pace, setPace] = useState("");
  const [lthr, setLthr] = useState("");
  const [saved, setSaved] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Populate once per athlete identity — not on every keystroke re-render.
  useEffect(() => {
    if (!athlete || loadedFor === athlete.name + athlete.thresholds.runThresholdSpeedMps) return;
    setName(athlete.demo ? "" : athlete.name);
    setPace(mpsToPace(athlete.thresholds.runThresholdSpeedMps));
    setLthr(String(athlete.thresholds.lthrBpm));
    setLoadedFor(athlete.name + athlete.thresholds.runThresholdSpeedMps);
  }, [athlete, loadedFor]);

  const mps = paceToMps(pace);
  const lthrNum = Number(lthr);
  const lthrValid = Number.isFinite(lthrNum) && lthrNum >= 100 && lthrNum <= 220;
  const valid = mps !== null && lthrValid;

  const save = async () => {
    if (!athlete || !valid || mps === null) return;
    tapSuccess();
    await setAthlete({
      ...athlete,
      name: name.trim() || "Athlete",
      demo: false,
      thresholds: { ...athlete.thresholds, runThresholdSpeedMps: mps, lthrBpm: lthrNum },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const clearPlan = async () => {
    tapLight();
    await setPlan(null);
    setCleared(true);
    setTimeout(() => setCleared(false), 2000);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.field }}>
      <View style={{ paddingHorizontal: 22, paddingTop: 6, flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.fieldRaised, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: C.bone, fontSize: 18, marginTop: -2 }}>‹</Text>
        </Pressable>
        <View>
          <Label style={{ fontSize: 10 }}>ATHLETE PROFILE</Label>
          <Display size={26} style={{ marginTop: 4 }}>Settings</Display>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32, gap: 20 }} keyboardShouldPersistTaps="handled">
        {athlete?.demo && (
          <View style={{ backgroundColor: C.fieldRaised, borderRadius: R.card, padding: 16 }}>
            <Label style={{ color: C.signalText, fontSize: 10 }}>RUNNING ON DEMO DATA</Label>
            <Body style={{ fontSize: 13, lineHeight: 19, marginTop: 6 }}>
              These thresholds belong to the bundled demo athlete. Set your own and the badge goes away.
            </Body>
          </View>
        )}

        <View>
          <Label style={{ marginBottom: 8 }}>NAME</Label>
          <TextInput
            style={fieldStyle}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={C.boneFaint}
            returnKeyType="done"
            accessibilityLabel="Athlete name"
          />
        </View>

        <View>
          <Label style={{ marginBottom: 8, color: mps === null && pace !== "" ? C.signalText : C.boneFaint }}>
            THRESHOLD PACE · MIN/KM
          </Label>
          <TextInput
            style={[fieldStyle, { fontFamily: FONT.mono, fontSize: 16 }]}
            value={pace}
            onChangeText={setPace}
            placeholder="4:54"
            placeholderTextColor={C.boneFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            returnKeyType="done"
            accessibilityLabel="Threshold pace, minutes and seconds per kilometre"
          />
          <Body style={{ fontSize: 12, lineHeight: 18, marginTop: 8 }}>
            Roughly the pace you could hold for an hour flat out. Zones derive from it.
          </Body>
        </View>

        <View>
          <Label style={{ marginBottom: 8, color: !lthrValid && lthr !== "" ? C.signalText : C.boneFaint }}>
            LACTATE THRESHOLD HR · BPM
          </Label>
          <TextInput
            style={[fieldStyle, { fontFamily: FONT.mono, fontSize: 16 }]}
            value={lthr}
            onChangeText={setLthr}
            placeholder="168"
            placeholderTextColor={C.boneFaint}
            keyboardType="number-pad"
            returnKeyType="done"
            accessibilityLabel="Lactate threshold heart rate in beats per minute"
          />
        </View>

        <Button label={saved ? "✓ SAVED" : "SAVE PROFILE"} disabled={!valid} onPress={save} />
        <Body style={{ fontSize: 12, lineHeight: 18, marginTop: -8 }}>
          Applies to the next generated plan. The current plan keeps the thresholds it was drafted with.
        </Body>

        {stored && (
          <View style={{ borderTopWidth: 1, borderTopColor: C.hairline, paddingTop: 20 }}>
            <Label style={{ marginBottom: 8 }}>ACTIVE PLAN</Label>
            <Body style={{ fontSize: 13, lineHeight: 19 }}>
              {stored.plan.meta.raceName} · {stored.plan.meta.raceDate} · {stored.plan.weeks.length} weeks
            </Body>
            <View style={{ marginTop: 12 }}>
              <Button label={cleared ? "PLAN CLEARED" : "CLEAR PLAN"} variant="secondary" onPress={clearPlan} />
            </View>
            <Body style={{ fontSize: 12, lineHeight: 18, marginTop: 8 }}>
              Removes the plan from this device. Done marks go with it. A new one takes a minute to draft.
            </Body>
          </View>
        )}

        <View style={{ borderTopWidth: 1, borderTopColor: C.hairline, paddingTop: 20 }}>
          <Label style={{ marginBottom: 8 }}>ABOUT</Label>
          <Body style={{ fontSize: 13, lineHeight: 19 }}>
            Taper v0.1.0 · Night Instrument. Plans are generated on this device by the same engine as
            the dashboard. Nothing you enter here leaves the phone.
          </Body>
          <Text style={[type.figure, { fontSize: 10, color: C.boneFaint, marginTop: 10 }]}>
            NOT MEDICAL ADVICE · EVIDENCE TIERS SHOWN WHERE CLAIMS ARE MADE
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
