import { useCallback, useState } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { Body, Display, Label, Panel, Rule } from "@/components/ui";
import { C, FONT } from "@/lib/theme";
import { readPlan, type StoredPlan } from "@/lib/store";

/**
 * Fitness: the plan's projected CTL trajectory and form (TSB) drawn as an
 * instrument curve — bone line for fitness, signal dot on race morning.
 * Projections, and labeled as such.
 */
export default function FitnessScreen() {
  const [stored, setStored] = useState<StoredPlan | null>(null);
  const { width } = useWindowDimensions();

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      readPlan().then((p) => alive && setStored(p));
      return () => {
        alive = false;
      };
    }, [])
  );

  const weeks = stored?.plan.weeks ?? [];
  const W = Math.min(width - 40, 520);
  const H = 180;
  const PAD = 24;

  let curve = null;
  if (weeks.length >= 2) {
    const ctls = weeks.map((w) => w.projected.ctl);
    const lo = Math.min(...ctls) - 2;
    const hi = Math.max(...ctls) + 2;
    const x = (i: number) => PAD + (i / (weeks.length - 1)) * (W - PAD * 2);
    const y = (v: number) => H - PAD - ((v - lo) / Math.max(1, hi - lo)) * (H - PAD * 2);
    const pts = ctls.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    const last = { cx: x(weeks.length - 1), cy: y(ctls[ctls.length - 1]) };
    curve = (
      <Svg width={W} height={H} accessibilityLabel={`Projected fitness from CTL ${Math.round(ctls[0])} to ${Math.round(ctls[ctls.length - 1])} on race morning`}>
        <Line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={C.hairline} strokeWidth={1} />
        <Polyline points={pts} fill="none" stroke={C.bone} strokeWidth={2} />
        <Circle cx={last.cx} cy={last.cy} r={5} fill={C.signal} />
        <SvgText x={PAD} y={16} fill={C.boneFaint} fontSize={10} fontFamily={FONT.mono}>
          {`CTL ${Math.round(ctls[0])} → ${Math.round(ctls[ctls.length - 1])} · PROJECTED`}
        </SvgText>
      </Svg>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.field }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 14 }}>
        <Display size={28}>Fitness</Display>
        <Rule />
        {curve ? (
          <>
            <Panel style={{ alignItems: "center" }}>{curve}</Panel>
            <View style={{ gap: 8 }}>
              {weeks.map((w) => (
                <View key={w.weekStart} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Label style={{ width: 64 }}>{w.weekStart.slice(5)}</Label>
                  <View style={{ flex: 1, height: 4, backgroundColor: C.fieldSunken }}>
                    <View
                      style={{
                        height: 4,
                        width: `${Math.min(100, Math.max(2, w.projected.ctl))}%`,
                        backgroundColor: C.boneFaint,
                      }}
                    />
                  </View>
                  <Label>
                    CTL {Math.round(w.projected.ctl)} · TSB {Math.round(w.projected.tsb)}
                  </Label>
                </View>
              ))}
            </View>
            <Body style={{ fontSize: 12, color: C.boneFaint }}>
              Projections from the generated plan, not measurements. Import real training
              history on the dashboard for the measured curve; phone import lands next.
            </Body>
          </>
        ) : (
          <Panel>
            <Label>No trajectory yet</Label>
            <Body style={{ marginTop: 6 }}>
              Generate a plan and the projected fitness curve draws here.
            </Body>
          </Panel>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
