import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Body, Button, Display, Label } from "@/components/ui";
import { C, FONT, R, type } from "@/lib/theme";
import { setAthlete, setPlan, useAthlete, usePlan } from "@/lib/store";
import { tapLight, tapSuccess } from "@/lib/haptics";
import { runSync, readSync, type MobileSyncStore } from "@/lib/sync";
import { decodePairCode } from "@/lib/pair";
import { shareIcs } from "@/lib/ics";
import {
  readRemindersEnabled,
  remindersSupported,
  setRemindersEnabled,
  syncReminders,
} from "@/lib/notifications";

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
  const [saved, setSaved] = useState(false);
  const [cleared, setCleared] = useState(false);
  // The threshold form is DERIVED from the athlete, with the athlete's own
  // edits layered on top while they belong to the same identity. It used to
  // be three useStates re-synced by an effect keyed on a loadedFor sentinel —
  // an extra render pass on every load, and a second copy of the athlete's
  // values that could disagree with the store. Re-pairing changes the
  // identity, the edits stop matching, and the fields show the new athlete.
  const identity = athlete ? `${athlete.name}|${athlete.thresholds.runThresholdSpeedMps}` : null;
  const [edits, setEdits] = useState<{ id: string | null; name: string; pace: string; lthr: string } | null>(null);
  const fields =
    edits && edits.id === identity
      ? edits
      : {
          id: identity,
          name: athlete && !athlete.demo ? athlete.name : "",
          pace: athlete ? mpsToPace(athlete.thresholds.runThresholdSpeedMps) : "",
          lthr: athlete ? String(athlete.thresholds.lthrBpm) : "",
        };
  const { name, pace, lthr } = fields;
  const setName = (v: string) => setEdits({ ...fields, id: identity, name: v });
  const setPace = (v: string) => setEdits({ ...fields, id: identity, pace: v });
  const setLthr = (v: string) => setEdits({ ...fields, id: identity, lthr: v });
  const [sync, setSync] = useState<MobileSyncStore | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    void readSync().then(setSync);
  }, []);
  const [pairInput, setPairInput] = useState("");
  const [pairMsg, setPairMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reminders, setReminders] = useState(false);
  const [reminderMsg, setReminderMsg] = useState<string | null>(null);

  useEffect(() => {
    void readRemindersEnabled().then(setReminders);
  }, []);

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
    await syncReminders(null);
    setCleared(true);
    setTimeout(() => setCleared(false), 2000);
  };

  const importCode = async () => {
    const decoded = decodePairCode(pairInput);
    if ("error" in decoded) {
      setPairMsg({ ok: false, text: decoded.error });
      return;
    }
    tapSuccess();
    await setAthlete(decoded.athlete);
    setPairInput("");
    setPairMsg({
      ok: true,
      text: `Imported ${decoded.athlete.name} — CTL ${Math.round(decoded.athlete.seed.ctl)}${
        decoded.anchor ? `, anchored ${decoded.anchor}` : ""
      }. The next plan you generate starts from real history.`,
    });
  };

  const toggleReminders = async () => {
    tapLight();
    setReminderMsg(null);
    const next = !reminders;
    const ok = await setRemindersEnabled(next, stored ?? null);
    if (next && !ok) {
      setReminderMsg("Notifications are blocked for Taper in system settings.");
      return;
    }
    setReminders(next);
  };

  const doSync = async () => {
    tapLight();
    setSyncing(true);
    try {
      setSync(await runSync());
    } finally {
      setSyncing(false);
    }
  };

  const exportIcs = async () => {
    if (!stored) return;
    tapLight();
    try {
      await shareIcs(stored);
    } catch {
      // User dismissed the share sheet — not an error worth surfacing.
    }
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

        <View style={{ borderTopWidth: 1, borderTopColor: C.hairline, paddingTop: 20 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <Label>ACTIVITY SOURCES</Label>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sync activities now"
              onPress={doSync}
              disabled={syncing}
              hitSlop={10}
            >
              <Label style={{ fontSize: 10, color: syncing ? C.boneFaint : C.signalText }}>
                {syncing ? "SYNCING…" : "SYNC NOW"}
              </Label>
            </Pressable>
          </View>
          <Body style={{ fontSize: 13, lineHeight: 19 }}>
            What you actually trained, read from connected sources and deduplicated so a run
            recorded in several places counts once.
          </Body>
          {(sync?.sources ?? []).map((src) => (
            <View key={src.source} style={{ marginTop: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                <Text style={[type.body, { fontSize: 14, color: C.bone }]}>{src.label}</Text>
                <Label style={{ fontSize: 10, color: src.status === "ok" ? C.boneFaint : C.boneMuted }}>
                  {src.status === "ok"
                    ? `${src.activityCount} · ${String(src.lastSyncedAt ?? "").slice(0, 10)}`
                    : src.status.replace("-", " ").toUpperCase()}
                </Label>
              </View>
              {src.message && (
                <Body style={{ fontSize: 12, lineHeight: 18, marginTop: 4 }}>{src.message}</Body>
              )}
            </View>
          ))}
          {sync && sync.sources.every((x) => x.status !== "ok") && (
            <Body style={{ fontSize: 12, lineHeight: 18, marginTop: 10 }}>
              With no source connected, weeks you don't mark done stay unknown rather than counting
              as rest — the plan won't adapt on missing data.
            </Body>
          )}
        </View>

        <View style={{ borderTopWidth: 1, borderTopColor: C.hairline, paddingTop: 20 }}>
          <Label style={{ marginBottom: 8 }}>IMPORT FROM DASHBOARD</Label>
          <Body style={{ fontSize: 13, lineHeight: 19 }}>
            The dashboard's Import page shows a one-line pairing code. Paste it here and this phone
            trains as you — thresholds and fitness seed anchored on logged history.
          </Body>
          <TextInput
            style={[fieldStyle, { height: 88, paddingTop: 12, fontFamily: FONT.mono, fontSize: 11, marginTop: 12 }]}
            value={pairInput}
            onChangeText={(t) => {
              setPairInput(t);
              setPairMsg(null);
            }}
            placeholder="TAPER1.eyJ2IjoxLCJuYW1lIjoi…"
            placeholderTextColor={C.boneFaint}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Pairing code from the dashboard"
          />
          <View style={{ marginTop: 12 }}>
            <Button label="IMPORT ATHLETE" variant="secondary" disabled={!pairInput.trim()} onPress={importCode} />
          </View>
          {pairMsg && (
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10, alignItems: "flex-start" }}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: pairMsg.ok ? C.boneMuted : C.signal,
                  marginTop: 5,
                }}
              />
              <Body style={{ fontSize: 13, lineHeight: 19, flex: 1, color: pairMsg.ok ? C.boneMuted : C.signalText }}>
                {pairMsg.text}
              </Body>
            </View>
          )}
        </View>

        {remindersSupported && (
          <View style={{ borderTopWidth: 1, borderTopColor: C.hairline, paddingTop: 20 }}>
            <Label style={{ marginBottom: 8 }}>SESSION REMINDERS</Label>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: reminders }}
              accessibilityLabel="Session reminders at 7 in the morning"
              onPress={toggleReminders}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: C.fieldSunken,
                borderWidth: 1,
                borderColor: reminders ? C.signal : C.hairline,
                borderRadius: R.badge,
                paddingHorizontal: 14,
                paddingVertical: 14,
              }}
            >
              <Text style={[type.body, { fontSize: 14, color: C.bone }]}>7:00 on session days</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {reminders && <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.signal }} />}
                <Label style={{ fontSize: 10, color: reminders ? C.signalText : C.boneFaint }}>
                  {reminders ? "ON" : "OFF"}
                </Label>
              </View>
            </Pressable>
            {reminderMsg && (
              <Body style={{ fontSize: 12, lineHeight: 18, marginTop: 8, color: C.signalText }}>{reminderMsg}</Body>
            )}
            <Body style={{ fontSize: 12, lineHeight: 18, marginTop: 8 }}>
              Scheduled on this device from the plan — no push service, nothing registered anywhere.
            </Body>
          </View>
        )}

        {stored && (
          <View style={{ borderTopWidth: 1, borderTopColor: C.hairline, paddingTop: 20 }}>
            <Label style={{ marginBottom: 8 }}>ACTIVE PLAN</Label>
            <Body style={{ fontSize: 13, lineHeight: 19 }}>
              {stored.plan.meta.raceName} · {stored.plan.meta.raceDate} · {stored.plan.weeks.length} weeks
            </Body>
            <View style={{ marginTop: 12, gap: 10 }}>
              <Button label="ADD TO CALENDAR · .ICS" variant="secondary" onPress={exportIcs} />
              <Button label={cleared ? "PLAN CLEARED" : "CLEAR PLAN"} variant="secondary" onPress={clearPlan} />
            </View>
            <Body style={{ fontSize: 12, lineHeight: 18, marginTop: 8 }}>
              Calendar export writes one all-day event per session. Clear removes the plan and its
              done marks from this device.
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
