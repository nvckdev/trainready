import { useEffect, useState } from "react";
import { Animated, Easing, Platform, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import type { PlanWeek } from "@engine/plan.ts";
import { Body, Display, Label, TaperMark, useReduceMotion } from "@/components/ui";
import { C, FONT, R, type } from "@/lib/theme";
import { currentWeekIndex, usePlan, useToday } from "@/lib/store";

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

// Engine sessions carry "Mon".."Sun"; match on the 3-letter prefix.
const DAY_SHORT = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

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

/** Chord-length estimate of the curve, padded — feeds the draw animation's
 *  dash so long plans don't leave a gap in the tail (the old fixed 600 did). */
function pathLength(pts: Array<{ x: number; y: number }>): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return Math.ceil(len * 1.15) + 20;
}

function CardLabel({ children, color }: { children: React.ReactNode; color?: string }) {
  return <Label style={{ fontSize: 10, color: color ?? C.boneFaint }}>{children}</Label>;
}

function EvidencePill({ label }: { label: string }) {
  return (
    <View style={{ borderWidth: 1, borderColor: C.hairline, borderRadius: R.badge, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Label style={{ fontSize: 9 }}>{label}</Label>
    </View>
  );
}

export default function FitnessScreen() {
  const stored = usePlan();
  const today = useToday();
  const { width } = useWindowDimensions();
  const reduce = useReduceMotion();
  const [dash] = useState(() => new Animated.Value(0));

  const weeks = stored?.plan.weeks ?? [];
  let curIdx = currentWeekIndex(weeks, today);
  // Before the plan starts, week 1 is "current" — same fallback Today uses,
  // so the two tabs no longer disagree mid-week before the first Monday.
  if (curIdx < 0 && weeks.length > 0 && today < weeks[0].weekStart) curIdx = 0;

  const meta = stored?.plan.meta;
  const cur: PlanWeek | null = curIdx >= 0 ? weeks[curIdx] : null;

  // ——— chart geometry (needed before the draw effect for the dash length) —
  const W = Math.min(width - 72, 380);
  const H = 220;
  const L = 36;
  const RGT = 8;
  let pts: Array<{ x: number; y: number }> = [];
  let lo = 0;
  let hi = 1;
  if (weeks.length >= 2) {
    const ctls = weeks.map((w) => w.projected.ctl);
    lo = Math.floor(Math.min(...ctls)) - 1;
    hi = Math.ceil(Math.max(...ctls)) + 1;
    const x = (i: number) => L + (i / (weeks.length - 1)) * (W - L - RGT - 14);
    const yy = (v: number) => 20 + (1 - (v - lo) / Math.max(1, hi - lo)) * 160;
    pts = ctls.map((v, i) => ({ x: x(i), y: yy(v) }));
  }
  const dashLen = pts.length >= 2 ? pathLength(pts) : 600;

  // Draw once per plan, not on every tab visit.
  const planKey = stored ? `${stored.plan.meta.raceDate}|${weeks[0]?.weekStart}` : null;
  useEffect(() => {
    if (!planKey || !ANIMATE_DRAW) return;
    if (reduce) {
      dash.setValue(0);
      return;
    }
    dash.setValue(dashLen);
    Animated.timing(dash, {
      toValue: 0,
      duration: 1100,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: false,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, reduce, dash]);

  if (stored === undefined) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: C.fieldSunken }} edges={["top"]} />;
  }

  if (!stored || weeks.length < 2 || !meta) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.fieldSunken }} edges={["top"]}>
        <View style={{ flex: 1, alignItems: "center", paddingHorizontal: 32, paddingTop: 80 }}>
          <TaperMark width={200} muted />
          <Display size={26} style={{ marginTop: 22, textAlign: "center" }}>No trajectory yet</Display>
          <Body style={{ marginTop: 12, textAlign: "center", fontSize: 14 }}>
            Generate a plan and the projected fitness curve draws here.
          </Body>
        </View>
      </SafeAreaView>
    );
  }

  // ——— week-load hero ————————————————————————————————————————————————————
  const doneTss = cur ? cur.sessions.filter((s) => s.status === "done").reduce((a, s) => a + s.tss, 0) : 0;
  const target = cur?.targetTss ?? 0;
  const pct = target > 0 ? Math.round((doneTss / target) * 100) : 0;
  const maxSessionTss = cur ? Math.max(...cur.sessions.map((s) => s.tss), 1) : 1;
  const days = DAY_SHORT.map((short) => {
    const s = cur?.sessions.find((x) => x.weekday.slice(0, 3).toUpperCase() === short);
    if (!s) return { short, kind: "rest" as const, h: 10, tss: 0 };
    const h = Math.max(14, Math.round((s.tss / maxSessionTss) * 92));
    if (s.date === today) return { short, kind: "today" as const, h, tss: s.tss };
    if (s.status === "done") return { short, kind: "done" as const, h, tss: s.tss };
    return { short, kind: "planned" as const, h, tss: s.tss };
  });

  // ——— stat cards ————————————————————————————————————————————————————————
  const curCtl = Math.round(cur?.projected.ctl ?? meta.startCtl);
  const raceCtl = Math.round(meta.projectedRaceCtl);
  const ctlDelta = raceCtl - curCtl;
  const sparkIdx = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (weeks.length - 1)));
  const sparkCtls = sparkIdx.map((i) => weeks[i].projected.ctl);
  const sparkMax = Math.max(...sparkCtls);
  const sparkMin = Math.min(...sparkCtls);
  const curTsb = Math.round(cur?.projected.tsb ?? 0);
  const tsbLabel = curTsb >= 5 ? "FRESH" : curTsb >= -10 ? "NEUTRAL" : "LOADED";
  const tsbPos = Math.max(0.04, Math.min(0.96, (curTsb + 30) / 50));

  // ——— push-next insight (honest: derived from engine meta, never invented) —
  const vt = meta.volumeTargets;
  const longDay = stored.request.longDay ?? "saturday";
  let insight: { head: string; body: string; tag: string; track?: { actual: number; floor: number; unit: string } } | null = null;
  if (vt && !vt.meetsLongFloor) {
    insight = {
      head: "LONG RUN IS THE GAP",
      body: `Longest run sits at ${Math.round(vt.peakLongKmActual)} km against a ${vt.longFloorKm} km floor.${
        vt.tissueActive ? " The tissue cap holds it there." : " The ramp is still building toward it."
      } Everything else is on track, so protect ${longDay[0].toUpperCase() + longDay.slice(1)}.`,
      tag: "OBSERVATIONAL",
      track: { actual: vt.peakLongKmActual, floor: vt.longFloorKm, unit: "KM" },
    };
  } else if (vt && !vt.meetsWeeklyFloor) {
    insight = {
      head: "WEEKLY VOLUME IS THE GAP",
      body: `Peak week sits at ${Math.round(vt.peakWeeklyKmActual)} km against a ${vt.weeklyFloorKm} km floor.${
        vt.tissueActive ? " A tissue cap holds it there." : " The ramp needs more runway to get there safely."
      }`,
      tag: "OBSERVATIONAL",
      track: { actual: vt.peakWeeklyKmActual, floor: vt.weeklyFloorKm, unit: "KM" },
    };
  } else if (meta.goalGap) {
    insight = { head: "GOAL CHECK", body: meta.goalGap.message, tag: "PROJECTED" };
  } else if (vt) {
    insight = {
      head: "VOLUME FLOORS MET",
      body: "Peak week and longest run both clear the evidence floors. Hold the plan.",
      tag: "OBSERVATIONAL",
    };
  }

  // ——— chart bits ————————————————————————————————————————————————————————
  const path = smoothPath(pts);
  const last = pts[pts.length - 1];
  const mid = Math.round((weeks.length - 1) / 2);
  const x0 = pts[0].x;
  const xm = pts[mid]?.x ?? x0;
  const grid = [lo + (hi - lo) * 0.75, lo + (hi - lo) * 0.25].map((v) => Math.round(v));
  const yy = (v: number) => 20 + (1 - (v - lo) / Math.max(1, hi - lo)) * 160;
  const ctls = weeks.map((w) => w.projected.ctl);

  const barColor = (k: "rest" | "today" | "done" | "planned") =>
    k === "today" ? C.signal : k === "done" ? C.boneMuted : k === "rest" ? C.hairline : "transparent";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.fieldSunken }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
        <View style={{ paddingHorizontal: 22, paddingTop: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Label>
              TAPER{cur ? ` · WEEK ${curIdx + 1}/${weeks.length}` : ""}
            </Label>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.signal }} />
          </View>
          <Display size={38} style={{ marginTop: 8 }}>Fitness</Display>
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 18, gap: 12 }}>
          {cur && (
            <View style={{ backgroundColor: C.fieldRaised, borderRadius: R.hero, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 18 }}>
              <CardLabel>WEEK LOAD · TARGET {target} TSS</CardLabel>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 8 }}>
                <Display size={46}>{pct}%</Display>
                <Text style={[type.figure, { fontSize: 11, color: C.boneFaint }]}>
                  {doneTss}/{target} DONE
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 9, height: 130, marginTop: 22 }}>
                {days.map((d) => (
                  <View key={d.short} style={{ flex: 1, height: "100%", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
                    {d.kind === "today" && (
                      <View style={{ backgroundColor: C.bone, borderRadius: 9, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={[type.figure, { fontSize: 9, color: C.field }]}>{d.tss}</Text>
                      </View>
                    )}
                    <View
                      style={{
                        width: "100%",
                        height: `${d.h}%`,
                        borderRadius: R.bar,
                        backgroundColor: barColor(d.kind),
                        borderWidth: d.kind === "planned" ? 1 : 0,
                        borderColor: C.boneFaint,
                        borderStyle: d.kind === "planned" ? "dashed" : "solid",
                      }}
                    />
                    <Label style={{ fontSize: 9, color: d.kind === "today" ? C.signalText : C.boneFaint }}>{d.short}</Label>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: "row", gap: 14, marginTop: 14 }}>
                {(
                  [
                    { l: "TODAY", c: C.signal, dashed: false },
                    { l: "DONE", c: C.boneMuted, dashed: false },
                    { l: "PLANNED", c: "transparent", dashed: true },
                  ] as const
                ).map((it) => (
                  <View key={it.l} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: it.c,
                        borderWidth: it.dashed ? 1 : 0,
                        borderColor: C.boneFaint,
                        borderStyle: it.dashed ? "dashed" : "solid",
                      }}
                    />
                    <Label style={{ fontSize: 9 }}>{it.l}</Label>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1, backgroundColor: C.field, borderRadius: R.card, padding: 18 }}>
              <CardLabel>FITNESS CTL</CardLabel>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 10 }}>
                <Display size={30}>{curCtl}</Display>
                <Text style={[type.figure, { fontSize: 10, color: ctlDelta >= 0 ? C.signalText : C.boneFaint }]}>
                  {ctlDelta >= 0 ? "▲" : "▼"} {ctlDelta >= 0 ? "+" : ""}
                  {ctlDelta} PROJ
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, height: 34, marginTop: 12 }}>
                {sparkCtls.map((v, i) => (
                  <View
                    key={i}
                    style={{
                      flex: 1,
                      height: `${Math.round(30 + ((v - sparkMin) / Math.max(1, sparkMax - sparkMin)) * 60)}%`,
                      borderRadius: 6,
                      backgroundColor: i === sparkCtls.length - 1 ? C.signal : i >= 3 ? C.boneMuted : C.hairline,
                    }}
                  />
                ))}
              </View>
            </View>
            <View style={{ flex: 1, backgroundColor: C.field, borderRadius: R.card, padding: 18 }}>
              <CardLabel>FORM TSB</CardLabel>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 10 }}>
                <Display size={30}>
                  {curTsb > 0 ? "+" : ""}
                  {curTsb}
                </Display>
                <Text style={[type.figure, { fontSize: 10, color: C.boneFaint }]}>{tsbLabel}</Text>
              </View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: C.fieldSunken, marginTop: 20 }}>
                <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${tsbPos * 100}%`, backgroundColor: C.boneMuted, borderRadius: 4 }} />
                <View
                  style={{
                    position: "absolute",
                    left: `${tsbPos * 100}%`,
                    top: -3,
                    width: 14,
                    height: 14,
                    marginLeft: -7,
                    borderRadius: 7,
                    backgroundColor: C.signal,
                    borderWidth: 2,
                    borderColor: C.field,
                  }}
                />
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
                <Label style={{ fontSize: 8 }}>FATIGUED</Label>
                <Label style={{ fontSize: 8 }}>RACE-READY</Label>
              </View>
            </View>
          </View>

          {insight && (
            <View style={{ backgroundColor: C.field, borderRadius: R.card, paddingHorizontal: 20, paddingVertical: 18 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.signal }} />
                  <CardLabel color={C.signalText}>PUSH NEXT</CardLabel>
                </View>
                <EvidencePill label={insight.tag} />
              </View>
              <Display size={19} style={{ marginTop: 10 }}>{insight.head}</Display>
              <Body style={{ fontSize: 13, lineHeight: 19, marginTop: 6 }}>{insight.body}</Body>
              {insight.track && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 }}>
                  <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: C.fieldSunken }}>
                    <View
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${Math.min(100, (insight.track.actual / (insight.track.floor * 1.12)) * 100)}%`,
                        backgroundColor: C.bone,
                        borderRadius: 4,
                      }}
                    />
                    <View
                      style={{
                        position: "absolute",
                        left: `${Math.min(96, (insight.track.floor / (insight.track.floor * 1.12)) * 100)}%`,
                        top: -3,
                        width: 2,
                        height: 14,
                        backgroundColor: C.signal,
                        borderRadius: 1,
                      }}
                    />
                  </View>
                  <Text style={[type.figure, { fontSize: 10 }]}>
                    {Math.round(insight.track.actual)}
                    <Text style={{ color: C.boneFaint }}>
                      /{insight.track.floor} {insight.track.unit}
                    </Text>
                  </Text>
                </View>
              )}
            </View>
          )}

          <View style={{ backgroundColor: C.field, borderRadius: R.card, padding: 18 }}>
            <CardLabel>PROJECTED TRAJECTORY</CardLabel>
            <View style={{ marginTop: 8 }}>
              <Svg width={W} height={H} accessibilityLabel={`Projected fitness from CTL ${Math.round(ctls[0])} to ${Math.round(ctls[ctls.length - 1])} on race morning`}>
                <Line x1={L} y1={20} x2={L} y2={180} stroke={C.hairline} strokeWidth={1} />
                <Line x1={L} y1={180} x2={W - RGT} y2={180} stroke={C.hairline} strokeWidth={1} />
                {grid.map((g) => (
                  <Line key={g} x1={L} y1={yy(g)} x2={W - RGT} y2={yy(g)} stroke={C.hairline} strokeWidth={1} strokeDasharray="2 4" />
                ))}
                {grid.map((g) => (
                  <SvgText key={`t${g}`} x={L - 8} y={yy(g) + 3} textAnchor="end" fontFamily={FONT.mono} fontSize={9} fill={C.boneFaint}>
                    {g}
                  </SvgText>
                ))}
                {ANIMATE_DRAW ? (
                  <AnimatedPath d={path} fill="none" stroke={C.bone} strokeWidth={2} strokeDasharray={dashLen} strokeDashoffset={dash} />
                ) : (
                  <Path d={path} fill="none" stroke={C.bone} strokeWidth={2} />
                )}
                <Circle cx={last.x} cy={last.y} r={4.5} fill={C.signal} />
                <SvgText x={x0} y={200} textAnchor="middle" fontFamily={FONT.mono} fontSize={9} fill={C.boneFaint}>
                  W1
                </SvgText>
                {mid !== 0 && mid !== weeks.length - 1 && (
                  <SvgText x={xm} y={200} textAnchor="middle" fontFamily={FONT.mono} fontSize={9} fill={C.boneFaint}>
                    W{mid + 1}
                  </SvgText>
                )}
                <SvgText x={last.x} y={200} textAnchor="middle" fontFamily={FONT.mono} fontSize={9} fill={C.signalText}>
                  RACE
                </SvgText>
              </Svg>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: C.hairline, paddingTop: 10 }}>
              <View>
                <Text style={[type.figure, { fontSize: 18 }]}>
                  {Math.round(ctls[0])} → {Math.round(ctls[ctls.length - 1])}
                </Text>
                <Label style={{ fontSize: 10, marginTop: 2 }}>CTL OVER PLAN</Label>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[type.figure, { fontSize: 18 }]}>
                  {meta.projectedRaceTsb >= 0 ? "+" : ""}
                  {Math.round(meta.projectedRaceTsb)}
                </Text>
                <Label style={{ fontSize: 10, marginTop: 2 }}>TSB RACE MORNING</Label>
              </View>
            </View>
            <View style={{ marginTop: 16 }}>
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

          <Body style={{ fontSize: 11, textAlign: "center", paddingVertical: 4 }} >
            Projections from the generated plan, not measurements.
          </Body>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
