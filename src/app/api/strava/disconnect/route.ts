import { NextRequest, NextResponse } from "next/server";
import { STRAVA_COOKIE } from "@/lib/strava-data";

export function GET(req: NextRequest) {
  const redirect = NextResponse.redirect(`${req.nextUrl.origin}/app`);
  redirect.cookies.delete(STRAVA_COOKIE);
  return redirect;
}
