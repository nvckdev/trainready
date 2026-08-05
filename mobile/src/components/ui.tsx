import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { C, type } from "@/lib/theme";

/**
 * Night Instrument primitives — redesign pass 1a (Claude Design handoff,
 * docs/mobile-design-prompt.md → Taper.dc.html). Rule grammar over boxes:
 * hairline dividers, spec-sheet rows, the taper mark, one raised panel per
 * screen. Orange marks what is live, current, or counting down.
 */

export function Label({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[type.label, style]}>{children}</Text>;
}

export function Body({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[type.body, style]}>{children}</Text>;
}

export function Display({
  children,
  size = 28,
  style,
}: {
  children: React.ReactNode;
  size?: number;
  style?: TextStyle;
}) {
  return <Text style={[type.display, { fontSize: size, lineHeight: size * 1.05 }, style]}>{children}</Text>;
}

export function Rule({ style }: { style?: ViewStyle }) {
  return <View style={[{ height: 1, backgroundColor: C.hairline }, style]} />;
}

/** Reduced-motion query, resolved once per mount. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(v));
    return () => {
      alive = false;
    };
  }, []);
  return reduce;
}

/** The rec-dot: a signal dot whose pulse is opacity only, no bloom. */
export function RecDot({ size = 7 }: { size?: number }) {
  const reduce = useReduceMotion();
  // Lazy init: useState's initializer runs once, so the Animated.Value is
  // allocated once. `useRef(new Animated.Value(1))` evaluated its argument on
  // EVERY render and threw the result away — wasteful in a looping animation,
  // and a ref read during render besides.
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduce]);
  return (
    <Animated.View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.signal, opacity }}
    />
  );
}

/** The taper mark: a rule narrowing to a point, ending in the signal dot —
 *  the season converging on race day. `muted` renders the empty-state version. */
export function TaperMark({ width = 353, muted = false }: { width?: number; muted?: boolean }) {
  const stroke = muted ? C.hairline : C.bone;
  const dot = muted ? C.hairline : C.signal;
  const bodyEnd = width - 23;
  const thinEnd = width - 9;
  return (
    <Svg width={width} height={14} viewBox={`0 0 ${width} 14`}>
      <Path d={`M0 7 L${bodyEnd} 7`} stroke={stroke} strokeWidth={2} />
      <Path d={`M${bodyEnd} 7 L${thinEnd} 7`} stroke={stroke} strokeWidth={1} />
      <Circle cx={width - 4} cy={7} r={3.5} fill={dot} />
    </Svg>
  );
}

/** Rule-divided stat strip (no boxes): figures separated by vertical hairlines. */
export function StatStrip({
  items,
  size = 22,
}: {
  items: Array<{ value: React.ReactNode; label: string }>;
  size?: number;
}) {
  return (
    <View style={{ flexDirection: "row" }}>
      {items.map((it, i) => (
        <View key={it.label} style={{ flexDirection: "row", flex: 1 }}>
          {i > 0 && <View style={{ width: 1, backgroundColor: C.hairline, marginRight: 16 }} />}
          <View style={{ flex: 1 }}>
            <Text style={[type.figure, { fontSize: size }]}>{it.value}</Text>
            <Label style={{ marginTop: 2, fontSize: 10 }}>{it.label}</Label>
          </View>
        </View>
      ))}
    </View>
  );
}

/** Spec-sheet row: mono label column + body text, hairline-separated. */
export function SpecRow({ label, text, last = false }: { label: string; text: string; last?: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 12,
        paddingVertical: 10,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: C.hairline,
      }}
    >
      <Label style={{ width: 72, fontSize: 10, paddingTop: 2 }}>{label}</Label>
      <Text style={[type.body, { flex: 1, fontSize: 14, lineHeight: 20, color: C.bone }]}>{text}</Text>
    </View>
  );
}

/** Evidence tag: an instrument stamp; tap reveals the plain claim. "Our best
 *  guess" renders dashed — the most tentative tier looks the part. */
export function EvidenceTag({ tier, claim }: { tier: string; claim?: string }) {
  const [open, setOpen] = useState(false);
  const strong = /randomised|randomized|rct/i.test(tier);
  const guess = /guess|heuristic/i.test(tier);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={claim ? `Evidence tier ${tier}. ${claim}` : `Evidence tier ${tier}`}
        onPress={() => claim && setOpen((o) => !o)}
        style={{
          alignSelf: "flex-start",
          borderWidth: 1,
          borderStyle: guess ? "dashed" : "solid",
          borderColor: strong ? C.boneMuted : C.hairline,
          paddingHorizontal: 7,
          paddingVertical: 3,
        }}
      >
        <Label style={{ fontSize: 9, color: strong ? C.bone : guess ? C.boneFaint : C.boneMuted }}>{tier}</Label>
      </Pressable>
      {open && claim && (
        <View style={{ backgroundColor: C.fieldSunken, padding: 12, marginTop: 8 }}>
          <Body style={{ fontSize: 12, lineHeight: 18 }}>{claim}</Body>
        </View>
      )}
    </View>
  );
}

/** Primary / secondary / disabled buttons per the component sheet. */
export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  height = 48,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "done";
  disabled?: boolean;
  height?: number;
}) {
  const bg = disabled ? C.fieldRaised : variant === "primary" ? C.signal : "transparent";
  const fg = disabled ? C.boneFaint : variant === "primary" ? C.field : variant === "done" ? C.signalText : C.bone;
  const border = variant === "primary" || disabled ? "transparent" : variant === "done" ? C.signal : C.hairline;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        height,
        borderRadius: 2,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Label style={{ color: fg, fontSize: 12, letterSpacing: 1.5 }}>{label}</Label>
    </Pressable>
  );
}

/** Volume track: fill vs a floor tick. Below-floor renders the miss in signal —
 *  honestly, not as an error banner. */
export function TrackBar({ actual, floor }: { actual: number; floor: number }) {
  const meets = actual >= floor - 0.5;
  const scale = Math.max(actual, floor) * 1.12;
  const fill = Math.min(1, actual / scale);
  const tick = Math.min(1, floor / scale);
  return (
    <View style={{ height: 9, justifyContent: "center", marginTop: 6 }}>
      <View style={{ height: 3, backgroundColor: C.fieldSunken }}>
        <View
          style={{ height: 3, width: `${fill * 100}%`, backgroundColor: meets ? C.bone : C.boneMuted }}
        />
      </View>
      <View
        style={{
          position: "absolute",
          left: `${tick * 100}%`,
          top: 0,
          width: 1,
          height: 9,
          backgroundColor: meets ? C.boneFaint : C.signalText,
        }}
      />
    </View>
  );
}

/** Time-in-zone strip: 8px bands with 1px gaps, spread labels. */
export function DistributionStrip({ z1, z2, z3 }: { z1: number; z2: number; z3: number }) {
  return (
    <View>
      <View style={{ flexDirection: "row", height: 8, gap: 1 }}>
        <View style={{ flex: Math.max(z1, 0.001), backgroundColor: C.bone }} />
        <View style={{ flex: Math.max(z2, 0.001), backgroundColor: C.boneMuted }} />
        <View style={{ flex: Math.max(z3, 0.001), backgroundColor: C.signal }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 5 }}>
        <Label style={{ fontSize: 9 }}>{Math.round(z1 * 100)}% EASY</Label>
        <Label style={{ fontSize: 9 }}>{Math.round(z2 * 100)}% MOD</Label>
        <Label style={{ fontSize: 9 }}>{Math.round(z3 * 100)}% HARD</Label>
      </View>
    </View>
  );
}
