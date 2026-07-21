import { Platform } from "react-native";
import type { StoredPlan } from "./store";

/**
 * The active plan as an iCalendar file — the same format the dashboard
 * serves at /app/calendar.ics: one all-day VEVENT per session, so the
 * season drops into any calendar app.
 */

/** Escape per RFC 5545 §3.3.11 (TEXT). */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold content lines at 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const dec = new TextDecoder();
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length);
    // don't split a UTF-8 sequence
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(dec.decode(bytes.subarray(start, end)));
    start = end;
  }
  return parts.join("\r\n ");
}

const dateBasic = (ymd: string) => ymd.replaceAll("-", "");

function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function buildIcs(stored: StoredPlan): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Taper//Season plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(`Taper — ${stored.plan.meta.raceName}`)}`,
  ];
  const dtstamp = new Date(stored.plan.meta.generatedAt)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  for (const week of stored.plan.weeks) {
    for (const s of week.sessions) {
      const minutes = Math.round(s.durationHr * 60);
      const summary = s.discipline === "rest" ? s.title : `${s.title} · ${minutes}min · ${s.tss} TSS`;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${s.date}-${s.discipline}-${s.title.replace(/[^A-Za-z0-9]+/g, "-")}@taper`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;VALUE=DATE:${dateBasic(s.date)}`,
        `DTEND;VALUE=DATE:${dateBasic(nextDay(s.date))}`,
        `SUMMARY:${esc(summary)}`,
        `DESCRIPTION:${esc(`${s.structure ?? ""}\n\nWhy: ${s.why}`)}`,
        `CATEGORIES:${esc(s.discipline)}`,
        "TRANSP:TRANSPARENT",
        "END:VEVENT"
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Hand the calendar to the platform: share sheet on device, download on web. */
export async function shareIcs(stored: StoredPlan): Promise<void> {
  const body = buildIcs(stored);
  if (Platform.OS === "web") {
    const blob = new Blob([body], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "taper-plan.ics";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  // Legacy FS API: stable across SDK 54; the new File class can replace this
  // when the app moves SDKs.
  const FileSystem = await import("expo-file-system/legacy");
  const Sharing = await import("expo-sharing");
  const uri = `${FileSystem.cacheDirectory}taper-plan.ics`;
  await FileSystem.writeAsStringAsync(uri, body, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(uri, {
    mimeType: "text/calendar",
    dialogTitle: "Add the season to a calendar",
    UTI: "com.apple.ical.ics",
  });
}
