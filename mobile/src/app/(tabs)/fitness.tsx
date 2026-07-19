import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import { Body, Display, Label, TaperMark, useReduceMotion } from "@/components/ui";
import { C, FONT, type } from "@/lib/theme";
import { currentWeekIndex, localToday, usePlan } from "@/lib/store";

const AnimatedPath = Animated.createAnimatedComponent(Path);
// Animated props leak native-only attributes (collapsable) into the DOM on
// web — draw the curve statically there; the draw animation is native-only.
const ANIMATE_DRAW = Platform.OS !== "web";

const PHASE_LABEL: Record<string, string> = {
  base: "BASE",
  build: "BUILD",
  taper: "TAPER",
  race: "RACE",
  recovery: "CUTBACK",
  offseason: "RETURN",
};

/** Catmull-Rom → cubic bezier path through the projected points. */
function smoothPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export default function FitnessScreen() {
  const stored = usePlan();
  const { width } = useWindowDimensions();
  const reduce = useReduceMotion();
  const dash = useRef(new Animated.Value(600)).current;

  // Draw once per plan, not on every tab visit — the store snapshot is stable
  // across focus, so keying on the plan identity is enough.
  const planKey = stored ? `${stored.plan.meta.raceDate}|${stored.plan.weeks[0]?.weekStart}` : null;
  useEffect(() => {
    if (!planKey || !ANIMATE_DRAW) return;
    if (reduce) {
      dash.setValue(0);
      return;
    }
    dash.setValue(600);
    Animated.timing(dash, {
      toValue: 0,
      duration: 1100,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: false,
    }).start();
  }, [planKey, reduce, dash]);

  const weeks = stored?.plan.weeks ?? [];
  const today = localToday();
  const curIdx = currentWeekIndex(weeks, today);

  const W = Math.min(width - 40, 420);
  const H = 220;
  const L = 36;
  const R = 8;

  let chart = null;
  let summary = null;
  if (weeks.length >= 2) {
    const ctls = weeks.map((w) => w.projected.ctl);
    const lo = Math.floor(Math.min(...ctls)) - 1;
    const hi = Math.ceil(Math.max(...ctls)) + 1;
    const x = (i: number) => L + (i / (weeks.length - 1)) * (W - L - R - 14);
    const y = (v: number) => 180 - ((v - lo) / Math.max(1, hi - lo)) * 160 + 20 - 20;
    const yy = (v: number) => 20 + (1 - (v - lo) / Math.max(1, hi - lo)) * 160;
    const pts = ctls.map((v, i) => ({ x: x(i), y: yy(v) }));
    const path = smoothPath(pts);
    const last = pts[pts.length - 1];
    const mid = Math.round((weeks.length - 1) / 2);
    const grid = [lo + (hi - lo) * 0.75, lo + (hi - lo) * 0.25].map((v) => Math.round(v));
    void y;
    chart = (
      <Svg width={W} height={H} accessibilityLabel={`Projected fitness from CTL ${Math.round(ctls[0])} to ${Math.round(ctls[ctls.length - 1])} on race morning`}>
        <Line x1={L} y1={20} x2={L} y2={180} stroke={C.hairline} strokeWidth={1} />
        <Line x1={L} y1={180} x2={W - R} y2={180} stroke={C.hairline} strokeWidth={1} />
        {grid.map((g) => (
          <Line key={g} x1={L} y1={yy(g)} x2={W - R} y2={yy(g)} stroke={C.hairline} strokeWidth={1} strokeDasharray="2 4" />
        ))}
        {grid.map((g) => (
          <SvgText key={`t${g}`} x={L - 8} y={yy(g) + 3} textAnchor="end" fontFamily={FONT.mono} fontSize={9} fill={C.boneFaint}>
            {g}
          </SvgText>
        ))}
        {ANIMATE_DRAW ? (
          <AnimatedPath d={path} fill="none" stroke={C.bone} strokeWidth={2} strokeDasharray={600} strokeDashoffset={dash} />
        ) : (
          <Path d={path} fill="none" stroke={C.bone} strokeWidth={2} />
        )}
        <Circle cx={last.x} cy={last.y} r={4.5} fill={C.signal} />
        <SvgText x={x(0)} y={200} textAnchor="middle" fontFamily={FONT.mono} fontSize={9} fill={C.boneFaint}>
          W1
        </SvgText>
        <SvgText x={x(mid)} y={200} textAnchor="middle" fontFamily={FONT.mono} fontSize={9} fill={C.boneFaint}>
          W{mid + 1}
        </SvgText>
        <SvgText x={last.x} y={200} textAnchor="middle" fontFamily={FONT.mono} fontSize={9} fill={C.signalText}>
          RACE
        </SvgText>
      </Svg>
    );
    summary = (
      <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: C.hairline, paddingTop: 10 }}>
        <View>
          <Text style={[type.figure, { fontSize: 18 }]}>
            {Math.round(ctls[0])} → {Math.round(ctls[ctls.length - 1])}
          </Text>
          <Label style={{ fontSize: 10, marginTop: 2 }}>CTL OVER PLAN</Label>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[type.figure, { fontSize: 18 }]}>
            {stored!.plan.meta.projectedRaceTsb >= 0 ? "+" : ""}
            {Math.round(stored!.plan.meta.projectedRaceTsb)}
          </Text>
          <Label style={{ fontSize: 10, marginTop: 2 }}>TSB RACE MORNING</Label>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.field }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <Label>PROJECTED TRAJECTORY</Label>
          <Display size={44} style={{ marginTop: 6 }}>Fitness</Display>
        </View>
        {chart ? (
          <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
            {chart}
            {summary}
            <Body style={{ fontSize: 12, lineHeight: 18, marginTop: 12 }}>
              Projections from the generated plan, not measurements.
            </Body>
            <View style={{ marginTop: 20 }}>
              <View style={{ flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.hairline }}>
                <Label style={{ fontSize: 10, width: 60 }}>WEEK</Label>
                <Label style={{ fontSize: 10, width: 70 }}>PHASE</Label>
                <Label style={{ fontSize: 10, flex: 1, textAlign: "right" }}>CTL</Label>
                <Label style={{ fontSize: 10, width: 60, textAlign: "right" }}>TSB</Label>
              </View>
              {weeks.map((w, i) => {
                const color = i === weeks.length - 1 ? C.signalText : i === curIdx ? C.bone : C.boneMuted;
                const tsb = Math.round(w.projected.tsb);
                return (
                  <View key={w.weekStart} style={{ flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.hairline }}>
                    <Text style={[type.figure, { fontSize: 11, width: 60, color }]}>
                      W{String(i + 1).padStart(2, "0")}
                    </Text>
                    <Label style={{ fontSize: 9, width: 70, paddingTop: 1 }}>{PHASE_LABEL[w.phase] ?? w.phase}</Label>
                    <Text style={[type.figure, { fontSize: 11, flex: 1, textAlign: "right", color }]}>
                      {Math.round(w.projected.ctl)}
                    </Text>
                    <Text style={[type.figure, { fontSize: 11, width: 60, textAlign: "right", color: C.boneMuted }]}>
                      {tsb > 0 ? "+" : ""}
                      {tsb}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, alignItems: "center", paddingHorizontal: 32, paddingTop: 80 }}>
            <TaperMark width={200} muted />
            <Display size={26} style={{ marginTop: 22, textAlign: "center" }}>No trajectory yet</Display>
            <Body style={{ marginTop: 12, textAlign: "center", fontSize: 14 }}>
              Generate a plan and the projected fitness curve draws here.
            </Body>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
