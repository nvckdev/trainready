import { NextRequest, NextResponse } from "next/server";
import { encodeTokens, STRAVA_COOKIE } from "@/lib/strava-data";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const origin = req.nextUrl.origin;
  if (!code) return NextResponse.redirect(`${origin}/app`);

  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
    }),
    cache: "no-store",
  });
  if (!res.ok) return NextResponse.redirect(`${origin}/app`);

  const j = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };

  const redirect = NextResponse.redirect(`${origin}/app`);
  redirect.cookies.set(
    STRAVA_COOKIE,
    encodeTokens({ a: j.access_token, r: j.refresh_token, e: j.expires_at }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 90, // refresh token keeps it alive
    }
  );
  return redirect;
}
