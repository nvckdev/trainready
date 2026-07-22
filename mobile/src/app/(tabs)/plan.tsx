import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Svg, { Circle, Path } from "react-native-svg";
import type { PlanWeek } from "@engine/plan.ts";
import { weekDistribution } from "@engine/intensity.ts";
import { Body, Button, Display, DistributionStrip, EvidenceTag, Label, TaperMark, TrackBar } from "@/components/ui";
import { C, type } from "@/lib/theme";
import { currentWeekIndex, usePlan, useToday, useWeeklyReconcile } from "@/lib/store";

const PHASE_LABEL: Record<string, string> = {
  base: "BASE",
  build: "BUILD",
  taper: "TAPER",
  race: "RACE",
  recovery: "CUTBACK",
  offseason: "RETURN",
};

function WeekRow({
  w,
  maxTss,
  isCurrent,
  open,
  onToggle,
}: {
  w: PlanWeek;
  maxTss: number;
  isCurrent: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const d = weekDistribution(w.sessions);
  const hasTuneup = w.sessions.some((s) => s.tuneup);
  const barColor = isCurrent ? C.signal : w.phase === "taper" ? C.bone : C.boneMuted;
  const dateColor = isCurrent ? C.bone : hasTuneup ? C.signalText : C.boneFaint;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Week of ${w.weekStart}, ${PHASE_LABEL[w.phase] ?? w.phase}, ${w.targetTss} TSS. ${open ? "Collapse" : "Expand"}`}
        onPress={onToggle}
        style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 }}
      >
        <Text style={[type.figure, { fontSize: 10, color: dateColor, width: 44 }]}>{w.weekStart.slice(5)}</Text>
        <Label style={{ fontSize: 9, color: isCurrent ? C.signalText : C.boneFaint, width: 56 }}>
          {PHASE_LABEL[w.phase] ?? w.phase}
          {isCurrent ? " ●" : ""}
        </Label>
        <View style={{ flex: 1, height: 8, backgroundColor: C.fieldSunken }}>
          <View style={{ height: 8, width: `${Math.min(100, (w.targetTss / maxTss) * 100)}%`, backgroundColor: barColor }} />
        </View>
        <Text style={[type.figure, { fontSize: 10, color: dateColor, width: 30, textAlign: "right" }]}>
          {w.targetTss}
        </Text>
      </Pressable>
      {open && (
        <View style={{ marginLeft: 54, marginTop: 2, marginBottom: 10, backgroundColor: C.fieldRaised, padding: 14 }}>
          {d.totalSec > 0 && (
            <>
              <Label style={{ fontSize: 9 }}>TIME IN ZONE</Label>
              <View style={{ marginTop: 6 }}>
                <DistributionStrip z1={d.z1Pct} z2={d.z2Pct} z3={d.z3Pct} />
              </View>
            </>
          )}
          <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: C.hairline }}>
            {w.sessions.map((s) => (
              <Pressable
                key={s.date + s.title}
                accessibilityRole="button"
                accessibilityLabel={`${s.weekday} ${s.title}, open session report`}
                onPress={() => router.push({ pathname: "/session", params: { date: s.date, title: s.title } })}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingVertical: 6,
                  borderBottomWidth: 1,
                  borderBottomColor: C.hairline,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, flex: 1 }}>
                  <Label style={{ fontSize: 9 }}>{s.weekday.toUpperCase()}</Label>
                  <Text
                    style={[
                      type.body,
                      { fontSize: 12, color: s.status === "done" ? C.boneFaint : s.tuneup ? C.signalText : C.bone },
                    ]}
                    numberOfLines={1}
                  >
                    {s.title}
                    {s.substituted ? "  ·  cross-train" : ""}
                  </Text>
                </View>
                <Text style={[type.figure, { fontSize: 10, color: C.boneFaint }]}>{s.tss}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

export default function PlanScreen() {
  useWeeklyReconcile();
  const stored = usePlan();
  const [openWeek, setOpenWeek] = useState<string | null>(null);

  const today = useToday();
  const curIdx = stored ? currentWeekIndex(stored.plan.weeks, today) : -1;
  const curWeek = curIdx >= 0 ? stored!.plan.weeks[curIdx].weekStart : null;

  // Open the current week once per plan; after that the user's expand state
  // survives tab switches instead of snapping back on every focus.
  const planKey = stored ? `${stored.plan.meta.raceDate}|${stored.plan.weeks[0]?.weekStart}` : null;
  useEffect(() => {
    if (stored) setOpenWeek(curWeek ?? stored.plan.weeks[0]?.weekStart ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  if (stored === undefined) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: C.field }} edges={["top"]} />;
  }

  if (!stored) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.field }} edges={["top"]}>
        <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 32, alignItems: "center" }}>
          <TaperMark width={200} muted />
          <Display size={30} style={{ marginTop: 22, textAlign: "center" }}>No active plan</Display>
          <Body style={{ marginTop: 12, textAlign: "center", fontSize: 14 }}>
            Set a race and the engine drafts a season around it. Sixteen weeks or three, it works
            with what you have.
          </Body>
          <View style={{ marginTop: 26, alignSelf: "stretch" }}>
            <Button label="SET A RACE GOAL" variant="secondary" onPress={() => router.push("/goal")} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const meta = stored.plan.meta;
  const weeks = stored.plan.weeks;
  const maxTss = Math.max(...weeks.map((w) => w.targetTss), 1);
  const vt = meta?.volumeTargets;
  // Tissue label from the why prefix ("Calf: pain on…" → CALF).
  const tissueSite = meta?.tissue?.why[0]?.split(":")[0]?.toUpperCase() ?? "ACTIVE";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.field }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
        {meta && (
          <>
            <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
              <Label>
                {meta.raceDate} · {meta.raceType.toUpperCase()} · {meta.engine.toUpperCase()}
              </Label>
              <Display size={44} style={{ marginTop: 6 }}>{meta.raceName}</Display>
              <View
                style={{
                  flexDirection: "row",
                  marginTop: 16,
                  borderTopWidth: 1,
                  borderBottomWidth: 1,
                  borderColor: C.hairline,
                  paddingVertical: 12,
                }}
              >
                {[
                  { v: <Text>{Math.round(meta.startCtl)}</Text>, l: "CTL START" },
                  {
                    v: (
                      <Text>
                        {Math.round(meta.projectedRaceCtl)}
                        <Text style={{ fontSize: 11, color: C.boneFaint }}> proj</Text>
                      </Text>
                    ),
                    l: "RACE-DAY CTL",
                  },
                  {
                    v: (
                      <Text>
                        {meta.projectedRaceTsb >= 0 ? "+" : ""}
                        {Math.round(meta.projectedRaceTsb)}
                      </Text>
                    ),
                    l: "RACE-DAY TSB",
                  },
                ].map((it, i) => (
                  <View key={it.l} style={{ flexDirection: "row", flex: 1 }}>
                    {i > 0 && <View style={{ width: 1, backgroundColor: C.hairline, marginRight: 14 }} />}
                    <View style={{ flex: 1 }}>
                      <Text style={[type.figure, { fontSize: 18 }]}>{it.v}</Text>
                      <Label style={{ fontSize: 10, marginTop: 2 }}>{it.l}</Label>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            {meta.goalGap && (
              <View style={{ marginHorizontal: 20, marginTop: 18, backgroundColor: C.fieldRaised, paddingVertical: 16, paddingHorizontal: 18 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Label>GOAL CHECK</Label>
                  <View style={{ borderWidth: 1, borderColor: C.hairline, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Label style={{ fontSize: 9 }}>PROJECTED</Label>
                  </View>
                </View>
                <Text style={[type.figure, { fontSize: 20, marginTop: 10 }]}>
                  {meta.goalGap.goalTime} → ~{meta.goalGap.realisticFinish}{" "}
                  <Text style={{ fontSize: 11, color: C.boneFaint }}>LOAD-LIMITED</Text>
                </Text>
                <Body style={{ fontSize: 13, lineHeight: 19, marginTop: 8 }}>{meta.goalGap.message}</Body>
              </View>
            )}

            {vt && (
              <View style={{ marginHorizontal: 20, marginTop: 14, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.hairline }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Label>VOLUME TARGETS</Label>
                  <EvidenceTag
                    tier="OBSERVATIONAL"
                    claim="Weekly volume over 32 km and a longest run over 21 km are each associated with faster half marathons in cohort data (Fokkema 2020). Associations, not guarantees."
                  />
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 12 }}>
                  <Text style={[type.body, { fontSize: 13, color: C.bone }]}>Peak weekly volume</Text>
                  <Text style={[type.figure, { fontSize: 12 }]}>
                    {Math.round(vt.peakWeeklyKmActual)} KM{" "}
                    <Text style={{ color: vt.meetsWeeklyFloor ? C.boneFaint : C.signalText }}>
                      / FLOOR {vt.weeklyFloorKm}
                    </Text>
                  </Text>
                </View>
                <TrackBar actual={vt.peakWeeklyKmActual} floor={vt.weeklyFloorKm} />
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 14 }}>
                  <Text style={[type.body, { fontSize: 13, color: C.bone }]}>Longest run</Text>
                  <Text style={[type.figure, { fontSize: 12 }]}>
                    {Math.round(vt.peakLongKmActual)} KM{" "}
                    <Text style={{ color: vt.meetsLongFloor ? C.boneFaint : C.signalText }}>
                      / FLOOR {vt.longFloorKm}
                    </Text>
                  </Text>
                </View>
                <TrackBar actual={vt.peakLongKmActual} floor={vt.longFloorKm} />
                {(!vt.meetsWeeklyFloor || !vt.meetsLongFloor) && (
                  <Body style={{ fontSize: 12, lineHeight: 18, marginTop: 8 }}>
                    {vt.tissueActive
                      ? "A cap holds volume under the usual floor. The plan compensates where it safely can."
                      : vt.longCappedByFraction
                        ? `Weekly volume can't yet support a ${vt.longFloorKm} km long run safely — it's held to ~35% of the week and grows as volume does.`
                        : "Volume is still building toward the floor. The ramp needs more runway to get there safely."}
                  </Body>
                )}
              </View>
            )}

            {(meta.replanNote || meta.recalibration || meta.lastRecomputed) && (
              <View style={{ marginHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.hairline }}>
                {meta.replanNote && (
                  <>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.signal }} />
                      <Label style={{ color: C.signalText }}>PLAN ADJUSTED</Label>
                    </View>
                    <Body style={{ fontSize: 13, lineHeight: 19, marginTop: 6 }}>{meta.replanNote}</Body>
                  </>
                )}
                {meta.recalibration && (
                  <Body style={{ fontSize: 13, lineHeight: 19, marginTop: 8 }}>{meta.recalibration.message}</Body>
                )}
                {/* Outside the note conditional: a reflow must always leave a
                    visible trace, even if no rule produced copy. */}
                {meta.lastRecomputed && (
                  <Label style={{ fontSize: 10, marginTop: meta.replanNote ? 8 : 0 }}>
                    RE-PLANNED {meta.lastRecomputed}
                  </Label>
                )}
              </View>
            )}

            {meta.tissue && meta.tissue.why.length > 0 && (
              <View style={{ marginHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.hairline }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.signal }} />
                  <Label style={{ color: C.signalText }}>TISSUE CONSTRAINT · {tissueSite}</Label>
                </View>
                {meta.tissue.why.map((why) => (
                  <Body key={why} style={{ fontSize: 13, lineHeight: 19, marginTop: 6 }}>
                    {why}
                  </Body>
                ))}
              </View>
            )}

            <View style={{ marginHorizontal: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.hairline }}>
              <Label style={{ marginBottom: 10 }}>{weeks.length} WEEKS TO RACE DAY</Label>
              {weeks.map((w) => (
                <WeekRow
                  key={w.weekStart}
                  w={w}
                  maxTss={maxTss}
                  isCurrent={w.weekStart === curWeek}
                  open={openWeek === w.weekStart}
                  onToggle={() => setOpenWeek(openWeek === w.weekStart ? null : w.weekStart)}
                />
              ))}
              {weeks.length > 0 && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 10, paddingBottom: 6 }}>
                  <Text style={[type.figure, { fontSize: 10, color: C.signalText, width: 44 }]}>
                    {meta.raceDate.slice(5)}
                  </Text>
                  <Label style={{ fontSize: 9, color: C.signalText, width: 56 }}>RACE</Label>
                  <View style={{ flex: 1 }}>
                    <Svg width="100%" height={10} viewBox="0 0 180 10" preserveAspectRatio="none">
                      <Path d="M0 5 L160 5" stroke={C.bone} strokeWidth={1.5} />
                      <Circle cx={170} cy={5} r={4} fill={C.signal} />
                    </Svg>
                  </View>
                  <View style={{ width: 30 }} />
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
