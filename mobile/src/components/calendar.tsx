import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { Body, Button, Display, Label, useReduceMotion } from "@/components/ui";
import { C, type } from "@/lib/theme";
import { tapLight } from "@/lib/haptics";

/**
 * Race-date calendar, drawn in the Night Instrument grammar rather than the
 * platform picker: mono digits, hairline grid, one signal cell. Dates inside
 * the taper minimum are rendered dead — the constraint is visible as shape,
 * not as an error message after the fact.
 */

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** Noon-UTC anchoring throughout, so DST never shifts a calendar square. */
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "SUN 8 NOV 2026" — the readable form, shared with the field that opens this. */
export function fmtLong(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  const wd = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const mo = d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return `${wd} ${d.getUTCDate()} ${mo} ${d.getUTCFullYear()}`.toUpperCase();
}

function weeksBetween(from: string, to: string): number {
  const ms = Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z");
  return Math.round(ms / (7 * 86400000));
}

/** Monday-first weeks covering `month`, trimmed to the rows that touch it. */
function monthRows(year: number, month: number): Array<Array<{ iso: string; inMonth: boolean }>> {
  const anchor = new Date(Date.UTC(year, month, 1, 12));
  const my = anchor.getUTCFullYear();
  const mm = anchor.getUTCMonth();
  const startDow = (anchor.getUTCDay() + 6) % 7;
  const rows: Array<Array<{ iso: string; inMonth: boolean }>> = [];
  for (let r = 0; r < 6; r++) {
    const row: Array<{ iso: string; inMonth: boolean }> = [];
    for (let c = 0; c < 7; c++) {
      const d = new Date(Date.UTC(my, mm, 1 - startDow + r * 7 + c, 12));
      row.push({ iso: iso(d), inMonth: d.getUTCMonth() === mm && d.getUTCFullYear() === my });
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.inMonth));
}

function Chevron({ dir, disabled }: { dir: "left" | "right"; disabled: boolean }) {
  const d = dir === "left" ? "M9 2 L3.5 7.5 L9 13" : "M4 2 L9.5 7.5 L4 13";
  return (
    <Svg width={13} height={15} viewBox="0 0 13 15">
      <Path d={d} stroke={disabled ? C.hairline : C.bone} strokeWidth={1.5} fill="none" />
    </Svg>
  );
}

export function DateSheet({
  value,
  minDate,
  today,
  onCancel,
  onConfirm,
}: {
  value: string;
  /** Earliest selectable day — the taper runway floor. */
  minDate: string;
  today: string;
  onCancel: () => void;
  onConfirm: (date: string) => void;
}) {
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(value);
  const opened = new Date((value >= minDate ? value : minDate) + "T12:00:00Z");
  const [cursor, setCursor] = useState({ y: opened.getUTCFullYear(), m: opened.getUTCMonth() });

  const rows = monthRows(cursor.y, cursor.m);
  const title = new Date(Date.UTC(cursor.y, cursor.m, 1, 12))
    .toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
    .toUpperCase();

  // Stepping back is pointless once the previous month holds no legal day.
  const lastOfPrevMonth = iso(new Date(Date.UTC(cursor.y, cursor.m, 0, 12)));
  const prevBlocked = lastOfPrevMonth < minDate;

  const step = (n: number) => {
    const d = new Date(Date.UTC(cursor.y, cursor.m + n, 1, 12));
    setCursor({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  };

  return (
    <Modal visible transparent animationType={reduce ? "none" : "slide"} onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "rgba(12,10,8,0.72)", justifyContent: "flex-end" }}>
        <Pressable style={{ flex: 1 }} accessibilityLabel="Dismiss calendar" onPress={onCancel} />

        <View
          style={{
            backgroundColor: C.field,
            borderTopWidth: 1,
            borderTopColor: C.hairline,
            padding: 20,
            // Keep CANCEL / USE THIS DATE clear of the home indicator.
            paddingBottom: 20 + insets.bottom,
          }}
        >
          <Label>RACE DATE</Label>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 14,
              marginBottom: 6,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              accessibilityState={{ disabled: prevBlocked }}
              disabled={prevBlocked}
              onPress={() => step(-1)}
              hitSlop={12}
              style={{ width: 44, height: 44, alignItems: "flex-start", justifyContent: "center" }}
            >
              <Chevron dir="left" disabled={prevBlocked} />
            </Pressable>
            <Text style={[type.figure, { fontSize: 13, letterSpacing: 1.5 }]}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next month"
              onPress={() => step(1)}
              hitSlop={12}
              style={{ width: 44, height: 44, alignItems: "flex-end", justifyContent: "center" }}
            >
              <Chevron dir="right" disabled={false} />
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", gap: 4, paddingBottom: 8 }}>
            {WEEKDAYS.map((w, i) => (
              <Label key={i} style={{ flex: 1, fontSize: 9, textAlign: "center" }}>
                {w}
              </Label>
            ))}
          </View>

          <View style={{ borderTopWidth: 1, borderTopColor: C.hairline, paddingTop: 4, gap: 4 }}>
            {rows.map((row, ri) => (
              <View key={ri} style={{ flexDirection: "row", gap: 4 }}>
                {row.map((cell) => {
                  if (!cell.inMonth) return <View key={cell.iso} style={{ flex: 1, aspectRatio: 1 }} />;
                  const blocked = cell.iso < minDate;
                  const selected = cell.iso === draft;
                  const isToday = cell.iso === today;
                  return (
                    <Pressable
                      key={cell.iso}
                      accessibilityRole="button"
                      accessibilityLabel={
                        blocked ? `${fmtLong(cell.iso)}, too soon to race` : fmtLong(cell.iso)
                      }
                      accessibilityState={{ selected, disabled: blocked }}
                      disabled={blocked}
                      onPress={() => {
                        tapLight();
                        setDraft(cell.iso);
                      }}
                      style={{
                        flex: 1,
                        aspectRatio: 1,
                        alignItems: "center",
                        justifyContent: "center",
                        borderWidth: 1,
                        borderColor: selected ? C.signal : "transparent",
                        backgroundColor: selected ? C.fieldSunken : "transparent",
                      }}
                    >
                      <Text
                        style={[
                          type.figure,
                          {
                            fontSize: 14,
                            color: selected ? C.signalText : blocked ? C.hairline : C.bone,
                          },
                        ]}
                      >
                        {Number(cell.iso.slice(8))}
                      </Text>
                      {isToday && !selected && (
                        <View
                          style={{
                            width: 3,
                            height: 3,
                            borderRadius: 1.5,
                            backgroundColor: blocked ? C.hairline : C.boneMuted,
                            marginTop: 3,
                          }}
                        />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>

          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: C.hairline,
              marginTop: 14,
              paddingTop: 12,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}
          >
            <View>
              <Label style={{ fontSize: 9 }}>SELECTED</Label>
              <Display size={19} style={{ marginTop: 4 }}>
                {fmtLong(draft)}
              </Display>
            </View>
            <Text style={[type.figure, { fontSize: 19, color: C.signalText }]}>
              {weeksBetween(today, draft)}
              <Text style={{ fontSize: 10, color: C.boneFaint }}> WK OUT</Text>
            </Text>
          </View>

          <Body style={{ fontSize: 12, lineHeight: 18, marginTop: 10 }}>
            Anything under three weeks is greyed out — a taper needs runway.
          </Body>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 16, marginBottom: 8 }}>
            <View style={{ width: 110 }}>
              <Button label="CANCEL" variant="secondary" onPress={onCancel} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="USE THIS DATE" onPress={() => onConfirm(draft)} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
