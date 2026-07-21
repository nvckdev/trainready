import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import Svg, { Path, Text as SvgText } from "react-native-svg";
import type { PlannedSessionOut } from "@engine/plan.ts";
import { weekDistribution } from "@engine/intensity.ts";
import { Body, Button, Display, Label, SpecRow } from "@/components/ui";
import { C, FONT, R, type } from "@/lib/theme";
import { currentWeekIndex, toggleSessionDone, usePlan, useToday } from "@/lib/store";
import { tapSuccess } from "@/lib/haptics";

/**
 * Session report — turn 2 (handoff 2b). Everything shown is plan-derived:
 * the gauge is week load including this session's mark, the stats are the
 * prescription, the bullets come from engine meta. No invented measurements
 * — the app has no pace or HR data to report, so it doesn't.
 */

/** Semicircular gauge: 0..1 along a 180° arc. */
function ArcGauge({ frac, big, small }: { frac: number; big: string; small: string }) {
  const clamped = Math.max(0, Math.min(1, frac));
  const a = Math.PI * (1 - clamped);
  const r = 90;
  const cx = 120;
  const cy = 130;
  const ex = cx + r * Math.cos(a);
  const ey = cy - r * Math.sin(a);
  const largeArc = clamped > 0.5 ? 1 : 0;
  return (
    <Svg width={240} height={140} viewBox="0 0 240 140">
      <Path d={`M30 130 A 90 90 0 0 1 210 130`} fill="none" stroke={C.fieldSunken} strokeWidth={14} strokeLinecap="round" />
      {clamped > 0.01 && (
        <Path d={`M30 130 A 90 90 0 ${largeArc} 1 ${ex} ${ey}`} fill="none" stroke={C.signal} strokeWidth={14} strokeLinecap="round" />
      )}
      <SvgText x={120} y={102} textAnchor="middle" fontFamily={FONT.display} fontSize={40} fill={C.bone}>
        {big}
      </SvgText>
      <SvgText x={120} y={124} textAnchor="middle" fontFamily={FONT.mono} fontSize={9} letterSpacing={1.2} fill={C.boneFaint}>
        {small}
      </SvgText>
    </Svg>
  );
}

/** Parse the engine's structure text into spec-sheet rows. */
function specRows(structure: string): Array<{ label: string; text: string }> {
  return structure
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(WARMUP|MAIN|COOLDOWN|STRIDES|RECOVERY|SET)\s*(.*)$/i);
      return m ? { label: m[1].toUpperCase(), text: m[2] || line } : { label: "", text: line };
    });
}

