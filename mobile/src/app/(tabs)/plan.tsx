import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import type { PlanWeek } from "@engine/plan.ts";
import { weekDistribution } from "@engine/intensity.ts";
import { Body, Display, DistributionStrip, Label, Panel, Rule, StatChip } from "@/components/ui";
import { C, type } from "@/lib/theme";
import { localToday, readPlan, type StoredPlan } from "@/lib/store";

const PHASE_LABEL: Record<string, string> = {
  base: "Base",
  build: "Build",
  taper: "Taper",
  race: "Race",
  recovery: "Cutback",
  offseason: "Return",
};

function WeekBlock({ w, open, onToggle }: { w: PlanWeek; open: boolean; onToggle: () => void }) {
  const d = weekDistribution(w.sessions);
  const hot = w.phase === "taper" || w.phase === "race";
  return (
    <View style={{ borderWidth: 1, borderColor: C.hairline }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Week of ${w.weekStart}, ${PHASE_LABEL[w.phase] ?? w.phase}, ${w.targetTss} TSS. ${open ? "Collapse" : "Expand"}`}
        onPress={onToggle}
        style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}
      >
        <Label style={{ width: 64 }}>{w.weekStart.slice(5)}</Label>
        <Label style={{ color: hot ? C.signalText : C.boneMuted, width: 64 }}>
          {PHASE_LABEL[w.phase] ?? w.phase}
        </Label>
        <View style={{ flex: 1, height: 6, backgroundColor: C.fieldSunken }}>
          <View
            style={{
              height: 6,
              width: `${Math.min(100, (w.targetTss / 250) * 100)}%`,
              backgroundColor: hot ? C.signal : C.boneFaint,
            }}
          />
        </View>
        <Text style={[type.figure, { fontSize: 13 }]}>{w.targetTss} TSS</Text>
      </Pressable>
      {open && (
        <View style={{ borderTopWidth: 1, borderTopColor: C.hairline, padding: 12, gap: 10 }}>
          {d.totalSec > 0 && <DistributionStrip z1={d.z1Pct} z2={d.z2Pct} z3={d.z3Pct} />}
          {w.sessions.map((s) => (
            <View key={s.date + s.title} style={{ gap: 2 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={[type.figure, { fontSize: 14, color: s.status === "done" ? C.boneFaint : C.bone }]}>
                  {s.weekday} · {s.title}
                </Text>
                <Label>{Math.round(s.durationHr * 60)}m · {s.tss}</Label>
              </View>
              {s.substituted ? <Label style={{ color: C.signalText }}>cross-train substitution</Label> : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default function PlanScreen() {
  const [stored, setStored] = useState<StoredPlan | null>(null);
  const [ready, setReady] = useState(false);
  const [openWeek, setOpenWeek] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      readPlan().then((p) => {
        if (alive) {
          setStored(p);
          setReady(true);
          if (p) {
            const today = localToday();
            const cur = p.plan.weeks.find((w, i) => {
              const end = p.plan.weeks[i + 1]?.weekStart ?? "9999-12-31";
              return today >= w.weekStart && today < end;
            });
            setOpenWeek(cur?.weekStart ?? p.plan.weeks[0]?.weekStart ?? null);
          }
        }
      });
      return () => {
        alive = false;
      };
    }, [])
  );

  if (ready && !stored) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.field }} edges={["top"]}>
        <View style={{ padding: 20, gap: 12 }}>
          <Display size={28}>Season plan</Display>
          <Panel>
            <Label>No active plan</Label>
            <Body style={{ marginTop: 6 }}>Set a race goal and the engine drafts the season on this device.</Body>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/goal")}
              style={{ backgroundColor: C.signal, paddingVertical: 12, paddingHorizontal: 16, marginTop: 12, alignSelf: "flex-start" }}
            >
              <Text style={[type.label, { color: C.field }]}>Set a goal</Text>
            </Pressable>
          </Panel>
        </View>
      </SafeAreaView>
    );
  }

  const meta = stored?.plan.meta;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.field }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 14 }}>
        <Label>Season plan</Label>
        <Display size={28}>{meta?.raceName ?? "…"}</Display>
        {meta && (
          <>
            <Label>
              {meta.raceDate} · {meta.raceType} · engine {meta.engine}
            </Label>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 20, marginTop: 4 }}>
              <StatChip label="CTL at plan start" value={String(Math.round(meta.startCtl))} />
              <StatChip label="Race-day CTL" value={String(Math.round(meta.projectedRaceCtl))} unit="proj." />
              {meta.projectedRaceRunCtl !== undefined && (
                <StatChip label="Running CTL" value={String(Math.round(meta.projectedRaceRunCtl))} unit="proj." />
              )}
              <StatChip label="Race-day form" value={String(Math.round(meta.projectedRaceTsb))} unit="TSB" />
            </View>
            <Rule style={{ marginVertical: 6 }} />

            {meta.goalGap && (
              <Panel>
                <Label>Goal check</Label>
                <Body style={{ marginTop: 6, color: C.bone }}>
                  {meta.goalGap.goalTime} → realistic finish ~{meta.goalGap.realisticFinish}{" "}
                  <Text style={{ color: C.boneFaint }}>(load-limited)</Text>
                </Body>
                <Body style={{ marginTop: 6, fontSize: 13, lineHeight: 19 }}>{meta.goalGap.message}</Body>
              </Panel>
            )}

            {meta.volumeTargets && (
              <Panel>
                <Label>Volume targets · evidence: observational</Label>
                <View style={{ flexDirection: "row", gap: 24, marginTop: 8 }}>
                  <StatChip
                    label="peak weekly"
                    value={String(Math.round(meta.volumeTargets.peakWeeklyKmActual))}
                    unit={`km · floor ${meta.volumeTargets.weeklyFloorKm}`}
                  />
                  <StatChip
                    label="longest run"
                    value={String(Math.round(meta.volumeTargets.peakLongKmActual))}
                    unit={`km · floor ${meta.volumeTargets.longFloorKm}`}
                  />
                </View>
              </Panel>
            )}

            {meta.tissue && meta.tissue.why.length > 0 && (
              <Panel>
                <Label style={{ color: C.signalText }}>Tissue constraint active</Label>
                {meta.tissue.why.map((why) => (
                  <Body key={why} style={{ marginTop: 6, fontSize: 13, lineHeight: 19 }}>
                    {why}
                  </Body>
                ))}
              </Panel>
            )}

            <View style={{ gap: 8, marginTop: 4 }}>
              {stored!.plan.weeks.map((w) => (
                <WeekBlock
                  key={w.weekStart}
                  w={w}
                  open={openWeek === w.weekStart}
                  onToggle={() => setOpenWeek(openWeek === w.weekStart ? null : w.weekStart)}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
