import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  activeDeclarations,
  parseDeclarations,
  toConstraint,
  withDeclaration,
  withResolved,
  type DeclarationsRead,
  type TissueDeclaration,
} from "../../engine/tissue-declare.ts";
import type { TissueSite } from "../../engine/tissue.ts";

/**
 * The dashboard's persistence for tissue declarations — file I/O only.
 *
 * The model, the validation and the active-set resolution live in
 * engine/tissue-declare.ts, shared with mobile: a second copy of "which
 * declaration is binding today" would be the same duplication that has caused
 * every mobile-lags-dashboard incident here, with injury caps as the payload.
 *
 * Health data: data/app/, gitignored, never leaves the machine.
 *
 * src/lib gateway (rule 12) — pages and actions read declarations only here.
 */

const PATH = "data/app/tissue-declarations.json";

export { activeDeclarations, parseDeclarations, toConstraint };
export type { DeclarationsRead, TissueDeclaration };

/** Read the store. An absent file is a real state; a corrupt one is a failure
 *  the caller must handle, exactly as E9 set for athlete-context.json. */
export function readDeclarations(): DeclarationsRead {
  try {
    if (!existsSync(PATH)) return { declarations: [], status: "absent" };
    return parseDeclarations(JSON.parse(readFileSync(PATH, "utf8")));
  } catch (e) {
    return { declarations: [], status: "unreadable", message: e instanceof Error ? e.message : String(e) };
  }
}

function write(declarations: TissueDeclaration[]): void {
  mkdirSync(dirname(PATH), { recursive: true });
  writeFileSync(PATH, JSON.stringify({ declarations }, null, 2));
}

/** Append a declaration. */
export function appendDeclaration(d: TissueDeclaration): void {
  const read = readDeclarations();
  // Never overwrite a file we could not understand — that would destroy the
  // very entries the refusal is protecting.
  if (read.status === "unreadable") return;
  write(withDeclaration(read.declarations, d));
}

/** Mark every open declaration for a site resolved as of `date`. */
export function resolveDeclaration(site: TissueSite, date: string): void {
  const read = readDeclarations();
  if (read.status !== "ok") return;
  write(withResolved(read.declarations, site, date));
}