export default function SessionScreen() {
  const { date, title } = useLocalSearchParams<{ date: string; title: string }>();
  const stored = usePlan();
  const today = useToday();

  const weeks = stored?.plan.weeks ?? [];
  let found: { s: PlannedSessionOut; weekIdx: number } | null = null;
  for (let i = 0; i < weeks.length && !found; i++) {
    const s = weeks[i].sessions.find((x) => x.date === date && x.title === title);
    if (s) found = { s, weekIdx: i };
  }

  if (stored === undefined) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: C.fieldSunken }} />;
  }

  if (!stored || !found) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.fieldSunken }}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 32 }}>
          <Display size={24} style={{ textAlign: "center" }}>Session not found</Display>
          <View style={{ marginTop: 22, alignSelf: "stretch" }}>
            <Button label="BACK" variant="secondary" onPress={() => router.back()} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const { s, weekIdx } = found;
  const week = weeks[weekIdx];
  const done = s.status === "done";
  const doneTss = week.sessions.filter((x) => x.status === "done").reduce((a, x) => a + x.tss, 0);
  const frac = week.targetTss > 0 ? doneTss / week.targetTss : 0;
  const curIdx = currentWeekIndex(weeks, today);

  // Session-only intensity, when the engine attached a structured workout.
  const dist = s.workout ? weekDistribution([s]) : null;
  const hasDist = !!dist && dist.totalSec > 0;

  // What it did / what it's for — engine-derived bullets only.
  const bullets: Array<{ mark: "check" | "dash"; text: string; muted?: boolean }> = [];
  bullets.push({ mark: done ? "check" : "dash", text: s.why });
  bullets.push({
    mark: done ? "check" : "dash",
    text: done
      ? `Week ${weekIdx + 1} moves to ${doneTss}/${week.targetTss} TSS with this session banked.`
      : `Marks ${s.tss} TSS against week ${weekIdx + 1}'s ${week.targetTss} TSS target.`,
  });
  const tissueWhy = stored.plan.meta.tissue?.why[0];
  if (tissueWhy) bullets.push({ mark: "dash", text: tissueWhy, muted: true });

  const upcoming = weeks
    .flatMap((w) => w.sessions)
    .filter((x) => x.date > s.date)
    .slice(0, 1)[0];

  const onToggle = () => {
    tapSuccess();
    toggleSessionDone(s.date, s.title);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.fieldSunken }}>
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
        <View style={{ flex: 1 }}>
          <Label style={{ fontSize: 10 }} >
            {s.weekday.slice(0, 3).toUpperCase()} · {s.title.toUpperCase()} · {done ? "DONE" : "PLANNED"}
          </Label>
          <Display size={26} style={{ marginTop: 4 }}>Session report</Display>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28, gap: 12 }}>
        <View style={{ backgroundColor: C.fieldRaised, borderRadius: R.hero, paddingVertical: 26, paddingHorizontal: 20, alignItems: "center" }}>
          <ArcGauge
            frac={frac}
            big={`${Math.round(frac * 100)}%`}
            small={`WEEK ${weekIdx + 1} LOAD ${done ? "INCL. THIS" : "BANKED"}`}
          />
          <View
            style={{
              flexDirection: "row",
              justifyContent: "center",
              gap: 26,
              marginTop: 16,
              borderTopWidth: 1,
              borderTopColor: C.hairline,
              paddingTop: 16,
              alignSelf: "stretch",
            }}
          >
            <View style={{ alignItems: "center" }}>
              <Text style={[type.figure, { fontSize: 16 }]}>{s.tss} TSS</Text>
              <Label style={{ fontSize: 9, marginTop: 2 }}>{done ? "LOGGED" : "PLANNED"}</Label>
            </View>
            <View style={{ width: 1, backgroundColor: C.hairline }} />
            <View style={{ alignItems: "center" }}>
              <Text style={[type.figure, { fontSize: 16 }]}>{Math.round(s.durationHr * 60)} MIN</Text>
              <Label style={{ fontSize: 9, marginTop: 2 }}>DURATION</Label>
            </View>
            <View style={{ width: 1, backgroundColor: C.hairline }} />
            <View style={{ alignItems: "center" }}>
              <Text style={[type.figure, { fontSize: 16 }]}>{s.discipline.toUpperCase()}</Text>
              <Label style={{ fontSize: 9, marginTop: 2 }}>DISCIPLINE</Label>
            </View>
          </View>
        </View>

        {s.workout && s.structure ? (
          <View style={{ backgroundColor: C.field, borderRadius: R.card, paddingHorizontal: 20, paddingVertical: 14 }}>
            <Label style={{ fontSize: 10 }}>STRUCTURE</Label>
            <View style={{ marginTop: 4 }}>
              {specRows(s.structure).map((r, i, arr) => (
                <SpecRow key={i} label={r.label} text={r.text} last={i === arr.length - 1} />
              ))}
            </View>
          </View>
        ) : null}

        {hasDist && dist && (
          <View style={{ backgroundColor: C.field, borderRadius: R.card, paddingHorizontal: 20, paddingVertical: 18 }}>
            <Label style={{ fontSize: 10 }}>INTENSITY · THIS SESSION</Label>
            <View style={{ flexDirection: "row", height: 12, gap: 3, marginTop: 12 }}>
              <View style={{ flex: Math.max(dist.z1Pct, 0.001), backgroundColor: C.bone, borderRadius: 6 }} />
              <View style={{ flex: Math.max(dist.z2Pct, 0.001), backgroundColor: C.boneMuted, borderRadius: 6 }} />
              <View style={{ flex: Math.max(dist.z3Pct, 0.001), backgroundColor: C.signal, borderRadius: 6 }} />
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
              <Label style={{ fontSize: 9 }}>{Math.round(dist.z1Pct * 100)}% EASY</Label>
              <Label style={{ fontSize: 9 }}>{Math.round(dist.z2Pct * 100)}% MOD</Label>
              <Label style={{ fontSize: 9 }}>{Math.round(dist.z3Pct * 100)}% HARD</Label>
            </View>
          </View>
        )}

        <View style={{ backgroundColor: C.field, borderRadius: R.card, paddingHorizontal: 20, paddingVertical: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Label style={{ fontSize: 10 }}>{done ? "WHAT IT DID" : "WHAT IT'S FOR"}</Label>
            <View style={{ borderWidth: 1, borderColor: C.hairline, borderRadius: R.badge, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Label style={{ fontSize: 9 }}>OUR BEST GUESS</Label>
            </View>
          </View>
          <View style={{ gap: 12, marginTop: 14 }}>
            {bullets.map((b, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: b.mark === "check" ? C.signal : "transparent",
                    borderWidth: b.mark === "check" ? 0 : 1,
                    borderColor: C.hairline,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontSize: 11, color: b.mark === "check" ? C.field : C.boneFaint }}>
                    {b.mark === "check" ? "✓" : "–"}
                  </Text>
                </View>
                <Text style={[type.body, { fontSize: 13, lineHeight: 19, flex: 1, color: b.muted ? C.boneMuted : C.bone, paddingTop: 1 }]}>
                  {b.text}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <Button
          label={done ? `✓ DONE · ${s.tss} TSS LOGGED` : "MARK DONE"}
          variant={done ? "done" : "primary"}
          onPress={onToggle}
        />

        {upcoming && (
          <View
            style={{
              backgroundColor: C.field,
              borderRadius: R.card,
              paddingHorizontal: 18,
              paddingVertical: 14,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <Text style={[type.body, { fontSize: 14, color: C.bone, flex: 1 }]} numberOfLines={1}>
              Next: {upcoming.title}, {Math.round(upcoming.durationHr * 60)} min
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Preview ${upcoming.title}`}
              onPress={() =>
                router.replace({ pathname: "/session", params: { date: upcoming.date, title: upcoming.title } })
              }
              style={{
                height: 40,
                paddingHorizontal: 18,
                borderRadius: R.pill,
                backgroundColor: C.signal,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Label style={{ fontSize: 11, color: C.field }}>PREVIEW</Label>
            </Pressable>
          </View>
        )}

        {curIdx !== weekIdx && (
          <Body style={{ fontSize: 11, textAlign: "center" }}>
            Week {weekIdx + 1} of {weeks.length} · starts {week.weekStart}
          </Body>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
