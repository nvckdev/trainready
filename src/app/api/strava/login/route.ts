import { NextRequest, NextResponse } from "next/server";

export function GET(req: NextRequest) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Strava is not configured. Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET." },
      { status: 501 }
    );
  }
  const origin = req.nextUrl.origin;
  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${origin}/api/strava/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", "activity:read_all");
  return NextResponse.redirect(url);
}
