import { isPainEntry, type PainEntry } from "../../engine/pain.ts";
import { parseDeclarations, type DeclarationsRead } from "../../engine/tissue-declare.ts";

/**
 * Storage codec for the phone's health data — pure, so the gauntlet can run it.
 *
 * The stores themselves import AsyncStorage, which cannot load under tsx, so
 * the decode logic lives here and the stores stay thin wrappers. Same reason
 * pair.ts is testable: the part with a contract worth pinning is the part that
 * turns bytes back into meaning.
 *
 * Engine imports are relative through the mobile/engine symlink rather than
 * the @engine alias: the alias is resolved by Expo's bundler, and the gauntlet
 * runs this file under tsx from the repo root, where it is not.
 *
 * The two payloads are decoded with DELIBERATELY OPPOSITE discipline, and the
 * asymmetry is the whole design:
 *
 *   pain log      — filter bad rows, keep the series. A log an athlete has
 *                   added to for months must not be discarded over one
 *                   corrupt row; the cost of dropping a row is one data point.
 *   declarations  — refuse the WHOLE read on one bad entry. The cost of
 *                   dropping a row is an injury cap that silently stops
 *                   binding, which is the failure E9 was written for.
 */

/** The phone's pain series. Unreadable storage yields an empty log, not a
 *  throw: a corrupt cache must never stop someone logging today's pain. */
export function decodePainLog(raw: string | null): PainEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed as { entries?: unknown })?.entries;
    if (!Array.isArray(list)) return [];
    return list.filter(isPainEntry).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  } catch {
    return [];
  }
}

export function encodePainLog(entries: PainEntry[]): string {
  return JSON.stringify({ entries });
}

/**
 * The phone's tissue declarations, through the ENGINE's validator — the same
 * function the dashboard's file reader uses, so the two surfaces cannot
 * disagree about whether a declaration is binding.
 *
 * Storage that will not parse is "unreadable", NOT absent. Absent means no
 * injuries on file and the plan proceeds uncapped; unreadable means the caps
 * cannot be known, and every caller on the automatic path must refuse rather
 * than re-plan an injured athlete without their limits.
 */
export function decodeDeclarations(raw: string | null): DeclarationsRead {
  if (raw == null) return { declarations: [], status: "absent" };
  try {
    return parseDeclarations(JSON.parse(raw));
  } catch (e) {
    return { declarations: [], status: "unreadable", message: e instanceof Error ? e.message : String(e) };
  }
}

export function encodeDeclarations(declarations: unknown[]): string {
  return JSON.stringify({ declarations });
}
