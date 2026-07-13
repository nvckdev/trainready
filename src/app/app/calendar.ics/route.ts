import { readPlan } from "@/lib/plan-io";

/** The active plan as an iCalendar feed at /app/calendar.ics — one all-day
 *  VEVENT per planned session so the season drops into any calendar app.
 *  No plan → a valid empty calendar (subscriptions keep working). */

export const dynamic = "force-dynamic";

/** Escape per RFC 5545 §3.3.11 (TEXT). */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold content lines at 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length);
    // don't split a UTF-8 sequence
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
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

export async function GET() {
  const stored = readPlan();

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Taper//Season plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(stored ? `Taper — ${stored.plan.meta.raceName}` : "Taper")}`,
  ];

  if (stored) {
    const dtstamp =
      new Date(stored.plan.meta.generatedAt).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    for (const week of stored.plan.weeks) {
      for (const s of week.sessions) {
        const minutes = Math.round(s.durationHr * 60);
        const summary =
          s.discipline === "rest" ? s.title : `${s.title} · ${minutes}min · ${s.tss} TSS`;
        lines.push(
          "BEGIN:VEVENT",
          `UID:${s.date}-${s.discipline}-${s.title.replace(/[^A-Za-z0-9]+/g, "-")}@taper`,
          `DTSTAMP:${dtstamp}`,
          `DTSTART;VALUE=DATE:${dateBasic(s.date)}`,
          `DTEND;VALUE=DATE:${dateBasic(nextDay(s.date))}`,
          `SUMMARY:${esc(summary)}`,
          `DESCRIPTION:${esc(`${s.structure}\n\nWhy: ${s.why}`)}`,
          `CATEGORIES:${esc(s.discipline)}`,
          "TRANSP:TRANSPARENT",
          "END:VEVENT"
        );
      }
    }
  }

  lines.push("END:VCALENDAR");
  const body = lines.map(fold).join("\r\n") + "\r\n";

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="taper.ics"',
      "Cache-Control": "no-store",
    },
  });
}
