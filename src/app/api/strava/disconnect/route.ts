import { NextRequest, NextResponse } from "next/server";
import { STRAVA_COOKIE } from "@/lib/strava-data";

/** POST-only: disconnecting is state-changing, so it must not be reachable via
 *  a GET that any third-party page could trigger with an img tag or prefetch. */
export function POST(req: NextRequest) {
  const redirect = NextResponse.redirect(`${req.nextUrl.origin}/app`, 303);
  redirect.cookies.delete(STRAVA_COOKIE);
  return redirect;
}
