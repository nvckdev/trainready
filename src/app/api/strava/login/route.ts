import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { STRAVA_STATE_COOKIE } from "@/lib/strava-data";

export function GET(req: NextRequest) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Strava is not configured. Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET." },
      { status: 501 }
    );
  }
  const origin = req.nextUrl.origin;
  // OAuth state: an unguessable nonce bound to this browser via a short-lived
  // httpOnly cookie. The callback rejects any response whose state doesn't
  // match, so an attacker can't bind a victim's dashboard to a foreign Strava
  // account by delivering a forged callback URL (login CSRF).
  const state = randomBytes(16).toString("hex");
  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${origin}/api/strava/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", "activity:read_all");
  url.searchParams.set("state", state);
  const redirect = NextResponse.redirect(url);
  redirect.cookies.set(STRAVA_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/strava",
    maxAge: 600, // the round-trip should take minutes, not days
  });
  return redirect;
}
