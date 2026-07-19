import { Text, View, type TextStyle, type ViewStyle } from "react-native";
import { C, FONT, type } from "@/lib/theme";

/** Shared Night Instrument primitives. */

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
  return <Text style={[type.display, { fontSize: size, lineHeight: size * 1.04 }, style]}>{children}</Text>;
}

export function Rule({ style }: { style?: ViewStyle }) {
  return <View style={[{ height: 1, backgroundColor: C.hairline }, style]} />;
}

/** Stat chip: mono figure + label + unit, the dashboard's header grammar. */
export function StatChip({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View>
      <Label>{label}</Label>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 2 }}>
        <Text style={[type.figure, { fontSize: 26 }]}>{value}</Text>
        {unit ? <Text style={[type.label, { color: C.boneFaint }]}>{unit}</Text> : null}
      </View>
    </View>
  );
}

export function Panel({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ borderWidth: 1, borderColor: C.hairline, backgroundColor: C.fieldRaised, padding: 14 }, style]}>
      {children}
    </View>
  );
}

/** Time-in-zone strip (feature 1): easy / moderate / hard by width. */
export function DistributionStrip({ z1, z2, z3 }: { z1: number; z2: number; z3: number }) {
  return (
    <View>
      <View style={{ flexDirection: "row", height: 6, backgroundColor: C.fieldSunken, overflow: "hidden" }}>
        <View style={{ flex: Math.max(z1, 0.001), backgroundColor: C.boneFaint }} />
        <View style={{ flex: Math.max(z2, 0.001), backgroundColor: C.boneMuted }} />
        <View style={{ flex: Math.max(z3, 0.001), backgroundColor: C.signal }} />
      </View>
      <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
        <Label>{Math.round(z1 * 100)}% easy</Label>
        <Label>{Math.round(z2 * 100)}% mod</Label>
        <Label style={{ color: C.signalText }}>{Math.round(z3 * 100)}% hard</Label>
      </View>
    </View>
  );
}

export const FONT_FALLBACK = FONT.monoFallback;
