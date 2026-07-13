import { cookies } from "next/headers";

/**
 * Strava as a remote data source for the deployed dashboard, where the
 * local corpus (data/) never exists. Tokens live in an httpOnly cookie —
 * no server-side storage, nothing enters git (health-data rule).
 *
 * Consumed ONLY via src/lib/athlete-data.ts — pages never import this
 * module directly.
 */

const COOKIE = "taper_strava";
const API = "https://www.strava.com/api/v3";

export interface StravaTokens {
  a: string; // access token
  r: string; // refresh token
  e: number; // expires_at (unix seconds)
}

export function stravaConfigured(): boolean {
  return Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
}

export function encodeTokens(t: StravaTokens): string {
  return Buffer.from(JSON.stringify(t)).toString("base64url");
}

export async function readTokens(): Promise<StravaTokens | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString()) as StravaTokens;
  } catch {
    return null;
  }
}

export const STRAVA_COOKIE = COOKIE;

async function freshAccessToken(t: StravaTokens): Promise<string | null> {
  if (t.e * 1000 > Date.now() + 60_000) return t.a;
  // expired — refresh (cookie can't be rewritten from an RSC; short-lived reuse is fine,
  // the callback route re-sets the cookie on the next login)
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: t.r,
    }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { access_token: string };
  return j.access_token;
}

interface StravaActivity {
  start_date_local: string;
  distance: number; // meters
  moving_time: number; // seconds
  type: string;
  suffer_score?: number | null;
}

/** Duration-based TSS estimate when Strava's relative effort is absent.
 *  Labeled an estimate wherever surfaced. */
function estimateTss(act: StravaActivity): number {
  if (act.suffer_score != null && act.suffer_score > 0) return act.suffer_score;
  const hours = act.moving_time / 3600;
  const perHour = /run/i.test(act.type) ? 60 : /ride|bike/i.test(act.type) ? 55 : 50;
  return hours * perHour;
}

export interface RemoteDay {
  date: string;
  tss: number;
  runKm: number;
}

export interface RemoteSnapshot {
  days: RemoteDay[]; // last 120 days, ascending
  pmc: { date: string; ctl: number; atl: number; tsb: number }[];
  weekTss: number; // trailing 7 days
  weekRunKm: number;
  activityCount: number;
}

/** Fetch recent activities and derive a PMC. CTL τ=42 / ATL τ=7 are the
 *  same physiology constants as the corpus pipeline — not tunables. */
export async function getStravaSnapshot(): Promise<RemoteSnapshot | null> {
  const t = await readTokens();
  if (!t || !stravaConfigured()) return null;
  const access = await freshAccessToken(t);
  if (!access) return null;

  const afterSec = Math.floor(Date.now() / 1000) - 120 * 86400;
  const acts: StravaActivity[] = [];
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(
      `${API}/athlete/activities?after=${afterSec}&per_page=200&page=${page}`,
      { headers: { Authorization: `Bearer ${access}` }, cache: "no-store" }
    );
    if (!res.ok) break;
    const batch = (await res.json()) as StravaActivity[];
    acts.push(...batch);
    if (batch.length < 200) break;
  }
  if (!acts.length) return null;

  // Aggregate per local day
  const byDay = new Map<string, RemoteDay>();
  for (const a of acts) {
    const date = a.start_date_local.slice(0, 10);
    const d = byDay.get(date) ?? { date, tss: 0, runKm: 0 };
    d.tss += estimateTss(a);
    if (/run/i.test(a.type)) d.runKm += a.distance / 1000;
    byDay.set(date, d);
  }

  // Continuous day series (fill zeros) then PMC recursion
  const dates = [...byDay.keys()].sort();
  const start = new Date(dates[0] + "T00:00:00Z");
  const end = new Date();
  const days: RemoteDay[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    days.push(byDay.get(key) ?? { date: key, tss: 0, runKm: 0 });
  }

  let ctl = 0;
  let atl = 0;
  const pmc = days.map((d) => {
    const tsb = ctl - atl; // yesterday's values — TrainingPeaks convention
    ctl = ctl + (d.tss - ctl) / 42;
    atl = atl + (d.tss - atl) / 7;
    return { date: d.date, ctl, atl, tsb };
  });

  const last7 = days.slice(-7);
  return {
    days,
    pmc,
    weekTss: last7.reduce((a, d) => a + d.tss, 0),
    weekRunKm: last7.reduce((a, d) => a + d.runKm, 0),
    activityCount: acts.length,
  };
}
