import type { PlannedSessionOut } from "./plan.ts";
import type { Block } from "./types.ts";

/**
 * Keep a scaled session's description true to its load.
 *
 * When a reflow damps a week, engine/replan.ts scaleWeek reduces each
 * session's tss and durationHr. Until 2026-08-05 it stopped there, leaving
 * title, structure and workout.blocks describing the session as originally
 * built: the stored plan carried "Long run 115" on a 22-minute session and
 * "Easy 60" on a 12-minute one, a ~5x contradiction visible on the Today
 * screen and disqualifying for watch export.
 *
 * The blocks scale with the session, and the text and title are DERIVED from
 * the scaled blocks — engine/types.ts already promises that `structure` is
 * derived from `workout.blocks` "so the two can never diverge", and this is
 * what makes that true after a damp as well as at generation.
 *
 * Why not rebuild through the templates? They cannot express a damped
 * duration: run-tempo floors its work segment at 15 minutes regardless of the
 * minutes it is handed, and mins() rounds to the nearest 5. Rebuilding an
 * 11-minute session would produce a ~25-minute structure — the same
 * contradiction, differently sourced. Proportional scaling is exact, so the
 * structure-to-duration ratio is INVARIANT across the damp.
 */

const fmtPace = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

/** "4:51–5:22/km" from a block's pace window; empty when it carries none. */
function paceOf(b: Block): string {
  if (!b.paceMinSecPerKm || !b.paceMaxSecPerKm) return "";
  return ` @ ${fmtPace(b.paceMinSecPerKm)}–${fmtPace(b.paceMaxSecPerKm)}/km`;
}

/** Minutes when it reads naturally, seconds when it would round to "0 min". */
function dur(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = sec / 60;
  return `${Number.isInteger(m) ? m : Math.round(m * 10) / 10} min`;
}

const zoneWord = (z: string) => (z === "vo2" ? "VO2" : z === "cv" ? "CV" : z);

/**
 * Session text from blocks — the single ruler for "what this session is".
 * Mirrors the phrasing the templates emit (WARMUP / MAIN n × d / COOLDOWN,
 * or a plain continuous line) so a damped card reads like a generated one.
 */
export function renderBlocks(blocks: Block[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    const reps = b.reps ?? 1;
    const d = b.durationSec ?? 0;
    if (d <= 0 && !b.distanceM) continue;
    const body = b.distanceM ? `${reps > 1 ? `${reps} × ` : ""}${b.distanceM} m` : `${reps > 1 ? `${reps} × ` : ""}${dur(d)}`;
    const rec =
      reps > 1 && (b.recoverySec ?? 0) > 0
        ? ` on ${dur(b.recoverySec!)}${b.recoveryNote ? ` ${b.recoveryNote}` : ""}`
        : reps > 1 && b.recoveryNote
          ? `, ${b.recoveryNote}`
          : "";
    const note = b.effortNote ? ` ${b.effortNote}` : "";
    switch (b.kind) {
      case "warmup":
        lines.push(`WARMUP ${body} ${zoneWord(b.zone)}${paceOf(b)}${note}`);
        break;
      case "cooldown":
        lines.push(`COOLDOWN ${body} ${zoneWord(b.zone)}${paceOf(b)}${note}`);
        break;
      case "strides":
        lines.push(`${body} strides${paceOf(b)}${rec}${note}`);
        break;
      case "main":
        lines.push(`MAIN ${body}${paceOf(b)}${rec}${note}`);
        break;
      default:
        lines.push(`${body} ${zoneWord(b.zone)}${paceOf(b)}${rec}${note}`);
    }
  }
  return lines.join("\n");
}

/**
 * Replace the duration a title states, when it states one.
 *
 * Titles carry a duration ("Easy 60", "Long run 115", "Long ride 1.5h") or do
 * not ("Tempo intervals", "VO2 set"). The phrasing, and anything after the
 * number such as "+ strides", is left exactly as generated.
 *
 * Three things the pattern has to get right, each of which it got wrong at
 * some point while this was being written:
 *
 *  - The number must stand alone. The "2" in "VO2 set" is part of the name,
 *    so a bare \d+ rewrote it to "VO32 set".
 *  - It is the LAST number that carries the duration, not the first. "Zone 2
 *    ride 44" names its zone before its minutes, so taking the first integer
 *    turned a 60-minute ride into "Zone 60 ride 44".
 *  - "Long ride 1.5h" states HOURS. Rewriting that slot with minutes gives
 *    "Long ride 90h"; the trailing h is what distinguishes the two.
 */
const TITLE_DURATION = /(?<![A-Za-z\d.])(\d+(?:\.\d+)?)(h?)(?=\D*$)/;

export function retitle(title: string, minutes: number): string {
  return title.replace(TITLE_DURATION, (_m, _num, h: string) =>
    h ? `${Math.max(0.1, Math.round((minutes / 60) * 10) / 10)}h` : String(Math.max(1, Math.round(minutes)))
  );
}

/**
 * Scale a session's structure by the same factor its load was scaled by, and
 * re-derive its title and text from the result. Mutates in place, like the
 * scaleWeek it serves.
 *
 * A factor of 1 (or anything non-positive, which would mean a session of no
 * duration) is a no-op: the caller has not actually rescaled anything, and
 * the generated wording is preserved byte-for-byte.
 *
 * ORDER MATTERS: call this AFTER session.durationHr has been scaled, because
 * the title is regenerated from it.
 */
export function scaleSessionStructure(session: PlannedSessionOut, factor: number): void {
  if (!(factor > 0) || factor === 1) return;
  const blocks = session.workout?.blocks;
  if (blocks?.length) {
    for (const b of blocks) {
      if (b.durationSec) b.durationSec = Math.max(1, Math.round(b.durationSec * factor));
      if (b.recoverySec) b.recoverySec = Math.max(1, Math.round(b.recoverySec * factor));
      if (b.distanceM) b.distanceM = Math.max(1, Math.round(b.distanceM * factor));
    }
    session.structure = renderBlocks(blocks);
  }
  session.title = retitle(session.title, session.durationHr * 60);
}
