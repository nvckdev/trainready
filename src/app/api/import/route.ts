import { NextRequest, NextResponse } from "next/server";
import {
  mergeImports,
  parseFit,
  parseGpx,
  parseTcx,
  type ImportedActivity,
} from "@/lib/imports-io";

/** Multipart upload target for /app/import. Parses FIT/TCX/GPX files,
 *  persists to data/app/imports.json (gitignored), then redirects back to
 *  the import page which renders the batch summary. */

const MAX_FILE_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const back = new URL("/app/import", req.nextUrl.origin);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.redirect(back, 303);
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const activities: ImportedActivity[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const name = file.name || "upload";
    try {
      if (file.size > MAX_FILE_BYTES) {
        errors.push(`${name}: larger than 25 MB, skipped`);
        continue;
      }
      const ext = name.toLowerCase().split(".").pop() ?? "";
      let parsed: ImportedActivity[] = [];
      if (ext === "fit") {
        parsed = await parseFit(await file.arrayBuffer(), name);
      } else if (ext === "tcx") {
        parsed = parseTcx(await file.text(), name);
      } else if (ext === "gpx") {
        parsed = parseGpx(await file.text(), name);
      } else {
        errors.push(`${name}: unsupported type (need .fit, .tcx, or .gpx)`);
        continue;
      }
      if (parsed.length === 0) errors.push(`${name}: no activities found in file`);
      activities.push(...parsed);
    } catch {
      errors.push(`${name}: could not parse`);
    }
  }

  if (files.length > 0) mergeImports(activities, { files: files.length, errors });
  return NextResponse.redirect(back, 303);
}
