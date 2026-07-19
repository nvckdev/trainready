import { Platform, type TextStyle } from "react-native";

/**
 * Night Instrument tokens (see DESIGN.md at the repo root), translated to hex
 * for React Native. Warm ember-black field, bone-cream engraving, one signal
 * orange reserved for what records, adapts, or counts down.
 */
export const C = {
  field: "#241f1a",
  fieldRaised: "#2e2822",
  fieldSunken: "#1c1814",
  bone: "#f0ead9",
  boneMuted: "#b3a996",
  boneFaint: "#847b69",
  hairline: "#4a4136",
  signal: "#f0521a",
  signalText: "#ff7a3d",
} as const;

/** Telemetry (mono) and display faces. Loaded in the root layout; the platform
 *  mono is the pre-load fallback so nothing flashes unstyled. */
export const FONT = {
  mono: "FragmentMono_400Regular",
  monoFallback: Platform.select({ ios: "Menlo", default: "monospace" })!,
  display: "Archivo_800ExtraBold",
  body: "Archivo_400Regular",
  bodyMedium: "Archivo_500Medium",
} as const;

export const type: Record<"label" | "display" | "body" | "figure", TextStyle> = {
  label: {
    fontFamily: FONT.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: C.boneFaint,
  },
  display: {
    fontFamily: FONT.display,
    textTransform: "uppercase",
    letterSpacing: -0.3,
    color: C.bone,
  },
  body: {
    fontFamily: FONT.body,
    fontSize: 15,
    lineHeight: 22,
    color: C.boneMuted,
  },
  figure: {
    fontFamily: FONT.mono,
    color: C.bone,
    fontVariant: ["tabular-nums"],
  },
};
