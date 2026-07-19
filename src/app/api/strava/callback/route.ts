import { NextRequest, NextResponse } from "next/server";
import { encodeTokens, STRAVA_COOKIE, STRAVA_STATE_COOKIE } from "@/lib/strava-data";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const origin = req.nextUrl.origin;
  if (!code) return NextResponse.redirect(`${origin}/app`);

  // CSRF check: the state must match the nonce this browser was issued at
  // /api/strava/login. A missing or mismatched state means the response wasn't
  // initiated here — drop it (and clear the nonce either way; it's single-use).
  const sentState = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get(STRAVA_STATE_COOKIE)?.value;
  if (!sentState || !cookieState || sentState !== cookieState) {
    const bounce = NextResponse.redirect(`${origin}/app?strava=state-mismatch`);
    bounce.cookies.delete(STRAVA_STATE_COOKIE);
    return bounce;
  }

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
    scope?: string;
  };

  // Scope check: a user can untick activity permissions on Strava's consent
  // screen; the exchange still succeeds but every later API call would 401
  // into a silent dead account. Surface it now instead of connecting broken.
  const scope = j.scope ?? req.nextUrl.searchParams.get("scope") ?? "";
  if (!/activity:read/.test(scope)) {
    const bounce = NextResponse.redirect(`${origin}/app?strava=scope-missing`);
    bounce.cookies.delete(STRAVA_STATE_COOKIE);
    return bounce;
  }

  const redirect = NextResponse.redirect(`${origin}/app`);
  redirect.cookies.delete(STRAVA_STATE_COOKIE);
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
